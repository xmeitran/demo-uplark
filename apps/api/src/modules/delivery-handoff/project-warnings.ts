/** EV-065: the shared project warning record. Callers pass their transaction client so a warning commits with the change that caused it. */
export interface OpenProjectWarningInput {
  workspaceId: string;
  projectId: string;
  dedupeKey: string;
  typeCode: string;
  title: string;
  detail?: string;
  severity?: string;
  milestoneId?: string | null;
  stageId?: string | null;
  taskId?: string | null;
  ownerUserId?: string | null;
  dueAt?: Date | null;
  actorUserId?: string | null;
}

// Unit specs mock only the Prisma models they exercise; without the warning model the triggers are no-ops.
function hasWarningModel(client: any) {
  return typeof client?.projectWarning?.findFirst === "function";
}

/** Idempotent: an open warning with the same dedupe key is refreshed, never duplicated. */
export async function openOrRefreshProjectWarning(client: any, input: OpenProjectWarningInput) {
  if (!hasWarningModel(client)) return null;
  const { actorUserId, workspaceId, projectId, dedupeKey, ...fields } = input;
  // Concurrent openers of the same key queue here; inside a transaction the lock is held until commit,
  // so the second one sees the first one's row instead of hitting the partial unique index.
  if (typeof client.$queryRaw === "function") {
    await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-warning:${projectId}:${dedupeKey}`}, 0))::text`;
  }
  const existing = await client.projectWarning.findFirst({ where: { projectId, dedupeKey, status: "open" } });
  if (!existing) {
    try {
      return await client.projectWarning.create({
        data: { workspaceId, projectId, dedupeKey, ...fields, openedByUserId: actorUserId ?? null, events: { create: { action: "opened", actorUserId: actorUserId ?? null, note: fields.detail } } }
      });
    } catch (error) {
      // ProjectWarning_open_dedupe_key: another request opened it first, which is the state we wanted.
      if ((error as { code?: string })?.code === "P2002") return null;
      throw error;
    }
  }
  const changed = existing.title !== fields.title || (existing.detail ?? undefined) !== fields.detail || (fields.severity !== undefined && existing.severity !== fields.severity);
  return client.projectWarning.update({
    where: { id: existing.id },
    data: { ...fields, ...(changed ? { events: { create: { action: "refreshed", actorUserId: actorUserId ?? null, note: fields.detail } } } : {}) }
  });
}

/** Closes every open warning matching the key (or key prefix). Closed rows stay queryable. */
export async function closeProjectWarnings(
  client: any,
  where: { projectId: string; dedupeKey?: string | { in: string[] }; id?: string },
  actorUserId: string | null,
  reason: string,
  action: "closed" | typeof MANUAL_CLOSE_ACTION = "closed"
) {
  if (!hasWarningModel(client)) return 0;
  const open = await client.projectWarning.findMany({ where: { ...where, status: "open" }, select: { id: true } });
  const closedAt = new Date();
  for (const warning of open) {
    await client.projectWarning.update({
      where: { id: warning.id },
      data: { status: "closed", closedAt, closedByUserId: actorUserId, closeReason: reason, events: { create: { action, actorUserId, note: reason, at: closedAt } } }
    });
  }
  return open.length;
}

/** Event action of a closure a person made by hand; automatic closures write "closed". */
export const MANUAL_CLOSE_ACTION = "closed_manually";
/** Appended to a manually closed warning once its cause went away, so the next occurrence may open a new warning. */
export const REARM_ACTION = "condition_cleared";

/** A warning someone closed by hand stays closed while its cause is unchanged; it is re-armed only after the cause cleared once. */
export function isSuppressedByManualClose(warning: { status: string; events?: ReadonlyArray<{ action: string }> } | null | undefined): boolean {
  if (!warning || warning.status !== "closed") return false;
  return warning.events?.[warning.events.length - 1]?.action === MANUAL_CLOSE_ACTION;
}

async function latestWarning(client: any, projectId: string, dedupeKey: string) {
  return client.projectWarning.findFirst({ where: { projectId, dedupeKey }, orderBy: { openedAt: "desc" }, include: { events: { orderBy: { at: "asc" } } } });
}

export async function isWarningSuppressed(client: any, projectId: string, dedupeKey: string) {
  return hasWarningModel(client) && isSuppressedByManualClose(await latestWarning(client, projectId, dedupeKey));
}

/** Call when the cause of a warning is gone (e.g. an owner was assigned) to lift a manual suppression. */
export async function rearmManuallyClosedWarning(client: any, projectId: string, dedupeKey: string, actorUserId: string | null, note: string) {
  if (!hasWarningModel(client)) return;
  const latest = await latestWarning(client, projectId, dedupeKey);
  if (!isSuppressedByManualClose(latest)) return;
  await client.projectWarning.update({ where: { id: latest.id }, data: { events: { create: { action: REARM_ACTION, actorUserId, note } } } });
}

export function mapProjectWarning(warning: any) {
  const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : undefined);
  return {
    id: warning.id,
    projectId: warning.projectId,
    milestoneId: warning.milestoneId ?? undefined,
    stageId: warning.stageId ?? undefined,
    taskId: warning.taskId ?? undefined,
    typeCode: warning.typeCode,
    severity: warning.severity,
    title: warning.title,
    detail: warning.detail ?? undefined,
    status: warning.status,
    ownerUserId: warning.ownerUserId ?? undefined,
    dueAt: iso(warning.dueAt),
    openedAt: new Date(warning.openedAt).toISOString(),
    openedByUserId: warning.openedByUserId ?? undefined,
    closedAt: iso(warning.closedAt),
    closedByUserId: warning.closedByUserId ?? undefined,
    closeReason: warning.closeReason ?? undefined,
    events: (warning.events ?? []).map((event: any) => ({
      id: event.id,
      action: event.action,
      actorUserId: event.actorUserId ?? undefined,
      note: event.note ?? undefined,
      at: new Date(event.at).toISOString()
    }))
  };
}
