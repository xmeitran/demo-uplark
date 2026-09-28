import { PrismaClient } from "@prisma/client";

/**
 * Repairs legacy operational rows after the two-layer Task Type and analytics
 * completeness rules were introduced. The command is dry-run by default.
 *
 *   set -a; source .env; set +a
 *   node scripts/operations/reconcile-operational-data.mjs --apply --default-capacity=2400
 */

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const capacityArg = process.argv.find((arg) => arg.startsWith("--default-capacity="));
const defaultCapacity = capacityArg ? Number(capacityArg.split("=", 2)[1]) : null;
const workspaceId = process.env.FOUNDATION_WORKSPACE_ID ?? "twk-foundation";
const effectiveFrom = new Date(process.env.LEGACY_DATA_EFFECTIVE_FROM ?? "2026-01-01T00:00:00.000Z");

const PRE_SALE_TYPES = new Set(["bd", "blueprint", "discovery"]);
const PM_TYPES = new Set(["checklist", "dx_manager", "optimization_backlog"]);

function inferTaskType(task) {
  const oldType = String(task.taskType ?? "").trim().toLowerCase();
  const projectName = String(task.project?.name ?? "").trim().toLowerCase();
  const layer1 = PRE_SALE_TYPES.has(oldType) ? "PRE_SALE" : PM_TYPES.has(oldType) ? "PM" : "DELIVERY";
  const ticketLike = /ticket|support|maintenance|bảo trì|hỗ trợ/.test(projectName);
  const internalLike = /\[dx\]|upbase|lark partner|template|nội bộ|internal|l&d/.test(projectName);
  const layer2 = ticketLike ? "TICKET_MAINTENANCE" : internalLike ? "INTERNAL_PROJECT" : "CUSTOMER_PROJECT";
  return { layer1, layer2 };
}

async function main() {
  const tasks = await prisma.projectTask.findMany({
    where: { workspaceId },
    select: {
      id: true,
      taskType: true,
      taskTypeLayer1: true,
      taskTypeLayer2: true,
      status: true,
      completedAt: true,
      updatedAt: true,
      project: { select: { name: true } }
    }
  });

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const classifications = new Map();
  for (const task of tasks) {
    if (task.taskTypeLayer1 && task.taskTypeLayer2) continue;
    const inferred = inferTaskType(task);
    const key = `${inferred.layer1}|${inferred.layer2}`;
    const group = classifications.get(key) ?? { ...inferred, ids: [] };
    group.ids.push(task.id);
    classifications.set(key, group);
  }

  const completed = tasks.filter((task) => ["done", "completed"].includes(task.status) && !task.completedAt);
  const completedIds = completed.map((task) => task.id);
  const history = completedIds.length
    ? await prisma.taskStatusHistory.findMany({
        where: { taskId: { in: completedIds }, toStatus: { in: ["done", "completed"] } },
        orderBy: [{ taskId: "asc" }, { changedAt: "desc" }],
        select: { taskId: true, changedAt: true }
      })
    : [];
  const latestCompletion = new Map();
  for (const row of history) if (!latestCompletion.has(row.taskId)) latestCompletion.set(row.taskId, row.changedAt);

  const timeEntries = await prisma.taskTimeEntry.findMany({
    where: { workspaceId },
    select: { id: true, taskId: true, taskTypeLayer1: true, taskTypeLayer2: true }
  });
  const timeEntryGroups = new Map();
  for (const entry of timeEntries) {
    if (entry.taskTypeLayer1 && entry.taskTypeLayer2) continue;
    const task = taskMap.get(entry.taskId);
    if (!task) continue;
    const inferred = inferTaskType(task);
    const key = `${inferred.layer1}|${inferred.layer2}`;
    const group = timeEntryGroups.get(key) ?? { ...inferred, ids: [] };
    group.ids.push(entry.id);
    timeEntryGroups.set(key, group);
  }

  const users = defaultCapacity && defaultCapacity > 0
    ? await prisma.user.findMany({
        where: {
          status: "ACTIVE",
          roleBindings: {
            some: {
              workspaceId,
              startsAt: { lte: new Date() },
              OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }]
            }
          }
        },
        select: { id: true }
      })
    : [];
  const existingProfiles = users.length
    ? await prisma.workspaceMemberProfile.findMany({
        where: { workspaceId, userId: { in: users.map((user) => user.id) }, effectiveTo: null },
        select: { id: true, userId: true }
      })
    : [];
  const existingProfileIds = new Set(existingProfiles.map((profile) => profile.userId));

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    workspaceId,
    taskTypeTaskGroups: [...classifications.values()].map(({ layer1, layer2, ids }) => ({ layer1, layer2, count: ids.length })),
    taskTypeTimeEntryGroups: [...timeEntryGroups.values()].map(({ layer1, layer2, ids }) => ({ layer1, layer2, count: ids.length })),
    completedWithHistory: completed.filter((task) => latestCompletion.has(task.id)).length,
    completedUsingUpdatedAtFallback: completed.filter((task) => !latestCompletion.has(task.id)).length,
    capacityUsers: users.length,
    capacityProfilesToCreate: users.filter((user) => !existingProfileIds.has(user.id)).length,
    defaultCapacity
  }, null, 2));

  if (!apply) return;

  for (const group of classifications.values()) {
    await prisma.projectTask.updateMany({
      where: { id: { in: group.ids } },
      data: { taskTypeLayer1: group.layer1, taskTypeLayer2: group.layer2, taskTypeVersion: 2 }
    });
  }
  for (const group of timeEntryGroups.values()) {
    await prisma.taskTimeEntry.updateMany({
      where: { id: { in: group.ids } },
      data: { taskTypeLayer1: group.layer1, taskTypeLayer2: group.layer2, classificationVersion: 2 }
    });
  }

  for (const task of completed) {
    await prisma.projectTask.update({
      where: { id: task.id },
      data: { completedAt: latestCompletion.get(task.id) ?? task.updatedAt }
    });
  }

  if (defaultCapacity && defaultCapacity > 0) {
    for (const user of users) {
      const profile = existingProfiles.find((row) => row.userId === user.id);
      if (profile) {
        await prisma.workspaceMemberProfile.update({
          where: { id: profile.id },
          data: { weeklyCapacityMinutes: defaultCapacity, source: "legacy_backfill_default_8h" }
        });
      } else {
        await prisma.workspaceMemberProfile.create({
          data: {
            workspaceId,
            userId: user.id,
            weeklyCapacityMinutes: defaultCapacity,
            effectiveFrom,
            source: "legacy_backfill_default_8h"
          }
        });
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
