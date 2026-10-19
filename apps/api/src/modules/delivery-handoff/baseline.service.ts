/**
 * Persistence of the baseline (D-20, D-21: the plan — milestones, timeline, planned hours) and the D-19 estimate
 * notices. The rules are in baseline.ts.
 *
 *  - version 1 is written when G1 passes (gateHooks.captureBaseline, called inside the gate's transaction);
 *    a project without gates, or one already past G1, is locked by an Admin with a reason (captureBaseline, cause "manual");
 *  - once a version exists the plan is "locked": recordBaselineChange() is called by every approved path that changes
 *    a baselined field (stage extension, approved task timeline change, an Admin's direct plan edit) and writes the
 *    next version with the reason and a link to its cause. Nothing is written when nothing changed.
 *
 * Relation to the per-task plan approval (brd-governance, EV-061): that stays the task-level mechanism before the
 * baseline and for sub-tasks. Once it exists, every top-level task of the project is plan-locked as if approved.
 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  type BaselineCauseType,
  type BaselineSnapshot,
  type BaselineVersionSummary,
  type ProjectBaselineResponse
} from "@b2b-crm/contracts";
import { BASELINE_LAYER, baselineTotals, diffBaselines, estimateFindings } from "./baseline";
import { gateHooks } from "./gates";
import { FIRST_STAGE_ORDER } from "./project-visibility";
import { closeProjectWarnings, isWarningSuppressed, openOrRefreshProjectWarning } from "./project-warnings";

export interface BaselineCause {
  type: BaselineCauseType;
  id?: string | null;
  code?: string | null;
  reason: string;
}

export interface BaselineActor {
  userId: string | null;
  displayName?: string | null;
}

// Unit specs mock only the Prisma models they exercise; without the model there is no baseline and nothing is locked.
function hasBaselineModel(client: any) {
  return typeof client?.projectBaseline?.findFirst === "function";
}

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

/** The baselined fields of the project as they are stored right now. */
export async function loadBaselineSnapshot(client: any, workspaceId: string, projectId: string): Promise<BaselineSnapshot> {
  const [milestones, stages, tasks] = await Promise.all([
    client.projectMilestone.findMany({ where: { workspaceId, projectId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, sortOrder: true } }),
    client.projectStage.findMany({ where: { workspaceId, projectId }, orderBy: [{ milestoneId: "asc" }, { sortOrder: "asc" }], select: { id: true, milestoneId: true, activity: true, sortOrder: true, plannedStartAt: true, plannedEndAt: true, slaDays: true } }),
    client.projectTask.findMany({ where: { workspaceId, projectId, parentTaskId: null, archivedAt: null }, orderBy: [{ stageId: "asc" }, { sortOrder: "asc" }, { id: "asc" }], select: { id: true, stageId: true, title: true, plannedStartAt: true, dueAt: true, estimateMinutes: true } })
  ]);
  return {
    milestones,
    stages: stages.map((stage: any) => ({ id: stage.id, milestoneId: stage.milestoneId, name: stage.activity, sortOrder: stage.sortOrder, plannedStartAt: iso(stage.plannedStartAt), plannedEndAt: iso(stage.plannedEndAt), slaDays: stage.slaDays ?? null })),
    tasks: tasks.map((task: any) => ({ id: task.id, stageId: task.stageId ?? null, title: task.title, plannedStartAt: iso(task.plannedStartAt), dueAt: iso(task.dueAt), estimateMinutes: task.estimateMinutes ?? 0 }))
  };
}

async function latestVersion(client: any, projectId: string) {
  return client.projectBaseline.findFirst({ where: { projectId, layer: BASELINE_LAYER }, orderBy: { version: "desc" } });
}

/** D-21: the project's plan baseline exists. */
export async function isBaselineLocked(client: any, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId || !hasBaselineModel(client)) return false;
  return Boolean(await client.projectBaseline.findFirst({ where: { projectId, layer: BASELINE_LAYER }, select: { id: true } }));
}

