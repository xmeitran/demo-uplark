import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildProjectAssignmentReferenceRows } from "./project-assignment-membership.mjs";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const workspaceId = valueArg("--workspace-id") ?? process.env.FOUNDATION_WORKSPACE_ID ?? "twk-foundation";
const requestId = valueArg("--request-id") ?? `reconcile-project-assignment-members:${workspaceId}:v1`;
const actorUserId = valueArg("--actor-user-id") ?? process.env.RECONCILE_ACTOR_USER_ID ?? undefined;
const relation = "ASSIGNMENT_RECONCILE";

function valueArg(name) {
  const prefix = `${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24)}`;
}

async function buildManifest(client) {
  const [workspace, tasks, stages, members] = await Promise.all([
    client.tenantWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, tenantKey: true, workspaceKey: true, status: true }
    }),
    client.projectTask.findMany({
      where: {
        workspaceId,
        projectId: { not: null },
        OR: [{ assigneeUserId: { not: null } }, { ownerUserId: { not: null } }]
      },
      select: {
        id: true,
        title: true,
        projectId: true,
        assigneeUserId: true,
        ownerUserId: true,
        project: { select: { code: true, name: true } }
      },
      orderBy: [{ projectId: "asc" }, { id: "asc" }]
    }),
    client.projectStage.findMany({
      where: {
        workspaceId,
        ownerUserId: { not: null }
      },
      select: {
        id: true,
        activity: true,
        projectId: true,
        ownerUserId: true,
        project: { select: { code: true, name: true } }
      },
      orderBy: [{ projectId: "asc" }, { id: "asc" }]
    }),
    client.projectMember.findMany({
      where: { workspaceId },
      select: { projectId: true, userId: true }
    })
  ]);
  if (!workspace || workspace.status !== "active") {
    throw new Error(`Active workspace not found: ${workspaceId}`);
  }

  const references = buildProjectAssignmentReferenceRows({ tasks, stages, members });
  const userIds = Array.from(new Set(references.map((reference) => reference.userId)));
  const users = userIds.length > 0
    ? await client.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, displayName: true, status: true }
      })
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const rows = references.map((reference) => ({
    ...reference,
    userEmail: usersById.get(reference.userId)?.email,
    userDisplayName: usersById.get(reference.userId)?.displayName,
    userStatus: usersById.get(reference.userId)?.status ?? "MISSING",
    taskIds: Array.from(new Set(reference.sources.filter((source) => source.kind.startsWith("task_")).map((source) => source.id))).sort(),
    stageIds: Array.from(new Set(reference.sources.filter((source) => source.kind === "stage_owner").map((source) => source.id))).sort()
  })).sort((left, right) =>
    String(left.projectCode ?? "").localeCompare(String(right.projectCode ?? ""))
      || String(left.userEmail ?? "").localeCompare(String(right.userEmail ?? ""))
      || left.userId.localeCompare(right.userId)
  );

  return {
    workspace,
    active: rows.filter((row) => row.userStatus === "ACTIVE"),
    excluded: rows.filter((row) => row.userStatus !== "ACTIVE")
  };
}

function report(manifest, extra = {}) {
  const rollbackMembershipIds = manifest.active.map((row) => stableId("pm-assignment-reconcile", workspaceId, row.projectId, row.userId));
  return {
    workspaceId,
    tenantKey: manifest.workspace.tenantKey,
    workspaceKey: manifest.workspace.workspaceKey,
    requestId,
    apply,
    activeProjectUserBackfills: manifest.active.length,
    activeTaskRows: new Set(manifest.active.flatMap((row) => row.taskIds)).size,
    activeStageRows: new Set(manifest.active.flatMap((row) => row.stageIds)).size,
    excludedProjectUsers: manifest.excluded.length,
    excludedTaskRows: new Set(manifest.excluded.flatMap((row) => row.taskIds)).size,
    excludedStageRows: new Set(manifest.excluded.flatMap((row) => row.stageIds)).size,
    active: manifest.active,
    excluded: manifest.excluded,
    rollback: {
      relation,
      membershipIds: rollbackMembershipIds,
      auditRequestId: requestId,
      note: "Delete only these membership IDs after verifying they were created by this request; preserve task ownership and all other ProjectMember relations."
    },
    ...extra
  };
}

try {
  const preview = await buildManifest(prisma);
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, ...report(preview) }, null, 2));
    process.exitCode = 0;
  } else {
    const result = await prisma.$transaction(async (tx) => {
      const manifest = await buildManifest(tx);
      const priorEvent = await tx.integrationEventLog.findUnique({ where: { idempotencyKey: requestId } });
      if (priorEvent) {
        if (manifest.active.length > 0) {
          throw new Error(`Request ${requestId} was already processed but ${manifest.active.length} active project/user pair(s) now require reconciliation. Use a new --request-id.`);
        }
        return report(manifest, {
          alreadyProcessed: true,
          priorProcessedAt: priorEvent.processedAt?.toISOString(),
          priorPayload: priorEvent.payload,
          remainingActiveProjectUsers: 0,
          remainingExcludedProjectUsers: manifest.excluded.length
        });
      }
      const createdMembershipIds = [];

      for (const row of manifest.active) {
        const membershipId = stableId("pm-assignment-reconcile", workspaceId, row.projectId, row.userId);
        await tx.projectMember.upsert({
          where: {
            workspaceId_projectId_userId_relation: {
              workspaceId,
              projectId: row.projectId,
              userId: row.userId,
              relation
            }
          },
          update: {},
          create: { id: membershipId, workspaceId, projectId: row.projectId, userId: row.userId, relation }
        });
        createdMembershipIds.push(membershipId);

        const auditId = stableId("audit-assignment-reconcile", requestId, row.projectId, row.userId);
        await tx.auditEvent.upsert({
          where: { id: auditId },
          update: {},
          create: {
            id: auditId,
            workspaceId,
            actorUserId,
            action: "PROJECT_MEMBER_RECONCILED",
            resource: "ProjectMember",
            resourceId: membershipId,
            requestId,
            before: {
              projectMember: false,
              projectId: row.projectId,
              userId: row.userId,
              taskIds: row.taskIds,
              stageIds: row.stageIds,
              sources: row.sources
            },
            after: {
              projectMember: true,
              projectId: row.projectId,
              userId: row.userId,
              relation,
              taskIds: row.taskIds,
              stageIds: row.stageIds,
              sources: row.sources
            }
          }
        });
      }

      await tx.integrationEventLog.upsert({
        where: { idempotencyKey: requestId },
        update: {
          status: "PROCESSED",
          processedAt: new Date(),
          payload: report(manifest, { createdMembershipIds })
        },
        create: {
          workspaceId,
          provider: "b2b-crm-saas",
          eventType: "project_assignment_members.reconciled",
          externalEventId: requestId,
          idempotencyKey: requestId,
          status: "PROCESSED",
          processedAt: new Date(),
          payload: report(manifest, { createdMembershipIds })
        }
      });

      const after = await buildManifest(tx);
      if (after.active.length > 0) {
        throw new Error(`Active project assignment membership reconciliation incomplete: ${after.active.length} project/user pair(s) remain.`);
      }

      return report(manifest, {
        createdMembershipIds,
        remainingActiveProjectUsers: after.active.length,
        remainingExcludedProjectUsers: after.excluded.length
      });
    }, { isolationLevel: "Serializable", timeout: 120000, maxWait: 10000 });

    console.log(JSON.stringify({ reconciled: true, ...result }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
