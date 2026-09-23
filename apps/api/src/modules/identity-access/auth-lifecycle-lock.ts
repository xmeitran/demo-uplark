import { activeMembershipWhere } from "./active-membership";
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

// Membership mutations lock workspace before user; credentials/session operations lock only user.
export async function lockWorkspaceAuth(tx: Prisma.TransactionClient, workspaceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace-auth:${workspaceId}`})::bigint)`;
}
export async function lockUserAuth(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user-auth:${userId}`})::bigint)`;
}

// Caller must already hold workspace lock; counts active identities, not duplicate bindings.
export async function ensureAnotherFounder(tx: Prisma.TransactionClient, workspaceId: string, userId: string) {
  const founder = await tx.roleBinding.findFirst({ where: { workspaceId, userId, ...activeMembershipWhere(), role: { code: "FOUNDER_GM" } } });
  if (!founder) return;
  const others = await tx.user.count({ where: { id: { not: userId }, status: "ACTIVE", roleBindings: { some: { workspaceId, ...activeMembershipWhere(), role: { code: "FOUNDER_GM" } } } } });
  if (!others) {
    throw new ConflictException("The workspace must retain at least one active Founder/GM");
  }
}
