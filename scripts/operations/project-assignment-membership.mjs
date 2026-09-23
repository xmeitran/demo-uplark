export function buildActiveProjectAssignmentMemberships(assignments, activeUserIds, existingMemberships = []) {
  const active = activeUserIds instanceof Set ? activeUserIds : new Set(activeUserIds);
  const existingKeys = new Set(existingMemberships.map((membership) => {
    return `${cleanString(membership.projectKey) ?? ""}\u0000${cleanString(membership.userId) ?? ""}`;
  }));
  const memberships = new Map();

  for (const assignment of assignments) {
    const projectKey = cleanString(assignment.projectKey);
    const userId = cleanString(assignment.userId);
    if (!projectKey || !userId || !active.has(userId) || existingKeys.has(`${projectKey}\u0000${userId}`)) continue;

    const key = `${projectKey}\u0000${userId}`;
    const current = memberships.get(key) ?? {
      projectKey,
      userId,
      sources: new Set()
    };
    const source = cleanString(assignment.source);
    if (source) current.sources.add(source);
    memberships.set(key, current);
  }

  return Array.from(memberships.values())
    .map((membership) => ({
      projectKey: membership.projectKey,
      userId: membership.userId,
      sources: Array.from(membership.sources).sort()
    }))
    .sort((left, right) => left.projectKey.localeCompare(right.projectKey) || left.userId.localeCompare(right.userId));
}

export function buildProjectAssignmentReferenceRows({ tasks = [], stages = [], members = [] }) {
  const memberKeys = new Set(members.map((member) => `${member.projectId}\u0000${member.userId}`));
  const references = new Map();

  const addReference = ({ projectId, projectCode, projectName, userId, kind, sourceId, label }) => {
    if (!projectId || !userId || memberKeys.has(`${projectId}\u0000${userId}`)) return;
    const key = `${projectId}\u0000${userId}`;
    const reference = references.get(key) ?? {
      projectId,
      projectCode,
      projectName,
      userId,
      sources: []
    };
    const sourceKey = `${kind}\u0000${sourceId}`;
    if (!reference.sources.some((source) => `${source.kind}\u0000${source.id}` === sourceKey)) {
      reference.sources.push({ kind, id: sourceId, label });
    }
    references.set(key, reference);
  };

  for (const task of tasks) {
    addReference({
      projectId: task.projectId,
      projectCode: task.project?.code,
      projectName: task.project?.name,
      userId: task.assigneeUserId,
      kind: "task_assignee",
      sourceId: task.id,
      label: task.title
    });
    addReference({
      projectId: task.projectId,
      projectCode: task.project?.code,
      projectName: task.project?.name,
      userId: task.ownerUserId,
      kind: "task_owner",
      sourceId: task.id,
      label: task.title
    });
  }

  for (const stage of stages) {
    addReference({
      projectId: stage.projectId,
      projectCode: stage.project?.code,
      projectName: stage.project?.name,
      userId: stage.ownerUserId,
      kind: "stage_owner",
      sourceId: stage.id,
      label: stage.activity
    });
  }

  return Array.from(references.values())
    .map((reference) => ({
      ...reference,
      sources: reference.sources.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id))
    }))
    .sort((left, right) =>
      String(left.projectCode ?? "").localeCompare(String(right.projectCode ?? ""))
        || left.userId.localeCompare(right.userId)
    );
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
