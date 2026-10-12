import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  ProjectTaskTemplateInput,
  CreateProjectMilestoneTemplateInput,
  PrincipalContext,
  UpdateProjectMilestoneTemplateInput
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  nonEmptyString,
  optionalString
} from "../../shared/http/request-context";
import { PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";
import { BUILTIN_MILESTONE_TEMPLATE_KEY, isPrismaWriteConflict, milestoneTemplateKey, normalizeMilestoneTemplateMilestones } from "./projects.shared";
import { ProjectPermissionsService } from "./project-permissions.service";

const MILESTONE_TEMPLATE_ADMIN_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN"]);

function mapMilestoneTemplateSummary(row: any, readOnly = false) {
  const milestones = normalizeMilestoneTemplateMilestones(row.milestones);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status ?? "active",
    readOnly: readOnly || undefined,
    milestones,
    milestoneCount: milestones.length,
    stageCount: milestones.reduce((total, milestone) => total + milestone.stages.length, 0),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined
  };
}

function spreadsheetText(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}

function spreadsheetColumnIndex(header: string[], aliases: string[], excludedAliases: string[] = []) {
  const exact = header.findIndex((cell) => aliases.includes(spreadsheetText(cell)) && !excludedAliases.includes(spreadsheetText(cell)));
  if (exact >= 0) return exact;
  return header.findIndex((cell) => aliases.some((alias) => {
    const normalized = spreadsheetText(cell);
    return !excludedAliases.some((excluded) => normalized === excluded || normalized.includes(excluded))
      && (normalized === alias || normalized.includes(alias));
  }));
}

