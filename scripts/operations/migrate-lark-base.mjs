import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildActiveProjectAssignmentMemberships } from "./project-assignment-membership.mjs";

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const sourceDir = sourceArg?.slice("--source=".length) ?? process.env.LARK_BASE_MIGRATION_DIR;

const tenantKey = process.env.FOUNDATION_TENANT_KEY ?? process.env.PRODUCTION_TENANT_KEY ?? "prod";
const workspaceKey = process.env.FOUNDATION_WORKSPACE_KEY ?? "default";
const workspaceId = process.env.FOUNDATION_WORKSPACE_ID ?? "twk-foundation";
const defaultTenantName = process.env.FOUNDATION_WORKSPACE_NAME ?? "Default Workspace";

if (!sourceDir) {
  throw new Error("Missing --source=<snapshot-dir> or LARK_BASE_MIGRATION_DIR.");
}

const tablesDir = path.join(sourceDir, "tables");
const contactDir = path.join(sourceDir, "contact");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadTable(fileBase) {
  const table = readJson(path.join(tablesDir, `${fileBase}.records.full.json`));
  return table.rows.map((row, index) => {
    const record = { _recordId: table.recordIds[index] };
    table.fields.forEach((field, fieldIndex) => {
      record[field] = row[fieldIndex];
    });
    return record;
  });
}

