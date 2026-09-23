import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
require("reflect-metadata");
const { PrismaClient } = require("@prisma/client");
const { hashPassword } = require("./dist/modules/identity-access/auth-security.service.js");

const database = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (process.env.NODE_ENV === "production" || process.env.CRM_LOCAL_AUTH_RUNTIME !== "true"
  || !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
  || !/(?:^|_)local$/.test(database.pathname.slice(1))) {
  throw new Error("Refusing credential bootstrap outside an explicitly isolated local database");
}
const email = process.env.FOUNDATION_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.CRM_LOCAL_ADMIN_PASSWORD;
if (!email || !password) throw new Error("FOUNDATION_ADMIN_EMAIL and CRM_LOCAL_ADMIN_PASSWORD are required");
const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email }, include: { roleBindings: { include: { role: true } } } });
  const binding = user?.roleBindings.find(item => item.role.code === "FOUNDER_GM" && item.endsAt === null
    && item.tenantKey === process.env.FOUNDATION_TENANT_KEY && item.workspaceId === process.env.FOUNDATION_WORKSPACE_ID);
  if (!user || user.status !== "ACTIVE" || !binding) {
    throw new Error("Seed an active local Founder in the intended workspace before assigning a password");
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, emailVerifiedAt: new Date() } }),
    prisma.portalSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
  ]);
  console.log(`Local password credential configured for ${email}; previous local sessions revoked.`);
} finally {
  await prisma.$disconnect();
}
