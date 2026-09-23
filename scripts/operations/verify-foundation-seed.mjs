import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tenantKey = process.env.FOUNDATION_TENANT_KEY ?? process.env.PRODUCTION_TENANT_KEY ?? "prod";
const workspaceKey = process.env.FOUNDATION_WORKSPACE_KEY ?? "default";
const adminEmail = process.env.FOUNDATION_ADMIN_EMAIL ?? process.env.PRODUCTION_ADMIN_EMAIL;
const strict = process.env.FOUNDATION_PRODUCTION_STRICT === "true" || process.env.NODE_ENV === "production";

const requiredRoles = [
  "FOUNDER_GM",
  "SALES_OWNER",
  "DELIVERY_LEAD",
  "FINANCE_ADMIN",
  "CUSTOMER_SPONSOR",
  "LARK_EVENT_SERVICE"
];
const requiredTeams = ["FOUNDER_OFFICE", "SALES_SERVICES", "DELIVERY_SERVICES", "FINANCE_OPS", "CUSTOMER_SUCCESS"];
const demoSignals = {
  users: ["founder@example.com", "sales.alpha@example.com", "delivery.alpha@example.com", "finance@example.com", "sponsor.alpha@example.com"],
  accounts: ["ACC-ALPHA", "ACC-BETA"],
  projects: ["PRJ-ALPHA", "PRJ-BETA"],
  tickets: ["TKT-ALPHA-001", "TKT-BETA-001"]
};

function assertMin(label, count, expectedMin) {
  if (count < expectedMin) {
    throw new Error(`${label} expected at least ${expectedMin}, got ${count}`);
  }
}

async function main() {
  if (strict && !adminEmail) {
    throw new Error("FOUNDATION_ADMIN_EMAIL is required for strict production seed verification.");
  }

  const roles = await prisma.role.findMany({
    where: { code: { in: requiredRoles } },
    select: { id: true, code: true, _count: { select: { permissionSets: true } } }
  });
  assertMin("foundation roles", roles.length, requiredRoles.length);

  const workspace = await prisma.tenantWorkspace.findUnique({
    where: { tenantKey_workspaceKey: { tenantKey, workspaceKey } }
  });
  if (!workspace || workspace.status !== "active") {
    throw new Error(`active foundation workspace ${tenantKey}/${workspaceKey} was not found`);
  }

  const missingPermissions = roles.filter((role) => role._count.permissionSets === 0).map((role) => role.code);
  if (missingPermissions.length > 0) {
    throw new Error(`roles missing permission sets: ${missingPermissions.join(", ")}`);
  }

  const teams = await prisma.team.count({ where: { code: { in: requiredTeams } } });
  assertMin("foundation teams", teams, requiredTeams.length);

  const policies = await prisma.fieldPolicy.count({
    where: {
      OR: [
        { resource: "ACCOUNT", fieldName: "annualValue" },
        { resource: "ACCOUNT", fieldName: "commercialNote" },
        { resource: "PAYMENT", fieldName: "amount" },
        { resource: "ARTIFACT", fieldName: "storageUri" }
      ]
    }
  });
  assertMin("foundation field policies", policies, 4);

  if (adminEmail) {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin) {
      throw new Error(`foundation admin ${adminEmail} was not found`);
    }

    const founderRole = roles.find((role) => role.code === "FOUNDER_GM");
    const binding = await prisma.roleBinding.findFirst({
      where: { userId: admin.id, roleId: founderRole?.id, tenantKey, workspaceId: workspace.id }
    });
    if (!binding) {
      throw new Error(`foundation admin ${adminEmail} is missing FOUNDER_GM binding for workspace ${tenantKey}/${workspaceKey}`);
    }
  }

  if (strict) {
    const [demoUsers, demoAccounts, demoProjects, demoTickets] = await Promise.all([
      prisma.user.count({ where: { email: { in: demoSignals.users } } }),
      prisma.account.count({ where: { code: { in: demoSignals.accounts } } }),
      prisma.project.count({ where: { code: { in: demoSignals.projects } } }),
      prisma.ticket.count({ where: { code: { in: demoSignals.tickets } } })
    ]);

    const demoCount = demoUsers + demoAccounts + demoProjects + demoTickets;
    if (demoCount > 0) {
      throw new Error(`strict production seed verification found ${demoCount} demo/pilot records`);
    }
  }

  console.log(JSON.stringify({ ok: true, tenantKey, workspaceKey, roles: roles.length, teams, policies, strict }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