function text(value) {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : item?.name ?? item?.id)).filter(Boolean).join(", ") || undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function firstOption(value) {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

function firstId(value) {
  return Array.isArray(value) && value[0]?.id ? value[0].id : undefined;
}

function ids(value) {
  return Array.isArray(value) ? value.map((item) => item?.id).filter(Boolean) : [];
}

function numberValue(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intValue(value, fallback = 0) {
  return Math.round(numberValue(value, fallback));
}

function dateValue(value) {
  const normalized = text(value);
  if (!normalized) return undefined;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return new Date(`${normalized.replace(" ", "T")}+07:00`);
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function idFor(prefix, recordId) {
  return `${prefix}-${recordId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function larkStableUserId(larkUserId) {
  return `usr-lark-${larkUserId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normalizeProjectStatus(value) {
  const status = firstOption(value);
  const map = {
    "Đã kết thúc": "completed",
    "Đang nghiệm thu": "acceptance",
    "Đang triển khai": "in_progress",
    "Đang onboard": "onboarding",
    "Đang khảo sát": "discovery",
    Pause: "paused"
  };
  return map[status] ?? "planning";
}

function normalizeWorkStatus(value) {
  const status = firstOption(value);
  const map = {
    Done: "done",
    Todo: "todo",
    "In Progress": "in_progress",
    Blocked: "blocked",
    Cancelled: "cancelled",
    Skipped: "skipped",
    Pending: "pending",
    Pause: "paused",
    "Not Started": "todo"
  };
  return map[status] ?? "todo";
}

function normalizePriority(value) {
  const priority = firstOption(value);
  const map = {
    "Quan trọng + Khẩn cấp": "urgent",
    "Quan trọng + Chưa khẩn cấp": "high",
    "Chưa quan trọng + Khẩn cấp": "medium"
  };
  return map[priority] ?? "medium";
}

function buildBody(parts) {
  return Object.entries(parts)
    .filter(([, value]) => text(value))
    .map(([label, value]) => `${label}: ${text(value)}`)
    .join("\n\n");
}

function loadContactUsers() {
  if (!fs.existsSync(contactDir)) return [];
  const users = [];
  for (const fileName of fs.readdirSync(contactDir).filter((file) => file.endsWith(".users.json") && !file.startsWith(".") && !file.startsWith("._"))) {
    const teamName = fileName.replace(".users.json", "").replaceAll("_", " ");
    const json = readJson(path.join(contactDir, fileName));
    for (const user of json.data?.items ?? []) {
      const larkUserId = user.user_id ?? user.open_id;
      if (!larkUserId) continue;
      users.push({
        larkUserId,
        openId: user.open_id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatar?.avatar_72 ?? user.avatar?.avatar_240 ?? user.avatar_url,
        employeeNo: user.employee_no ?? user.employee_number ?? user.employee_id,
        departmentCode: `CDS_${teamName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        teamName
      });
    }
  }
  return users;
}

const customers = loadTable("1.1_Customers");
const members = loadTable("1.2_Members");
const projects = loadTable("2.1_Projects");
const milestones = loadTable("2.2_Milestones");
const tasks = loadTable("2.3_Tasks");
const timeLogs = loadTable("2.4_Time_Logs");
const optimizationBacklog = loadTable("5.1_Optimization_Backlog");
const milestoneTemplates = loadTable("3.1_Milestone_Templates");
const taskTemplates = loadTable("3.2_Task_Templates");
const contactUsers = loadContactUsers();

const customersByRecord = new Map(customers.map((record) => [record._recordId, record]));
const projectsByRecord = new Map(projects.map((record) => [record._recordId, record]));
const milestonesByRecord = new Map(milestones.map((record) => [record._recordId, record]));
const membersByRecord = new Map(members.map((record) => [record._recordId, record]));

const importSummary = {
  sourceDir,
  apply,
  users: contactUsers.length,
  members: members.length,
  customers: customers.length,
  projects: projects.length,
  milestones: milestones.length,
  tasks: tasks.length,
  timeLogs: timeLogs.length,
  optimizationBacklog: optimizationBacklog.length,
  milestoneTemplates: milestoneTemplates.length,
  taskTemplates: taskTemplates.length,
  skipped: {
    projectsWithoutCustomer: projects.filter((project) => !firstId(project.Customer)).length,
    tasksWithoutProject: tasks.filter((task) => !firstId(task.Project) && !firstId(task.Milestone)).length,
    timeLogsWithoutTask: timeLogs.filter((entry) => !firstId(entry.Task)).length,
    timeLogsWithoutMember: timeLogs.filter((entry) => !firstId(entry.Member)).length
  }
};

if (!apply) {
  console.log(JSON.stringify({ dryRun: true, ...importSummary }, null, 2));
  process.exit(0);
}

async function ensureWorkspace(tx) {
  return tx.tenantWorkspace.upsert({
    where: { tenantKey_workspaceKey: { tenantKey, workspaceKey } },
    update: { name: defaultTenantName, status: "active" },
    create: { id: workspaceId, tenantKey, workspaceKey, name: defaultTenantName, status: "active", planCode: "foundation" }
  });
}

async function roleMap(tx) {
  const roles = await tx.role.findMany({ where: { code: { in: ["SALES_OWNER", "DELIVERY_LEAD", "FOUNDER_GM"] } } });
  return new Map(roles.map((role) => [role.code, role]));
}

async function ensureTeam(tx, code, name) {
  return tx.team.upsert({ where: { code }, update: { name }, create: { id: `team-${code.toLowerCase().replace(/_/g, "-")}`, code, name } });
}

async function ensureLarkUser(tx, roleByCode, source) {
  const larkUserId = source.larkUserId ?? source.openId;
  const openId = source.openId;
  const email = text(source.email)?.toLowerCase() ?? `${larkUserId}@lark.local`;
  const userIdIdentity = await tx.portalIdentity.findUnique({
    where: { provider_providerUserId_tenantKey: { provider: "lark_user_id", providerUserId: larkUserId, tenantKey } },
    include: { user: true }
  });
  const openIdIdentity = openId
    ? await tx.portalIdentity.findUnique({
        where: { provider_providerUserId_tenantKey: { provider: "lark", providerUserId: openId, tenantKey } },
        include: { user: true }
      })
    : undefined;
  const existing = userIdIdentity?.user ?? openIdIdentity?.user ?? (await tx.user.findUnique({ where: { email } }));
  const data = {
    email,
    displayName: text(source.name) ?? email,
    avatarUrl: text(source.avatarUrl),
    subjectType: "INTERNAL_USER",
    status: "ACTIVE",
    departmentCode: text(source.departmentCode)
  };
  const user = existing
    ? await tx.user.update({ where: { id: existing.id }, data })
    : await tx.user.create({ data: { id: larkStableUserId(larkUserId), ...data } });

  await tx.portalIdentity.upsert({
    where: { provider_providerUserId_tenantKey: { provider: "lark_user_id", providerUserId: larkUserId, tenantKey } },
    update: { userId: user.id },
    create: { userId: user.id, provider: "lark_user_id", providerUserId: larkUserId, tenantKey }
  });
  if (openId) {
    await tx.portalIdentity.upsert({
      where: { provider_providerUserId_tenantKey: { provider: "lark", providerUserId: openId, tenantKey } },
      update: { userId: user.id },
      create: { userId: user.id, provider: "lark", providerUserId: openId, tenantKey }
    });
  }

  const teamCode = source.departmentCode ?? "CDS";
  const team = await ensureTeam(tx, teamCode, source.teamName ?? teamCode);
  await tx.teamMember.createMany({ data: [{ teamId: team.id, userId: user.id }], skipDuplicates: true });

  const roleCodes = new Set(source.roleCodes ?? []);
  if (roleCodes.size === 0) {
    if (source.teamName === "Business Development" || source.teamName === "Marketing B2B") roleCodes.add("SALES_OWNER");
    else roleCodes.add("DELIVERY_LEAD");
  }

  for (const roleCode of roleCodes) {
    const role = roleByCode.get(roleCode);
    if (!role) continue;
    await tx.roleBinding.upsert({
      where: { userId_roleId_tenantKey_workspaceId: { userId: user.id, roleId: role.id, tenantKey, workspaceId } },
      update: { endsAt: null },
      create: { userId: user.id, roleId: role.id, tenantKey, workspaceId }
    });
  }

  return user;
}

await prisma.$transaction(
  async (tx) => {
    await ensureWorkspace(tx);
    const roles = await roleMap(tx);
    const cdsTeam = await ensureTeam(tx, "CDS", "CHUYEN DOI SO");
    const larkIdentityToUserId = new Map();
    const memberRecordToUserId = new Map();

    for (const user of contactUsers) {
      const created = await ensureLarkUser(tx, roles, user);
      larkIdentityToUserId.set(user.larkUserId, created.id);
      if (user.openId) larkIdentityToUserId.set(user.openId, created.id);
      await tx.teamMember.createMany({ data: [{ teamId: cdsTeam.id, userId: created.id }], skipDuplicates: true });
    }

    for (const member of members) {
      const larkUserRef = firstId(member["Lark User"]);
      if (!larkUserRef) continue;
      const roleText = text(member.Role) ?? "";
      const roleCodes = roleText.includes("BD") ? ["SALES_OWNER"] : ["DELIVERY_LEAD"];
      const created = await ensureLarkUser(tx, roles, {
        larkUserId: larkUserRef,
        openId: larkUserRef.startsWith("ou_") ? larkUserRef : undefined,
        name: text(member["Full Name"]) ?? text(member["Lark User"]),
        email: text(member.Email),
        departmentCode: "CDS_DX_ENABLER",
        teamName: "DX Enabler",
        roleCodes
      });
      larkIdentityToUserId.set(larkUserRef, created.id);
      memberRecordToUserId.set(member._recordId, created.id);
    }

    const assignmentCandidates = [];
    for (const milestone of milestones) {
      const projectRecordId = firstId(milestone.Project);
      const userId = larkIdentityToUserId.get(firstId(milestone.PIC));
      assignmentCandidates.push({ projectKey: projectRecordId, userId, source: "stage_pic" });
    }
    for (const task of tasks) {
      const milestone = milestonesByRecord.get(firstId(task.Milestone));
      const projectRecordId = firstId(task.Project) ?? firstId(milestone?.Project);
      const userId = memberRecordToUserId.get(firstId(task.Assignee));
      assignmentCandidates.push({ projectKey: projectRecordId, userId, source: "task_assignee" });
    }

    const sourceProjectMemberships = [];
    for (const project of projects) {
      for (const memberRecord of ids(project["DX Team"])) {
        sourceProjectMemberships.push({ projectKey: project._recordId, userId: memberRecordToUserId.get(memberRecord) });
      }
      const ownerOpenId = firstId(project["PM Owner"]);
      sourceProjectMemberships.push({
        projectKey: project._recordId,
        userId: ownerOpenId ? larkIdentityToUserId.get(ownerOpenId) : undefined
      });
    }

    const assignmentUserIds = Array.from(new Set(assignmentCandidates.map((candidate) => candidate.userId).filter(Boolean)));
    const activeAssignmentUsers = assignmentUserIds.length > 0
      ? await tx.user.findMany({ where: { id: { in: assignmentUserIds }, status: "ACTIVE" }, select: { id: true } })
      : [];
    const assignmentMemberships = buildActiveProjectAssignmentMemberships(
      assignmentCandidates,
      new Set(activeAssignmentUsers.map((user) => user.id)),
      sourceProjectMemberships
    );
    importSummary.assignmentMemberships = assignmentMemberships.length;
    importSummary.excludedAssignmentUsers = assignmentUserIds.length - activeAssignmentUsers.length;
    const assignmentMembershipsByProject = new Map();
    for (const membership of assignmentMemberships) {
      const projectMemberships = assignmentMembershipsByProject.get(membership.projectKey) ?? [];
      projectMemberships.push(membership);
      assignmentMembershipsByProject.set(membership.projectKey, projectMemberships);
    }

    const unassignedAccount = await tx.account.upsert({
      where: { workspaceId_code: { workspaceId, code: "LARK-UNASSIGNED" } },
      update: { name: "Lark Base Unassigned Customer", stage: "data_migration_review" },
      create: {
        id: "acct-lark-unassigned",
        workspaceId,
        code: "LARK-UNASSIGNED",
        name: "Lark Base Unassigned Customer",
        stage: "data_migration_review",
        commercialNote: "Created by Lark Base migration for records missing customer/account linkage."
      }
    });

    const accountByCustomerRecord = new Map();
    for (const customer of customers) {
      const ownerOpenId = firstId(customer["BD Owner"]);
      const ownerUserId = ownerOpenId ? larkIdentityToUserId.get(ownerOpenId) : undefined;
      const account = await tx.account.upsert({
        where: { workspaceId_code: { workspaceId, code: text(customer["Customer Code"]) } },
        update: {
          name: text(customer["Customer Name"]),
          stage: "active",
          picUserId: ownerUserId,
          commercialNote: buildBody({
            Industry: customer.Industry,
            Notes: customer.Notes,
            "Lark Base Record": customer._recordId
          })
        },
        create: {
          id: idFor("acct-lb", customer._recordId),
          workspaceId,
          code: text(customer["Customer Code"]),
          name: text(customer["Customer Name"]),
          stage: "active",
          picUserId: ownerUserId,
          commercialNote: buildBody({
            Industry: customer.Industry,
            Notes: customer.Notes,
            "Lark Base Record": customer._recordId
          })
        }
      });
      accountByCustomerRecord.set(customer._recordId, account.id);

      if (ownerUserId) {
        await tx.accountMember.createMany({
          data: [{ workspaceId, accountId: account.id, userId: ownerUserId, relation: "OWNER" }],
          skipDuplicates: true
        });
      }

      if (text(customer["Customer Contact"]) || text(customer["Customer Email"]) || text(customer["Customer Phone"])) {
        await tx.contact.upsert({
          where: { id: idFor("contact-lb", customer._recordId) },
          update: {
            name: text(customer["Customer Contact"]) ?? `${account.name} primary contact`,
            email: text(customer["Customer Email"])?.toLowerCase(),
            phone: text(customer["Customer Phone"]),
            role: "Primary contact"
          },
          create: {
            id: idFor("contact-lb", customer._recordId),
            workspaceId,
            accountId: account.id,
            name: text(customer["Customer Contact"]) ?? `${account.name} primary contact`,
            email: text(customer["Customer Email"])?.toLowerCase(),
            phone: text(customer["Customer Phone"]),
            role: "Primary contact"
          }
        });
      }
    }

    const projectByRecord = new Map();
    for (const project of projects) {
      const accountId = accountByCustomerRecord.get(firstId(project.Customer)) ?? unassignedAccount.id;
      const ownerOpenId = firstId(project["PM Owner"]);
      const ownerUserId = ownerOpenId ? larkIdentityToUserId.get(ownerOpenId) : undefined;
      const createdProject = await tx.project.upsert({
        where: { workspaceId_code: { workspaceId, code: text(project["Project Code"]) } },
        update: {
          accountId,
          name: text(project["Project Name"]),
          status: normalizeProjectStatus(project.Status)
        },
        create: {
          id: idFor("proj-lb", project._recordId),
          workspaceId,
          accountId,
          code: text(project["Project Code"]),
          name: text(project["Project Name"]),
          status: normalizeProjectStatus(project.Status)
        }
      });
      projectByRecord.set(project._recordId, { id: createdProject.id, accountId });

      for (const memberRecord of ids(project["DX Team"])) {
        const userId = memberRecordToUserId.get(memberRecord);
        if (!userId) continue;
        await tx.projectMember.createMany({
          data: [{ workspaceId, projectId: createdProject.id, userId, relation: "DX_TEAM" }],
          skipDuplicates: true
        });
      }
      if (ownerUserId) {
        await tx.projectMember.createMany({
          data: [{ workspaceId, projectId: createdProject.id, userId: ownerUserId, relation: "PM_OWNER" }],
          skipDuplicates: true
        });
      }
      const assignmentMembers = assignmentMembershipsByProject.get(project._recordId) ?? [];
      if (assignmentMembers.length > 0) {
        const existingMembers = await tx.projectMember.findMany({
          where: {
            workspaceId,
            projectId: createdProject.id,
            userId: { in: assignmentMembers.map((membership) => membership.userId) }
          },
          select: { userId: true }
        });
        const existingUserIds = new Set(existingMembers.map((membership) => membership.userId));
        const missingAssignmentMembers = assignmentMembers.filter((membership) => !existingUserIds.has(membership.userId));
        if (missingAssignmentMembers.length === 0) continue;
        await tx.projectMember.createMany({
          data: missingAssignmentMembers.map((membership) => ({
            workspaceId,
            projectId: createdProject.id,
            userId: membership.userId,
            relation: "ASSIGNMENT_IMPORT"
          })),
          skipDuplicates: true
        });
      }
    }

    const stageByRecord = new Map();
    const stageCountByProject = new Map();
    for (const milestone of milestones) {
      const projectRecordId = firstId(milestone.Project);
      const project = projectByRecord.get(projectRecordId);
      if (!project) continue;
      stageCountByProject.set(projectRecordId, (stageCountByProject.get(projectRecordId) ?? 0) + 1);
    }

    for (const milestone of milestones) {
      const projectRecordId = firstId(milestone.Project);
      const project = projectByRecord.get(projectRecordId);
      if (!project) continue;
      const order = intValue(milestone.Order, 0) || 999;
      const total = stageCountByProject.get(projectRecordId) ?? 1;
      const ownerUserId = larkIdentityToUserId.get(firstId(milestone.PIC));
      const stage = await tx.projectStage.upsert({
        where: { projectId_stageKey: { projectId: project.id, stageKey: idFor("ms", milestone._recordId) } },
        update: {
          activity: text(milestone["Milestone Title"]),
          sortOrder: order,
          status: normalizeWorkStatus(milestone.Status),
          ownerUserId,
          plannedStartAt: dateValue(milestone["Start Date"]),
          plannedEndAt: dateValue(milestone["Planned End"]),
          description: buildBody({ Notes: milestone.Notes, Attachments: milestone.Attachments })
        },
        create: {
          id: idFor("stage-lb", milestone._recordId),
          workspaceId,
          accountId: project.accountId,
          projectId: project.id,
          stageKey: idFor("ms", milestone._recordId),
          phase: "lark_base",
          activity: text(milestone["Milestone Title"]) ?? "Untitled milestone",
          sortOrder: order,
          cumulativePercent: Math.min(100, Math.max(0, Math.round((order / total) * 100))),
          activityPercent: 0,
          criteria: text(milestone.Notes) ?? text(milestone["Milestone Title"]) ?? "Imported from Lark Base",
          description: buildBody({ Notes: milestone.Notes, Attachments: milestone.Attachments }),
          status: normalizeWorkStatus(milestone.Status),
          ownerUserId,
          plannedStartAt: dateValue(milestone["Start Date"]),
          plannedEndAt: dateValue(milestone["Planned End"])
        }
      });
      stageByRecord.set(milestone._recordId, { id: stage.id, projectId: project.id, accountId: project.accountId });
    }

    const taskByRecord = new Map();
    for (const task of tasks) {
      const stage = stageByRecord.get(firstId(task.Milestone));
      const project = projectByRecord.get(firstId(task.Project)) ?? (stage ? { id: stage.projectId, accountId: stage.accountId } : undefined);
      if (!project) continue;
      const assigneeUserId = memberRecordToUserId.get(firstId(task.Assignee));
      const createdTask = await tx.projectTask.upsert({
        where: { id: idFor("task-lb", task._recordId) },
        update: {
          accountId: project.accountId,
          projectId: project.id,
          stageId: stage?.id,
          title: text(task["Task Title"]) ?? "Untitled task",
          description: buildBody({
            Description: task.Description,
            "Acceptance Criteria": task["Acceptance Criteria"],
            Risks: task.Risks,
            "Risk Mitigation": task["Risk Mitigation"],
            Notes: task.Notes,
            "Lark Task Code": task["Task Code"],
            "Lark Record": task._recordId
          }),
          taskType: text(task.Role)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "implementation",
          status: normalizeWorkStatus(task.Status),
          priority: normalizePriority(task.Priority),
          assigneeUserId,
          ownerUserId: assigneeUserId,
          plannedStartAt: dateValue(task["Planned Start"]),
          dueAt: dateValue(task["Planned End"]),
          estimateMinutes: Math.round(numberValue(task["Estimated Hours"], 0) * 60)
        },
        create: {
          id: idFor("task-lb", task._recordId),
          workspaceId,
          accountId: project.accountId,
          projectId: project.id,
          stageId: stage?.id,
          title: text(task["Task Title"]) ?? "Untitled task",
          description: buildBody({
            Description: task.Description,
            "Acceptance Criteria": task["Acceptance Criteria"],
            Risks: task.Risks,
            "Risk Mitigation": task["Risk Mitigation"],
            Notes: task.Notes,
            "Lark Task Code": task["Task Code"],
            "Lark Record": task._recordId
          }),
          taskType: text(task.Role)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "implementation",
          status: normalizeWorkStatus(task.Status),
          priority: normalizePriority(task.Priority),
          assigneeUserId,
          ownerUserId: assigneeUserId,
          plannedStartAt: dateValue(task["Planned Start"]),
          dueAt: dateValue(task["Planned End"]),
          completedAt: normalizeWorkStatus(task.Status) === "done" ? dateValue(task["Planned End"]) ?? new Date() : undefined,
          estimateMinutes: Math.round(numberValue(task["Estimated Hours"], 0) * 60),
          customerVisible: false
        }
      });
      taskByRecord.set(task._recordId, { id: createdTask.id, accountId: project.accountId, projectId: project.id });
    }

    for (const task of tasks) {
      const current = taskByRecord.get(task._recordId);
      const parent = taskByRecord.get(firstId(task["Parent items"]));
      if (!current || !parent) continue;
      await tx.projectTask.update({ where: { id: current.id }, data: { parentTaskId: parent.id } });
    }

    for (const entry of timeLogs) {
      const task = taskByRecord.get(firstId(entry.Task));
      const userId = memberRecordToUserId.get(firstId(entry.Member));
      if (!task || !userId) continue;
      await tx.taskTimeEntry.upsert({
        where: { id: idFor("time-lb", entry._recordId) },
        update: {
          taskId: task.id,
          accountId: task.accountId,
          projectId: task.projectId,
          userId,
          workDate: dateValue(entry.Date) ?? dateValue(entry["Logged At"]) ?? new Date(),
          minutes: Math.round(numberValue(entry.Hours, 0) * 60),
          workType: text(entry.Category)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "delivery",
          note: buildBody({ Description: entry.Description, Note: entry.Note, "Lark Record": entry._recordId })
        },
        create: {
          id: idFor("time-lb", entry._recordId),
          workspaceId,
          taskId: task.id,
          accountId: task.accountId,
          projectId: task.projectId,
          userId,
          workDate: dateValue(entry.Date) ?? dateValue(entry["Logged At"]) ?? new Date(),
          minutes: Math.round(numberValue(entry.Hours, 0) * 60),
          workType: text(entry.Category)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? "delivery",
          approvalStatus: "submitted",
          note: buildBody({ Description: entry.Description, Note: entry.Note, "Lark Record": entry._recordId })
        }
      });
    }

    for (const item of optimizationBacklog) {
      await tx.projectTask.upsert({
        where: { id: idFor("backlog-lb", item._recordId) },
        update: {
          accountId: unassignedAccount.id,
          title: text(item.Title) ?? "Untitled optimization item",
          description: buildBody({ Type: item.Type, Source: item.Source, Impact: item.Impact, Notes: item.Notes, "Lark Record": item._recordId }),
          taskType: "optimization_backlog",
          status: normalizeWorkStatus(item.Status),
          priority: normalizePriority(item.Priority),
          estimateMinutes: Math.round(numberValue(item["Effort Hours"], 0) * 60),
          dueAt: dateValue(item["Date Closed"])
        },
        create: {
          id: idFor("backlog-lb", item._recordId),
          workspaceId,
          accountId: unassignedAccount.id,
          title: text(item.Title) ?? "Untitled optimization item",
          description: buildBody({ Type: item.Type, Source: item.Source, Impact: item.Impact, Notes: item.Notes, "Lark Record": item._recordId }),
          taskType: "optimization_backlog",
          status: normalizeWorkStatus(item.Status),
          priority: normalizePriority(item.Priority),
          estimateMinutes: Math.round(numberValue(item["Effort Hours"], 0) * 60),
          plannedStartAt: dateValue(item["Date Raised"]),
          dueAt: dateValue(item["Date Closed"])
        }
      });
    }

    for (const template of milestoneTemplates) {
      await tx.projectArtifact.upsert({
        where: { code: `LARK-MS-TPL-${template._recordId}` },
        update: { name: text(template["Milestone Name"]) ?? text(template["Milestone Code"]) ?? "Milestone Template" },
        create: {
          id: idFor("artifact-ms-template-lb", template._recordId),
          workspaceId,
          accountId: unassignedAccount.id,
          code: `LARK-MS-TPL-${template._recordId}`,
          name: text(template["Milestone Name"]) ?? text(template["Milestone Code"]) ?? "Milestone Template",
          artifactType: "milestone_template",
          storageKey: `lark-base/milestone-template/${template._recordId}`,
          internalOnly: true,
          allowedRoles: ["FOUNDER_GM", "DELIVERY_LEAD"]
        }
      });
    }

    for (const template of taskTemplates) {
      await tx.projectArtifact.upsert({
        where: { code: `LARK-TASK-TPL-${template._recordId}` },
        update: { name: text(template["Task Title"]) ?? text(template["Template Code"]) ?? "Task Template" },
        create: {
          id: idFor("artifact-task-template-lb", template._recordId),
          workspaceId,
          accountId: unassignedAccount.id,
          code: `LARK-TASK-TPL-${template._recordId}`,
          name: text(template["Task Title"]) ?? text(template["Template Code"]) ?? "Task Template",
          artifactType: "task_template",
          storageKey: `lark-base/task-template/${template._recordId}`,
          internalOnly: true,
          allowedRoles: ["FOUNDER_GM", "DELIVERY_LEAD"]
        }
      });
    }

    await tx.integrationEventLog.upsert({
      where: { idempotencyKey: `lark-base-migration:KahWbVrSvaNJrKszUu2lI1MBgjf:${workspaceId}:v1` },
      update: { status: "PROCESSED", processedAt: new Date(), payload: importSummary },
      create: {
        workspaceId,
        provider: "lark_base",
        eventType: "migration.completed",
        externalEventId: `KahWbVrSvaNJrKszUu2lI1MBgjf:${workspaceId}:v1`,
        idempotencyKey: `lark-base-migration:KahWbVrSvaNJrKszUu2lI1MBgjf:${workspaceId}:v1`,
        status: "PROCESSED",
        payload: importSummary,
        processedAt: new Date()
      }
    });
  },
  { timeout: 120000, maxWait: 10000 }
);

const counts = {
  users: await prisma.user.count({ where: { identities: { some: { provider: "lark", tenantKey } } } }),
  accounts: await prisma.account.count({ where: { workspaceId } }),
  projects: await prisma.project.count({ where: { workspaceId } }),
  stages: await prisma.projectStage.count({ where: { workspaceId } }),
  tasks: await prisma.projectTask.count({ where: { workspaceId } }),
  timeEntries: await prisma.taskTimeEntry.count({ where: { workspaceId } })
};

console.log(JSON.stringify({ migrated: true, ...importSummary, counts }, null, 2));
await prisma.$disconnect();