/**
 * Writes the next version from the stored data. A snapshot equal to the latest version is skipped, so the call is
 * idempotent. Returns the version written, or undefined.
 * `onlyExisting`: do not start a baseline that has no version yet (used by changes that must not lock the plan by themselves).
 */
export async function captureBaseline(
  client: any,
  input: { workspaceId: string; projectId: string; cause: BaselineCause; actor: BaselineActor; onlyExisting?: boolean; now?: Date }
): Promise<number | undefined> {
  if (!hasBaselineModel(client)) return undefined;
  const reason = String(input.cause.reason ?? "").trim();
  if (!reason) throw new BadRequestException("Phiên bản baseline mới bắt buộc có lý do (D-21).");
  // Two writers of the same project queue here, so version numbers never collide.
  if (typeof client.$queryRaw === "function") await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-baseline:${input.projectId}`}, 0))::text`;
  const previous = await latestVersion(client, input.projectId);
  if (!previous && input.onlyExisting) return undefined;
  const snapshot = await loadBaselineSnapshot(client, input.workspaceId, input.projectId);
  if (previous && diffBaselines(previous.snapshot as BaselineSnapshot, snapshot).length === 0) return undefined;
  const version = (previous?.version ?? 0) + 1;
  await client.projectBaseline.create({
    data: {
      workspaceId: input.workspaceId, projectId: input.projectId, layer: BASELINE_LAYER, version, snapshot: JSON.parse(JSON.stringify(snapshot)), reason,
      causeType: input.cause.type, causeId: input.cause.id ?? null, causeCode: input.cause.code ?? null,
      createdByUserId: input.actor.userId, createdByName: input.actor.displayName ?? null, ...(input.now ? { createdAt: input.now } : {})
    }
  });
  return version;
}

/** After an approved change of a baselined field: the next version of a baseline that is already locked. */
export function recordBaselineChange(client: any, input: { workspaceId: string; projectId: string; cause: BaselineCause; actor: BaselineActor }) {
  return captureBaseline(client, { ...input, onlyExisting: true });
}

function mapVersion(row: any, previous: any | undefined): BaselineVersionSummary {
  const snapshot = row.snapshot as BaselineSnapshot;
  return {
    id: row.id, version: row.version, reason: row.reason, causeType: row.causeType, causeId: row.causeId ?? undefined, causeCode: row.causeCode ?? undefined,
    createdByName: row.createdByName ?? undefined, createdAt: new Date(row.createdAt).toISOString(),
    diff: previous ? diffBaselines(previous.snapshot as BaselineSnapshot, snapshot) : [], totals: baselineTotals(snapshot)
  };
}

/** The version in force and the whole history (newest first) with the diff of each version against the one before it. */
export async function getProjectBaseline(client: any, workspaceId: string, projectId: string, actor: { isPm: boolean }): Promise<ProjectBaselineResponse> {
  const versions: any[] = hasBaselineModel(client) ? await client.projectBaseline.findMany({ where: { workspaceId, projectId, layer: BASELINE_LAYER }, orderBy: { version: "asc" } }) : [];
  const history = versions.map((row, index) => mapVersion(row, versions[index - 1])).reverse();
  const last = versions[versions.length - 1];
  return { projectId, locked: Boolean(last), current: last ? { ...history[0], snapshot: last.snapshot as BaselineSnapshot } : null, history, canCapture: actor.isPm };
}

/** Diff between any two versions (`from` < `to`). */
export async function diffBaselineVersions(client: any, workspaceId: string, projectId: string, from: number, to: number) {
  const rows: any[] = await client.projectBaseline.findMany({ where: { workspaceId, projectId, layer: BASELINE_LAYER, version: { in: [from, to] } } });
  const before = rows.find((row) => row.version === from);
  const after = rows.find((row) => row.version === to);
  if (!before || !after) throw new BadRequestException("Không tìm thấy phiên bản baseline cần so sánh.");
  return { from, to, diff: diffBaselines(before.snapshot as BaselineSnapshot, after.snapshot as BaselineSnapshot) };
}