function splitSpreadsheetRow(rawLine: string) {
  const delimiter = rawLine.includes("\t") ? "\t" : rawLine.includes(";") ? ";" : ",";
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];
    if (char === '"') {
      if (quoted && rawLine[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function buildSpreadsheetTemplateDraft(fileName: string, source: string) {
  const fallbackMilestone = fileName.replace(/\.(xlsx|xls|csv)$/i, "").replace(/[_-]+/g, " ").trim() || "Imported project";
  const aliases = {
    milestone: ["milestone", "giai doan", "phase", "workstream", "epic", "release", "moc", "nhom tinh nang", "project phase"],
    stage: ["stage", "activity", "hang muc", "work package", "module", "workstream", "phase"],
    task: ["task", "task criteria", "task tieu chi", "task tieu chi hoan thanh", "task criteria complete", "cong viec", "chi tiet cong viec", "mo ta cong viec", "mo ta", "noi dung", "description", "item", "detail", "deliverable", "tieu chi hoan thanh"],
    subtask: ["subtask", "sub task", "sub-task", "cong viec con", "con viec con", "chi tiet con"],
    project: ["project", "project name", "du an", "ten du an", "initiative"],
  };
  const groups = new Map<string, Map<string, { name: string; tasks: Array<{ title: string; subtasks: Array<{ title: string }> }> }>>();
  const warnings: string[] = [];
  const sheetBlocks: Array<{ name: string; rows: string[][] }> = [];
  const detectedColumns = new Set<string>();
  let rowCount = 0;
  let taskCount = 0;
  let subtaskCount = 0;
  let currentSheet = "Imported sheet";
  let currentRows: string[][] = [];
  const flushSheet = () => {
    if (currentRows.length) sheetBlocks.push({ name: currentSheet, rows: currentRows });
    currentRows = [];
  };
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sheetMatch = line.match(/^SHEET\s*:\s*(.*)$/i);
    if (sheetMatch) {
      flushSheet();
      currentSheet = sheetMatch[1].trim() || "Imported sheet";
      continue;
    }
    currentRows.push(splitSpreadsheetRow(line));
  }
  flushSheet();
  if (!sheetBlocks.length) sheetBlocks.push({ name: "Imported sheet", rows: [] });

  let projectName = fallbackMilestone;
  let explicitMilestoneColumn = false;
  let parsedTables = 0;
  for (const block of sheetBlocks) {
    const candidates = block.rows.slice(0, Math.min(block.rows.length, 40)).map((row, index) => {
      const normalized = row.map(spreadsheetText);
      const score = normalized.reduce((total, cell) => total + (Object.values(aliases).some((list) => list.some((alias) => cell === alias || cell.includes(alias))) ? 1 : 0), 0);
      return { index, row, normalized, score };
    });
    const headerCandidate = candidates.sort((a, b) => b.score - a.score)[0];
    const headerIndex = headerCandidate && headerCandidate.score > 0 ? headerCandidate.index : -1;
    const header = headerIndex >= 0 ? headerCandidate!.normalized : [];
    const milestoneColumn = spreadsheetColumnIndex(header, aliases.milestone);
    const stageColumn = spreadsheetColumnIndex(header, aliases.stage);
    const taskColumn = spreadsheetColumnIndex(header, aliases.task, aliases.subtask);
    const subtaskColumn = spreadsheetColumnIndex(header, aliases.subtask);
    const projectColumn = spreadsheetColumnIndex(header, aliases.project);
    const fallbackTaskColumn = taskColumn >= 0 ? taskColumn : spreadsheetColumnIndex(header, aliases.task, [...aliases.milestone, ...aliases.stage, ...aliases.subtask, ...aliases.project]);
    const effectiveTaskColumn = taskColumn >= 0 ? taskColumn : fallbackTaskColumn;
    if (headerIndex >= 0) parsedTables += 1;
    if (milestoneColumn >= 0) explicitMilestoneColumn = true;
    if (milestoneColumn >= 0) detectedColumns.add("Milestone");
    if (stageColumn >= 0) detectedColumns.add("Stage");
    if (effectiveTaskColumn >= 0) detectedColumns.add("Task");
    if (subtaskColumn >= 0) detectedColumns.add("Subtask");
    if (projectColumn >= 0) detectedColumns.add("Project");
    if (projectColumn >= 0) {
      const projectValue = block.rows.slice(headerIndex + 1).map((row) => row[projectColumn]).find((value) => value?.trim());
      if (projectValue) projectName = projectValue.trim();
    }
    const projectMarker = block.rows.slice(0, Math.min(block.rows.length, 12)).flat().find((value) => /^project\s*:/i.test(value.trim()));
    if (projectMarker) projectName = projectMarker.replace(/^project\s*:\s*/i, "").trim() || projectName;
    if (headerIndex < 0) warnings.push(`Không nhận diện được hàng tiêu đề ở sheet “${block.name}”; hệ thống dùng cách đoán cột.`);
    let activeMilestone = block.name !== "Imported sheet" ? block.name : fallbackMilestone;
    let activeStage = "General work";
    for (const row of block.rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0)) {
      const values = row.map((cell) => cell.trim());
      const nonEmpty = values.filter(Boolean);
      if (!nonEmpty.length) continue;
      rowCount += 1;
      if (/^project\s*:/i.test(nonEmpty[0])) continue;
      const rowLooksLikeSection = nonEmpty.length === 1 && nonEmpty[0].length < 120 && !/\d{1,4}[\-\/]\d{1,2}/.test(nonEmpty[0]);
      const rawMilestone = milestoneColumn >= 0 ? values[milestoneColumn] : "";
      if (rawMilestone) activeMilestone = rawMilestone;
      if (rowLooksLikeSection && milestoneColumn < 0) {
        activeMilestone = nonEmpty[0];
        continue;
      }
      const stageValue = stageColumn >= 0 ? values[stageColumn] : "";
      const taskValue = effectiveTaskColumn >= 0 ? values[effectiveTaskColumn] : "";
      const subtaskValue = subtaskColumn >= 0 ? values[subtaskColumn] : "";
      const fallbackDetail = !taskValue && stageValue && values.length > 2
        ? values.find((value, valueIndex) => value && valueIndex !== milestoneColumn && valueIndex !== stageColumn)
        : "";
      const resolvedTask = taskValue || fallbackDetail || "";
      const guessedStage = stageValue || (!resolvedTask ? nonEmpty.find((value) => value !== activeMilestone && !/^stt$|^no\.?$/i.test(value)) : activeStage) || "";
      if (!guessedStage || /^stt$|^no\.?$/i.test(guessedStage) || /^(status|trang thai|owner|pic|assignee|deadline|due date)$/i.test(guessedStage)) continue;
      if (stageValue) activeStage = stageValue;
      const stage = stageValue || guessedStage;
      const milestone = rawMilestone || activeMilestone || fallbackMilestone;
      const current = groups.get(milestone) ?? new Map<string, { name: string; tasks: Array<{ title: string; subtasks: Array<{ title: string }> }> }>();
      const stageRecord = current.get(stage) ?? { name: stage, tasks: [] };
      if (resolvedTask && resolvedTask !== stageValue) {
        const previousTask = stageRecord.tasks[stageRecord.tasks.length - 1];
        const task = previousTask?.title === resolvedTask ? previousTask : { title: resolvedTask, subtasks: [] };
        if (task !== previousTask) { stageRecord.tasks.push(task); taskCount += 1; }
        if (subtaskValue && !task.subtasks.some((subtask) => subtask.title === subtaskValue)) { task.subtasks.push({ title: subtaskValue }); subtaskCount += 1; }
      } else if (subtaskValue) {
        const parentTask = stageRecord.tasks[stageRecord.tasks.length - 1];
        if (parentTask && !parentTask.subtasks.some((subtask) => subtask.title === subtaskValue)) { parentTask.subtasks.push({ title: subtaskValue }); subtaskCount += 1; }
        else warnings.push(`Sheet “${block.name}” có Subtask nhưng chưa có Task cha ở milestone “${milestone}”, stage “${stage}”.`);
      }
      else if (!current.has(stage) && stageValue) stageRecord.tasks = [];
      current.set(stage, stageRecord);
      groups.set(milestone, current);
    }
  }
  if (sheetBlocks.length > 1) warnings.push(`Đã đọc ${sheetBlocks.length} sheet; hệ thống gộp các bảng theo milestone.`);
  if (!explicitMilestoneColumn) warnings.push("Không thấy cột Milestone/Giai đoạn rõ ràng; hệ thống dùng tên section, tên sheet hoặc tên file để giữ nhóm.");
  if (!parsedTables) warnings.push("Không tìm thấy header chuẩn; nên kiểm tra lại bản nháp trước khi lưu.");
  if (taskCount === 0) warnings.push("Chưa tạo được Task; hãy kiểm tra cột Task/Nội dung hoặc thêm Task trong bước rà soát.");
  const milestones = Array.from(groups.entries()).map(([name, stages]) => ({
    name,
    stages: Array.from(stages.values()).slice(0, 100)
  })).filter((milestone) => milestone.stages.length > 0).slice(0, 50);
  return {
    data: {
      sourceFileName: fileName,
      projectName,
      description: "Bản nháp được suy luận từ file dự án đã import; hãy rà soát milestone/stage trước khi tạo project.",
      milestones,
      warnings,
      stats: {
        sheetCount: sheetBlocks.length,
        rowCount,
        milestoneCount: milestones.length,
        stageCount: milestones.reduce((total, milestone) => total + milestone.stages.length, 0),
        taskCount,
        subtaskCount,
        detectedColumns: Array.from(detectedColumns),
        reviewRequired: warnings.length > 0
      }
    }
  };
}

/** Milestone templates and the spreadsheet / "AI đọc file" template parser (split out of ProjectsService). */
@Injectable()
export class ProjectTemplatesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionsService) private readonly permissions: ProjectPermissionsService
  ) {}

  async listMilestoneTemplates(principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Milestone templates are internal");
    const rows = await this.prisma.projectMilestoneTemplate.findMany({
      where: { workspaceId: principal.workspaceId, status: { not: "archived" } },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });
    const builtin = mapMilestoneTemplateSummary({
      id: `builtin:${BUILTIN_MILESTONE_TEMPLATE_KEY}`,
      key: BUILTIN_MILESTONE_TEMPLATE_KEY,
      name: "Pilot UpLark chuẩn",
      description: "Mẫu mặc định theo format pilot hiện tại của UpLark.",
      status: "active",
      milestones: PILOT_PROJECT_MILESTONE_TEMPLATE
    }, true);
    return { data: [builtin, ...rows.map((row) => mapMilestoneTemplateSummary(row))] };
  }

  async createMilestoneTemplate(input: CreateProjectMilestoneTemplateInput, principal: PrincipalContext) {
    this.assertCanManageMilestoneTemplates(principal);
    const name = nonEmptyString(input?.name, "name");
    const milestones = normalizeMilestoneTemplateMilestones(input?.milestones);
    const reviewerUserIds = Array.from(new Set(milestones.map((milestone: any) => milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId : undefined).filter((id): id is string => Boolean(id))));
    await this.permissions.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, reviewerUserIds);
    const key = milestoneTemplateKey(input?.key, milestoneTemplateKey(name, `template-${randomUUID().slice(0, 8)}`));
    if (key === BUILTIN_MILESTONE_TEMPLATE_KEY) throw new ConflictException("pilot-v1 is reserved for the system template");
    try {
      const row = await this.prisma.projectMilestoneTemplate.create({
        data: {
          workspaceId: principal.workspaceId,
          key,
          name,
          description: optionalString(input?.description, "description") ?? undefined,
          milestones: milestones as unknown as Prisma.InputJsonValue,
          createdByUserId: principal.subjectId
        }
      });
      await this.prisma.auditEvent.create({
        data: {
          workspaceId: principal.workspaceId,
          actorUserId: principal.subjectId,
          action: "project.milestone_template_created",
          resource: "project_milestone_template",
          resourceId: row.id,
          before: undefined,
          after: { key: row.key, name: row.name, status: row.status, milestoneCount: milestones.length },
          requestId: randomUUID()
        }
      });
      return { data: mapMilestoneTemplateSummary(row) };
    } catch (error) {
      if (isPrismaWriteConflict(error)) throw new ConflictException("Template key đã tồn tại trong workspace");
      throw error;
    }
  }

  async updateMilestoneTemplate(templateId: string, input: UpdateProjectMilestoneTemplateInput, principal: PrincipalContext) {
    this.assertCanManageMilestoneTemplates(principal);
    if (templateId.startsWith("builtin:")) throw new ForbiddenException("System template cannot be edited");
    const existing = await this.prisma.projectMilestoneTemplate.findFirst({ where: { id: templateId, workspaceId: principal.workspaceId } });
    if (!existing) throw new NotFoundException("Milestone template not found");
    const milestones = input?.milestones === undefined ? undefined : normalizeMilestoneTemplateMilestones(input.milestones);
    if (milestones) {
      const reviewerUserIds = Array.from(new Set(milestones.map((milestone: any) => milestone.reviewerMode === "specific_user" ? milestone.reviewerUserId : undefined).filter((id): id is string => Boolean(id))));
      await this.permissions.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, reviewerUserIds);
    }
    const status = input?.status === undefined ? existing.status : optionalString(input.status, "status");
    if (status && !["active", "archived"].includes(status)) throw new BadRequestException("Invalid milestone template status");
    const updated = await this.prisma.projectMilestoneTemplate.update({
      where: { id: existing.id },
      data: {
        name: input?.name === undefined ? undefined : nonEmptyString(input.name, "name"),
        description: input?.description === undefined ? undefined : optionalString(input.description, "description") ?? null,
        milestones: milestones ? milestones as unknown as Prisma.InputJsonValue : undefined,
        status: status ?? existing.status
      }
    });
    await this.prisma.auditEvent.create({
      data: {
        workspaceId: principal.workspaceId,
        actorUserId: principal.subjectId,
        action: "project.milestone_template_updated",
        resource: "project_milestone_template",
        resourceId: updated.id,
        before: { key: existing.key, name: existing.name, status: existing.status, milestoneCount: Array.isArray(existing.milestones) ? existing.milestones.length : undefined },
        after: { key: updated.key, name: updated.name, status: updated.status, milestoneCount: milestones?.length ?? (Array.isArray(updated.milestones) ? updated.milestones.length : undefined) },
        requestId: randomUUID()
      }
    });
    return { data: mapMilestoneTemplateSummary(updated) };
  }

  async createAiTemplateDraft(rawInput: any, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project planning is internal");
    const input = rawInput && typeof rawInput === "object" ? rawInput : {};
    const fileName = nonEmptyString(input.fileName, "fileName");
    const text = typeof input.text === "string" ? input.text.trim() : "";
    const imageDataUrl = typeof input.imageDataUrl === "string" ? input.imageDataUrl.trim() : "";
    if (!text && !imageDataUrl) throw new BadRequestException("Upload an image or spreadsheet content to analyze");
    if (text.length > 120_000) throw new BadRequestException("Spreadsheet content is too large to analyze");
    if (imageDataUrl && !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)) {
      throw new BadRequestException("Only PNG, JPEG and WEBP images are supported");
    }

    if (text) return buildSpreadsheetTemplateDraft(fileName, text);

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new BadRequestException("AI import is not configured. Set OPENAI_API_KEY on the API service first.");
    }

    const userContent: Array<Record<string, unknown>> = [{
      type: "text",
      text: `Read the uploaded project planning source (${fileName}) and produce a temporary project template. Do not invent business facts. Preserve names, order and dates when present. Return only JSON matching the required schema.\n\nSOURCE:\n${text || "The source is the attached image."}`
    }];
    if (imageDataUrl) userContent.push({ type: "image_url", image_url: { url: imageDataUrl, detail: "high" } });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.CRM_AI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "project_template_draft",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                projectName: { type: "string" },
                description: { type: "string" },
                milestones: {
                  type: "array", items: { type: "object", additionalProperties: false, properties: {
                    name: { type: "string" },
                    stages: { type: "array", items: { type: "object", additionalProperties: false, properties: {
                      name: { type: "string" },
                      tasks: { type: "array", items: { $ref: "#/$defs/task" } }
                    }, required: ["name", "tasks"] } }
                  }, required: ["name", "stages"] }
                },
                warnings: { type: "array", items: { type: "string" } }
              },
              $defs: {
                task: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    subtasks: { type: "array", items: { $ref: "#/$defs/task" } }
                  },
                  required: ["title", "subtasks"]
                }
              },
              required: ["projectName", "description", "milestones", "warnings"]
            }
          }
        },
        messages: [
          { role: "system", content: "You extract project planning structures. A draft is temporary and must be reviewed by a human before persistence." },
          { role: "user", content: userContent }
        ]
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new BadRequestException(`AI import failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }
    const payload = await response.json() as any;
    const content = payload?.choices?.[0]?.message?.content;
    let parsed: any;
    try { parsed = JSON.parse(typeof content === "string" ? content : "{}"); } catch { throw new BadRequestException("AI returned an invalid template draft"); }
    const normalizeDraftTasks = (value: unknown): ProjectTaskTemplateInput[] => Array.isArray(value)
      ? value.map((task: any) => ({
          title: typeof task?.title === "string" ? task.title.trim() : "",
          subtasks: normalizeDraftTasks(task?.subtasks)
        })).filter((task) => task.title).slice(0, 200)
      : [];
    const milestones = Array.isArray(parsed.milestones) ? parsed.milestones.map((milestone: any) => ({
      name: typeof milestone?.name === "string" ? milestone.name.trim() : "",
      stages: Array.isArray(milestone?.stages) ? milestone.stages.map((stage: any) => ({
        name: typeof stage?.name === "string" ? stage.name.trim() : "",
        tasks: normalizeDraftTasks(stage?.tasks)
      })).filter((stage: any) => stage.name).slice(0, 100) : []
    })).filter((milestone: any) => milestone.name).slice(0, 50) : [];
    if (!milestones.length) throw new BadRequestException("AI could not find any milestone in the source");
    return { data: {
      sourceFileName: fileName,
      projectName: typeof parsed.projectName === "string" ? parsed.projectName.trim() : "",
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
      milestones,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((warning: unknown): warning is string => typeof warning === "string").slice(0, 20) : []
    }};
  }

  private assertCanManageMilestoneTemplates(principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Milestone templates are internal");
    if (!principal.roleCodes.some((roleCode) => MILESTONE_TEMPLATE_ADMIN_ROLES.has(roleCode))) {
      throw new ForbiddenException("Founder/GM or Workspace Admin role is required to manage milestone templates");
    }
  }
}
