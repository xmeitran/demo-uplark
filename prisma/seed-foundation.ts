import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tenantKey = process.env.FOUNDATION_TENANT_KEY ?? process.env.PRODUCTION_TENANT_KEY ?? "prod";
const workspaceId = process.env.FOUNDATION_WORKSPACE_ID ?? "twk-foundation";
const workspaceKey = process.env.FOUNDATION_WORKSPACE_KEY ?? "default";
const workspaceName = process.env.FOUNDATION_WORKSPACE_NAME ?? "Default Workspace";
const adminEmail = process.env.FOUNDATION_ADMIN_EMAIL ?? process.env.PRODUCTION_ADMIN_EMAIL;
const adminName = process.env.FOUNDATION_ADMIN_NAME ?? process.env.PRODUCTION_ADMIN_NAME ?? "Founder GM";
const adminUserId = process.env.FOUNDATION_ADMIN_USER_ID ?? "usr-kha-founder";
const workspaceAdminUserIds = new Set(
  (process.env.FOUNDATION_WORKSPACE_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);
const publicOrigin = process.env.APP_PUBLIC_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://b2b-crm.mindtheoperation.com";
const strictProduction = process.env.NODE_ENV === "production" || process.env.FOUNDATION_PRODUCTION_STRICT === "true";
const foundationAdminLarkOpenIds = (process.env.FOUNDATION_ADMIN_LARK_OPEN_IDS ?? process.env.FOUNDATION_ADMIN_LARK_OPEN_ID ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const roleDefinitions = [
  ["role-founder-gm", "FOUNDER_GM", "Founder/GM", "SYSTEM", "Full product operations owner for the tenant."],
  ["role-workspace-admin", "WORKSPACE_ADMIN", "Workspace Admin", "SYSTEM", "Manages workspace users and internal controls without changing Founder ownership."],
  ["role-workspace-user", "WORKSPACE_USER", "Workspace User", "BUSINESS", "Standard internal CRM user without financial administration access."],
  ["role-sales-owner", "SALES_OWNER", "Sales Owner", "BUSINESS", "Owns accounts, leads, opportunities, and proposal readiness."],
  ["role-delivery-lead", "DELIVERY_LEAD", "Delivery Lead", "BUSINESS", "Owns implementation projects, tasks, blockers, and acceptance."],
  ["role-finance-admin", "FINANCE_ADMIN", "Finance Admin", "BUSINESS", "Owns contracts, payment schedules, invoices, AR, and financial views."],
  ["role-customer-sponsor", "CUSTOMER_SPONSOR", "Customer Sponsor", "PORTAL", "Customer-facing portal role with scoped access."],
  ["role-lark-event-service", "LARK_EVENT_SERVICE", "Lark Event Service", "SERVICE", "Service role for Lark event ingestion adapters."]
] as const;

const permissionMatrix: Record<string, Array<{ action: string; resource: string; scope: string; defaultDecision?: string }>> = {
  FOUNDER_GM: [
    { action: "LIST", resource: "ACCOUNT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "READ", resource: "ACCOUNT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "CREATE", resource: "ACCOUNT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "UPDATE", resource: "ACCOUNT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "READ", resource: "DASHBOARD", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "APPROVE", resource: "POLICY_DECISION", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "EXPORT", resource: "PAYMENT", scope: "GLOBAL", defaultDecision: "ALLOW" }
  ],
  WORKSPACE_ADMIN: [
    { action: "LIST", resource: "ACCOUNT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "READ", resource: "PROJECT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "UPDATE", resource: "PROJECT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "READ", resource: "DASHBOARD", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "APPROVE", resource: "POLICY_DECISION", scope: "GLOBAL", defaultDecision: "ALLOW" }
  ],
  WORKSPACE_USER: [
    { action: "READ", resource: "PROJECT", scope: "ASSIGNED_PROJECT", defaultDecision: "ALLOW" },
    { action: "UPDATE", resource: "TASK", scope: "ASSIGNED_PROJECT", defaultDecision: "ALLOW" },
    { action: "READ", resource: "DASHBOARD", scope: "ASSIGNED_PROJECT", defaultDecision: "ALLOW" }
  ],
  SALES_OWNER: [
    { action: "LIST", resource: "ACCOUNT", scope: "TEAM", defaultDecision: "ALLOW" },
    { action: "READ", resource: "ACCOUNT", scope: "TEAM", defaultDecision: "ALLOW" },
    { action: "CREATE", resource: "OPPORTUNITY", scope: "TEAM", defaultDecision: "ALLOW" },
    { action: "UPDATE", resource: "OPPORTUNITY", scope: "OWNED", defaultDecision: "ALLOW" },
    { action: "CREATE", resource: "PROPOSAL", scope: "OWNED", defaultDecision: "ALLOW" }
  ],
  DELIVERY_LEAD: [
    { action: "READ", resource: "PROJECT", scope: "ASSIGNED_PROJECT", defaultDecision: "ALLOW" },
    { action: "UPDATE", resource: "PROJECT", scope: "ASSIGNED_PROJECT", defaultDecision: "ALLOW" },
    { action: "CREATE", resource: "TASK", scope: "ASSIGNED_PROJECT", defaultDecision: "ALLOW" },
    { action: "UPDATE", resource: "TASK", scope: "ASSIGNED_PROJECT", defaultDecision: "ALLOW" }
  ],
  FINANCE_ADMIN: [
    { action: "READ", resource: "CONTRACT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "READ", resource: "PAYMENT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "UPDATE", resource: "PAYMENT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "EXPORT", resource: "PAYMENT", scope: "GLOBAL", defaultDecision: "ALLOW" }
  ],
  CUSTOMER_SPONSOR: [
    { action: "READ", resource: "PROJECT", scope: "CUSTOMER_PROJECT", defaultDecision: "ALLOW" },
    { action: "READ", resource: "TICKET", scope: "CUSTOMER_ACCOUNT", defaultDecision: "ALLOW" },
    { action: "CREATE", resource: "TICKET", scope: "CUSTOMER_ACCOUNT", defaultDecision: "ALLOW" },
    { action: "DOWNLOAD", resource: "ARTIFACT", scope: "CUSTOMER_PROJECT", defaultDecision: "ALLOW" }
  ],
  LARK_EVENT_SERVICE: [
    { action: "CREATE", resource: "INTEGRATION_EVENT", scope: "GLOBAL", defaultDecision: "ALLOW" },
    { action: "UPDATE", resource: "INTEGRATION_EVENT", scope: "GLOBAL", defaultDecision: "ALLOW" }
  ]
};

const teams = [
  ["team-founder-office", "FOUNDER_OFFICE", "Founder Office"],
  ["team-sales-services", "SALES_SERVICES", "Sales Services"],
  ["team-delivery-services", "DELIVERY_SERVICES", "Delivery Services"],
  ["team-finance-ops", "FINANCE_OPS", "Finance Operations"],
  ["team-customer-success", "CUSTOMER_SUCCESS", "Customer Success"]
] as const;

const fieldPolicies = [
  ["ACCOUNT", "annualValue", "FINANCIAL", ["FOUNDER_GM", "FINANCE_ADMIN"], "OMIT"],
  ["ACCOUNT", "commercialNote", "COMMERCIAL", ["FOUNDER_GM", "SALES_OWNER", "FINANCE_ADMIN"], "MASK"],
  ["PAYMENT", "amount", "FINANCIAL", ["FOUNDER_GM", "FINANCE_ADMIN"], "OMIT"],
  ["ARTIFACT", "storageUri", "CONFIDENTIAL", ["FOUNDER_GM", "DELIVERY_LEAD"], "MASK"]
] as const;

async function main() {
  if (strictProduction && !adminEmail) {
    throw new Error("FOUNDATION_ADMIN_EMAIL is required when NODE_ENV=production or FOUNDATION_PRODUCTION_STRICT=true.");
  }

  const resolvedAdminEmail = adminEmail ?? "founder.local@b2b-crm.mindtheoperation.com";

  await prisma.$transaction(async (tx) => {
    const workspace = await tx.tenantWorkspace.upsert({
      where: { tenantKey_workspaceKey: { tenantKey, workspaceKey } },
      update: {
        name: workspaceName,
        status: "active" as any,
        planCode: process.env.FOUNDATION_WORKSPACE_PLAN ?? "foundation",
        regionCode: process.env.FOUNDATION_WORKSPACE_REGION ?? undefined
      },
      create: {
        id: workspaceId,
        tenantKey,
        workspaceKey,
        name: workspaceName,
        status: "active" as any,
        planCode: process.env.FOUNDATION_WORKSPACE_PLAN ?? "foundation",
        regionCode: process.env.FOUNDATION_WORKSPACE_REGION ?? undefined
      }
    });

    const taskTypeCatalog = [
      ["PRE_SALE", "CUSTOMER_PROJECT", "pre_sale_customer", "Pre-sale / Project customer"],
      ["DELIVERY", "CUSTOMER_PROJECT", "delivery_customer", "Delivery / Project customer"],
      ["PM", "CUSTOMER_PROJECT", "pm_customer", "PM / Project customer"],
      ["PRE_SALE", "INTERNAL_PROJECT", "pre_sale_internal", "Pre-sale / Internal"],
      ["DELIVERY", "INTERNAL_PROJECT", "delivery_internal", "Delivery / Internal"],
      ["PM", "INTERNAL_PROJECT", "pm_internal", "PM / Internal"],
      ["DELIVERY", "TICKET_MAINTENANCE", "delivery_ticket", "Delivery / Ticket & maintenance"],
      ["PM", "TICKET_MAINTENANCE", "pm_ticket", "PM / Ticket & maintenance"],
      ["PM", "DAY_OFF_COMPANY", "pm_day_off", "PM / Day-off & company activity"]
    ] as const;
    for (const [layer1, layer2, code, name] of taskTypeCatalog) {
      await tx.taskTypeCatalog.upsert({
        where: { workspaceId_code: { workspaceId: workspace.id, code } },
        update: { layer1, layer2, name, active: true, source: "system" },
        create: { workspaceId: workspace.id, layer1, layer2, code, name, active: true, source: "system" }
      });
    }
    const roles = new Map<string, { id: string; code: string }>();

    for (const [id, code, name, type, description] of roleDefinitions) {
      const role = await tx.role.upsert({
        where: { code },
        update: { name, type: type as any, description },
        create: { id, code, name, type: type as any, description }
      });
      roles.set(role.code, role);

      await tx.permissionSet.deleteMany({ where: { roleId: role.id } });
      await tx.permissionSet.createMany({
        data: (permissionMatrix[role.code] ?? []).map((permission) => ({
          roleId: role.id,
          action: permission.action as any,
          resource: permission.resource as any,
          scope: permission.scope as any,
          defaultDecision: (permission.defaultDecision ?? "DENY") as any
        }))
      });
    }

    let founderOfficeId = "";
    for (const [id, code, name] of teams) {
      const team = await tx.team.upsert({
        where: { code },
        update: { name },
        create: { id, code, name }
      });
      if (code === "FOUNDER_OFFICE") {
        founderOfficeId = team.id;
      }
    }

    const [adminById, adminByEmail] = await Promise.all([
      tx.user.findUnique({ where: { id: adminUserId } }),
      tx.user.findUnique({ where: { email: resolvedAdminEmail } })
    ]);
    // The stable foundation user id is authoritative for staging restores. A
    // snapshot can already contain the configured email on another user (for
    // example after a Lark directory sync); failing the whole API boot in that
    // case leaves the isolated staging service unavailable. Keep the existing
    // id/email pair intact and only apply the configured email when it does not
    // collide with another user.
    const identityConflict = Boolean(adminById && adminByEmail && adminById.id !== adminByEmail.id);
    if (identityConflict) {
      console.warn(`foundation admin email ${resolvedAdminEmail} belongs to ${adminByEmail?.id}; using configured id ${adminUserId}.`);
    }

    const existingAdmin = adminById ?? adminByEmail;
    const adminUpdate = {
      ...(identityConflict ? {} : { email: resolvedAdminEmail }),
      displayName: adminName,
      subjectType: "INTERNAL_USER" as any,
      status: "ACTIVE" as any
    };
    const admin = existingAdmin
      ? await tx.user.update({
          where: { id: existingAdmin.id },
          data: adminUpdate
        })
      : await tx.user.create({
          data: {
            id: adminUserId,
            email: resolvedAdminEmail,
            displayName: adminName,
            subjectType: "INTERNAL_USER" as any,
            status: "ACTIVE" as any
          }
        });

    const founderRole = roles.get("FOUNDER_GM");
    if (!founderRole) {
      throw new Error("FOUNDER_GM role was not seeded.");
    }

    await tx.roleBinding.upsert({
      where: { userId_roleId_tenantKey_workspaceId: { userId: admin.id, roleId: founderRole.id, tenantKey, workspaceId: workspace.id } },
      update: { endsAt: null },
      create: { userId: admin.id, roleId: founderRole.id, tenantKey, workspaceId: workspace.id }
    });

    // The staging workspace is a controlled copy of production. Keep its
    // workspace access policy deterministic after every restore/boot: one
    // configured Founder/GM, an explicit allow-list of Workspace Admins, and
    // Workspace User for every other active internal member. Historical role
    // bindings are retained for audit; only active bindings are replaced.
    const workspaceAdminRole = roles.get("WORKSPACE_ADMIN");
    const workspaceUserRole = roles.get("WORKSPACE_USER");
    if (!workspaceAdminRole || !workspaceUserRole) {
      throw new Error("Workspace access roles were not seeded.");
    }
    workspaceAdminUserIds.delete(admin.id);
    const now = new Date();
    const activeWorkspaceBinding = {
      tenantKey,
      workspaceId: workspace.id,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }]
    };
    const governedUsers = await tx.user.findMany({
      where: {
        subjectType: "INTERNAL_USER" as any,
        roleBindings: { some: activeWorkspaceBinding }
      },
      select: {
        id: true,
        roleBindings: {
          where: activeWorkspaceBinding,
          select: { role: { select: { code: true } } }
        }
      }
    });

    for (const user of governedUsers) {
      const desiredRole = user.id === admin.id
        ? founderRole
        : workspaceAdminUserIds.has(user.id)
          ? workspaceAdminRole
          : workspaceUserRole;
      const currentRoleCodes = new Set(user.roleBindings.map((binding) => binding.role.code));
      if (currentRoleCodes.size === 1 && currentRoleCodes.has(desiredRole.code)) continue;

      await tx.roleBinding.updateMany({
        where: {
          userId: user.id,
          tenantKey,
          workspaceId: workspace.id,
          OR: [{ endsAt: null }, { endsAt: { gt: now } }]
        },
        data: { endsAt: now }
      });
      await tx.roleBinding.upsert({
        where: { userId_roleId_tenantKey_workspaceId: { userId: user.id, roleId: desiredRole.id, tenantKey, workspaceId: workspace.id } },
        update: { startsAt: now, endsAt: null },
        create: { userId: user.id, roleId: desiredRole.id, tenantKey, workspaceId: workspace.id }
      });
    }

    for (const larkOpenId of foundationAdminLarkOpenIds) {
      await tx.portalIdentity.upsert({
        where: {
          provider_providerUserId_tenantKey: {
            provider: "lark",
            providerUserId: larkOpenId,
            tenantKey
          }
        },
        update: { userId: admin.id },
        create: {
          userId: admin.id,
          provider: "lark",
          providerUserId: larkOpenId,
          tenantKey
        }
      });
    }

    await tx.teamMember.createMany({
      data: [{ teamId: founderOfficeId, userId: admin.id }],
      skipDuplicates: true
    });

    for (const [resource, fieldName, sensitivity, allowedRoles, projection] of fieldPolicies) {
      await tx.fieldPolicy.upsert({
        where: { resource_fieldName: { resource: resource as any, fieldName } },
        update: {
          sensitivity: sensitivity as any,
          allowedRoles: [...allowedRoles],
          projection: projection as any
        },
        create: {
          resource: resource as any,
          fieldName,
          sensitivity: sensitivity as any,
          allowedRoles: [...allowedRoles],
          projection: projection as any
        }
      });
    }

    await tx.integrationEventLog.upsert({
      where: { idempotencyKey: `foundation-seed:${tenantKey}:v1` },
      update: {
        status: "PROCESSED" as any,
        processedAt: new Date(),
        payload: {
          tenantKey,
          workspaceId: workspace.id,
          workspaceKey: workspace.workspaceKey,
          publicOrigin,
          adminEmail: resolvedAdminEmail,
          roles: roleDefinitions.map((role) => role[1]),
          workspaceAdminUserIds: [...workspaceAdminUserIds],
          teams: teams.map((team) => team[1]),
          seedVersion: 1
        }
      },
      create: {
        provider: "b2b-crm-saas",
        eventType: "foundation_seed_applied",
        externalEventId: `foundation-seed:${tenantKey}:v1`,
        idempotencyKey: `foundation-seed:${tenantKey}:v1`,
        status: "PROCESSED" as any,
        processedAt: new Date(),
        payload: {
          tenantKey,
          workspaceId: workspace.id,
          workspaceKey: workspace.workspaceKey,
          publicOrigin,
          adminEmail: resolvedAdminEmail,
          roles: roleDefinitions.map((role) => role[1]),
          workspaceAdminUserIds: [...workspaceAdminUserIds],
          teams: teams.map((team) => team[1]),
          seedVersion: 1
        }
      }
    });
  });

  console.log(`Foundation seed applied for tenant=${tenantKey} workspace=${workspaceKey} admin=${resolvedAdminEmail}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