/** An Admin (PM or Dx Director) locks the baseline of a project that has none, or re-locks it after changes, with a reason. */
export async function captureBaselineManually(ctx: { prisma: any; principal: { workspaceId: string; subjectId: string; displayName?: string }; actor: { isPm: boolean } }, projectId: string, reason: unknown) {
  if (!ctx.actor.isPm) throw new ForbiddenException("Chỉ Admin (PM hoặc Dx Director) mới được khóa hoặc cập nhật baseline (D-21).");
  await ctx.prisma.$transaction((tx: any) => captureBaseline(tx, {
    workspaceId: ctx.principal.workspaceId, projectId, cause: { type: "manual", reason: String(reason ?? "") }, actor: { userId: ctx.principal.subjectId, displayName: ctx.principal.displayName }
  }));
  return getProjectBaseline(ctx.prisma, ctx.principal.workspaceId, projectId, ctx.actor);
}

/**
 * 8.1, G1: "baseline kế hoạch khóa (D-20)". Runs inside the gate's transaction when the gate passes
 * (customer confirmed, or opened by exception), so a gate never passes without its baseline.
 */
gateHooks.captureBaseline = async (input) => {
  const { gate, tx, actor } = input as typeof input & { tx?: any; actor?: BaselineActor };
  if (gate?.code !== "G1" || !tx) return;
  await captureBaseline(tx, {
    workspaceId: gate.workspaceId, projectId: gate.projectId,
    cause: { type: "gate", id: gate.id, code: "G1", reason: gate.status === "exception" ? "G1 mở theo ngoại lệ: khóa baseline kế hoạch" : "G1 được duyệt: khóa baseline kế hoạch" },
    actor: actor ?? { userId: gate.customerRecordedByUserId ?? gate.exceptionByUserId ?? gate.decidedByUserId ?? null }
  });
};

/**
 * D-19 (Ghi nhận + Nhắc): keeps one open project warning per task whose sub-tasks plan more hours than the task,
 * owned by the PM, and closes it when the plan fits again (a notice left open for a retired line item is closed too). Never throws into the caller's request.
 */
export async function syncEstimateNotices(client: any, workspaceId: string, projectId: string | null | undefined, actorUserId: string | null) {
  if (!projectId || typeof client?.projectWarning?.findMany !== "function" || typeof client?.projectTask?.findMany !== "function") return;
  try {
    const [tasks, open, firstStage] = await Promise.all([
      client.projectTask.findMany({ where: { workspaceId, projectId, archivedAt: null }, select: { id: true, title: true, parentTaskId: true, estimateMinutes: true } }),
      client.projectWarning.findMany({ where: { projectId, typeCode: "D-19", status: "open" }, select: { id: true, dedupeKey: true } }),
      client.projectStage.findFirst({ where: { workspaceId, projectId }, orderBy: FIRST_STAGE_ORDER, select: { ownerUserId: true } })
    ]);
    const findings = estimateFindings(tasks);
    const wanted = new Set(findings.map((finding) => finding.dedupeKey));
    for (const warning of open) if (!wanted.has(warning.dedupeKey)) await closeProjectWarnings(client, { projectId, id: warning.id }, actorUserId, "Giờ dự kiến các sub-task đã nằm trong giờ của task");
    for (const finding of findings) {
      if (await isWarningSuppressed(client, projectId, finding.dedupeKey)) continue;
      await openOrRefreshProjectWarning(client, { workspaceId, projectId, typeCode: "D-19", severity: "low", ...finding, ownerUserId: firstStage?.ownerUserId ?? null, actorUserId });
    }
  } catch (error) {
    console.error("D-19 estimate notice sync failed", error);
  }
}
