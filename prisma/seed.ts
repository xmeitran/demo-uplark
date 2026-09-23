import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === "production";
const demoTenantKey = process.env.DEMO_TENANT_KEY ?? "pilot";
const demoWorkspaceId = process.env.DEMO_WORKSPACE_ID ?? "twk-pilot-default";
const demoWorkspaceKey = process.env.DEMO_WORKSPACE_KEY ?? "default";
const demoWorkspaceName = process.env.DEMO_WORKSPACE_NAME ?? "Pilot Workspace";
const demoWorkspacePlan = process.env.DEMO_WORKSPACE_PLAN ?? "pilot";
const legacyDefaultWorkspaceId = "twk-foundation";

if (isProduction && process.env.ALLOW_DEMO_SEED_IN_PRODUCTION !== "true") {
  throw new Error(
    "prisma/seed.ts contains demo/pilot data. Use `pnpm db:seed:foundation` for production, or set ALLOW_DEMO_SEED_IN_PRODUCTION=true intentionally."
  );
}

export async function seedDemoData(client: PrismaClient) {
  const workspace = await client.tenantWorkspace.upsert({
    where: { tenantKey_workspaceKey: { tenantKey: demoTenantKey, workspaceKey: demoWorkspaceKey } },
    update: { name: demoWorkspaceName, status: "active", planCode: demoWorkspacePlan },
    create: {
      id: demoWorkspaceId,
      tenantKey: demoTenantKey,
      workspaceKey: demoWorkspaceKey,
      name: demoWorkspaceName,
      status: "active",
      planCode: demoWorkspacePlan
    }
  });

  // Older versions of this fixture omitted workspaceId on workspace-scoped
  // records, so Prisma silently used the schema default (twk-foundation).
  // Move only the known demo fixtures; never rewrite arbitrary foundation data.
  await client.$transaction([
    client.accountMember.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        accountId: "acc-alpha",
        OR: [
          { userId: "usr-sales-alpha", relation: "OWNER" as any },
          { userId: "usr-founder", relation: "COLLABORATOR" as any },
          { userId: "usr-delivery-alpha", relation: "DELIVERY_LEAD" as any },
          { userId: "usr-finance", relation: "FINANCE_OWNER" as any }
        ]
      },
      data: { workspaceId: workspace.id }
    }),
    client.lead.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: { in: ["lead-alpha-crm", "lead-beta-managed-services"] }
      },
      data: { workspaceId: workspace.id }
    }),
    client.customerAccessGrant.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        userId: "usr-customer-alpha",
        accountId: "acc-alpha",
        projectId: null,
        scope: "CUSTOMER_ACCOUNT" as any
      },
      data: { id: "grant-alpha-account", workspaceId: workspace.id }
    }),
    client.customerAccessGrant.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        userId: "usr-customer-alpha",
        accountId: null,
        projectId: "prj-alpha",
        scope: "CUSTOMER_PROJECT" as any
      },
      data: { id: "grant-alpha-project", workspaceId: workspace.id }
    }),
    client.projectMember.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        projectId: "prj-alpha",
        OR: [
          { userId: "usr-sales-alpha", relation: "sales_owner" },
          { userId: "usr-delivery-alpha", relation: "delivery_lead" },
          { userId: "usr-founder", relation: "executive_sponsor" }
        ]
      },
      data: { workspaceId: workspace.id }
    }),
    client.opportunity.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        OR: [
          { accountId: "acc-alpha", title: "CRM/ERP phase 1" },
          { accountId: "acc-beta", title: "Managed services expansion" }
        ]
      },
      data: { workspaceId: workspace.id }
    }),
    client.opportunityStageHistory.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: { in: ["hist-alpha-closed-won", "hist-beta-proposal"] }
      },
      data: { workspaceId: workspace.id }
    }),
    client.opportunityActivity.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: { in: ["act-alpha-kickoff-evidence", "act-beta-proposal-revision"] }
      },
      data: { workspaceId: workspace.id }
    }),
    client.taskStatusHistory.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: {
          in: [
            "taskhist-alpha-kickoff-created",
            "taskhist-alpha-kickoff-done",
            "taskhist-alpha-process-map-start",
            "taskhist-alpha-customer-data-blocked"
          ]
        }
      },
      data: { workspaceId: workspace.id }
    }),
    client.taskTimeEntry.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: {
          in: [
            "time-alpha-kickoff-delivery-1",
            "time-alpha-kickoff-sales-1",
            "time-alpha-process-map-delivery-1"
          ]
        }
      },
      data: { workspaceId: workspace.id }
    }),
    client.resourceAllocation.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "resalloc-alpha-delivery-implementation" },
      data: { workspaceId: workspace.id }
    }),
    client.projectBudget.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "budget-alpha-phase1" },
      data: { workspaceId: workspace.id }
    }),
    client.projectCost.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "cost-alpha-lark-setup" },
      data: { workspaceId: workspace.id }
    }),
    client.proposalPackage.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "prop-alpha-phase1-v1" },
      data: { workspaceId: workspace.id }
    }),
    client.proposalDocument.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: {
          in: [
            "doc-alpha-proposal-v1",
            "doc-alpha-sow-v1",
            "doc-alpha-quotation-v1",
            "doc-alpha-payment-v1"
          ]
        }
      },
      data: { workspaceId: workspace.id }
    }),
    client.dealApprovalRequest.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "appr-alpha-readiness" },
      data: { workspaceId: workspace.id }
    }),
    client.dealApprovalDecision.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "appr-alpha-readiness-decision" },
      data: { workspaceId: workspace.id }
    }),
    client.contract.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "contract-alpha-phase1" },
      data: { workspaceId: workspace.id }
    }),
    client.contractDocument.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "contract-doc-alpha-pdf-v1" },
      data: { workspaceId: workspace.id }
    }),
    client.paymentSchedule.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "pay-alpha-phase1" },
      data: { workspaceId: workspace.id }
    }),
    client.paymentMilestone.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: { in: ["payms-alpha-kickoff", "payms-alpha-golive"] }
      },
      data: { workspaceId: workspace.id }
    }),
    client.invoice.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "inv-alpha-kickoff" },
      data: { workspaceId: workspace.id }
    }),
    client.invoicePayment.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "invpay-alpha-kickoff-partial" },
      data: { workspaceId: workspace.id }
    }),
    client.arFollowUp.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "ar-alpha-kickoff-follow-up" },
      data: { workspaceId: workspace.id }
    }),
    client.paymentEvidence.updateMany({
      where: { workspaceId: legacyDefaultWorkspaceId, id: "payev-alpha-kickoff-invoice-file" },
      data: { workspaceId: workspace.id }
    }),
    client.ticket.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: { in: ["tkt-alpha", "tkt-beta"] }
      },
      data: { workspaceId: workspace.id }
    }),
    client.projectArtifact.updateMany({
      where: {
        workspaceId: legacyDefaultWorkspaceId,
        id: { in: ["art-alpha-sow", "art-beta-internal"] }
      },
      data: { workspaceId: workspace.id }
    })
  ]);

  const roles = await Promise.all(
    [
      ["role-founder-gm", "FOUNDER_GM", "Founder/GM", "SYSTEM"],
      ["role-sales-owner", "SALES_OWNER", "Sales Owner", "BUSINESS"],
      ["role-delivery-lead", "DELIVERY_LEAD", "Delivery Lead", "BUSINESS"],
      ["role-finance-admin", "FINANCE_ADMIN", "Finance Admin", "BUSINESS"],
      ["role-customer-sponsor", "CUSTOMER_SPONSOR", "Customer Sponsor", "PORTAL"],
      ["role-lark-event-service", "LARK_EVENT_SERVICE", "Lark Event Service", "SERVICE"]
    ].map(([id, code, name, type]) =>
      client.role.upsert({
        where: { code },
        update: { name, type: type as any },
        create: { id, code, name, type: type as any }
      })
    )
  );

  const founderRole = roles.find((role) => role.code === "FOUNDER_GM")!;
  const salesRole = roles.find((role) => role.code === "SALES_OWNER")!;
  const deliveryRole = roles.find((role) => role.code === "DELIVERY_LEAD")!;
  const financeRole = roles.find((role) => role.code === "FINANCE_ADMIN")!;
  const customerRole = roles.find((role) => role.code === "CUSTOMER_SPONSOR")!;

  const [founder, khaFounder, sales, delivery, finance, customer] = await Promise.all([
    client.user.upsert({
      where: { email: "founder@example.com" },
      update: { id: "usr-founder" },
      create: { id: "usr-founder", email: "founder@example.com", displayName: "Founder GM" }
    }),
    client.user.upsert({
      where: { email: "kha.nguyen@example.com" },
      update: { id: "usr-kha-founder" },
      create: { id: "usr-kha-founder", email: "kha.nguyen@example.com", displayName: "Kha Nguyen" }
    }),
    client.user.upsert({
      where: { email: "sales.alpha@example.com" },
      update: { id: "usr-sales-alpha" },
      create: { id: "usr-sales-alpha", email: "sales.alpha@example.com", displayName: "Sales Alpha" }
    }),
    client.user.upsert({
      where: { email: "delivery.alpha@example.com" },
      update: { id: "usr-delivery-alpha" },
      create: { id: "usr-delivery-alpha", email: "delivery.alpha@example.com", displayName: "Delivery Alpha" }
    }),
    client.user.upsert({
      where: { email: "finance@example.com" },
      update: { id: "usr-finance" },
      create: { id: "usr-finance", email: "finance@example.com", displayName: "Finance Admin" }
    }),
    client.user.upsert({
      where: { email: "sponsor.alpha@example.com" },
      update: { id: "usr-customer-alpha", subjectType: "PORTAL_USER" as any },
      create: {
        id: "usr-customer-alpha",
        email: "sponsor.alpha@example.com",
        displayName: "Customer Sponsor Alpha",
        subjectType: "PORTAL_USER" as any
      }
    })
  ]);

  const team = await client.team.upsert({
    where: { code: "SALES_SERVICES" },
    update: {},
    create: { id: "team-sales-services", code: "SALES_SERVICES", name: "Sales Services" }
  });

  const [alpha, beta] = await Promise.all([
    client.account.upsert({
      where: { workspaceId_code: { workspaceId: workspace.id, code: "ACC-ALPHA" } },
      update: {},
      create: {
        id: "acc-alpha",
        workspaceId: workspace.id,
        code: "ACC-ALPHA",
        name: "Alpha Manufacturing",
        stage: "implementation",
        ownerTeamId: team.id,
        annualValue: "350000000",
        commercialNote: "Strategic pilot account"
      }
    }),
    client.account.upsert({
      where: { workspaceId_code: { workspaceId: workspace.id, code: "ACC-BETA" } },
      update: {},
      create: {
        id: "acc-beta",
        workspaceId: workspace.id,
        code: "ACC-BETA",
        name: "Beta Retail",
        stage: "proposal",
        ownerTeamId: team.id,
        annualValue: "180000000",
        commercialNote: "Competitive deal"
      }
    })
  ]);

  await Promise.all([
    ...[
      { userId: founder.id, roleId: founderRole.id },
      { userId: khaFounder.id, roleId: founderRole.id },
      { userId: sales.id, roleId: salesRole.id },
      { userId: delivery.id, roleId: deliveryRole.id },
      { userId: finance.id, roleId: financeRole.id },
      { userId: customer.id, roleId: customerRole.id }
    ].map((binding) =>
      client.roleBinding.upsert({
        where: { userId_roleId_tenantKey_workspaceId: { userId: binding.userId, roleId: binding.roleId, tenantKey: demoTenantKey, workspaceId: workspace.id } },
        update: { endsAt: null },
        create: { ...binding, tenantKey: demoTenantKey, workspaceId: workspace.id }
      })
    ),
    client.accountMember.createMany({
      data: [
        { workspaceId: workspace.id, accountId: alpha.id, userId: sales.id, relation: "OWNER" as any },
        { workspaceId: workspace.id, accountId: alpha.id, userId: founder.id, relation: "COLLABORATOR" as any },
        { workspaceId: workspace.id, accountId: alpha.id, userId: delivery.id, relation: "DELIVERY_LEAD" as any },
        { workspaceId: workspace.id, accountId: alpha.id, userId: finance.id, relation: "FINANCE_OWNER" as any }
      ],
      skipDuplicates: true
    }),
    client.fieldPolicy.createMany({
      data: [
        {
          resource: "ACCOUNT" as any,
          fieldName: "annualValue",
          sensitivity: "FINANCIAL" as any,
          allowedRoles: ["FOUNDER_GM", "FINANCE_ADMIN"],
          projection: "OMIT" as any
        },
        {
          resource: "ACCOUNT" as any,
          fieldName: "commercialNote",
          sensitivity: "COMMERCIAL" as any,
          allowedRoles: ["FOUNDER_GM", "SALES_OWNER", "FINANCE_ADMIN"],
          projection: "MASK" as any
        }
      ],
      skipDuplicates: true
    })
  ]);

  await client.contact.createMany({
    data: [
      {
        id: "ct-alpha-founder",
        workspaceId: workspace.id,
        accountId: alpha.id,
        name: "Linh Tran",
        email: "linh.alpha@example.com",
        phone: "+84900000001",
        role: "Founder",
        influence: "economic_buyer"
      },
      {
        id: "ct-beta-ops",
        workspaceId: workspace.id,
        accountId: beta.id,
        name: "Minh Pham",
        email: "minh.beta@example.com",
        phone: "+84900000002",
        role: "Operations lead",
        influence: "champion"
      }
    ],
    skipDuplicates: true
  });

  await client.lead.createMany({
    data: [
      {
        id: "lead-alpha-crm",
        workspaceId: workspace.id,
        accountId: alpha.id,
        contactId: "ct-alpha-founder",
        companyName: "Alpha Manufacturing",
        contactName: "Linh Tran",
        contactEmail: "linh.alpha@example.com",
        source: "founder_network",
        painPoint: "Manual partner sales tracking",
        serviceFit: "CRM/ERP implementation",
        timeline: "this_quarter",
        budgetRange: "300m-400m",
        authority: "founder",
        status: "opportunity_created",
        ownerUserId: sales.id,
        qualificationSummary: "Qualified for CRM/ERP phase 1"
      },
      {
        id: "lead-beta-managed-services",
        workspaceId: workspace.id,
        accountId: beta.id,
        contactId: "ct-beta-ops",
        companyName: "Beta Retail",
        contactName: "Minh Pham",
        contactEmail: "minh.beta@example.com",
        source: "webhook_demo",
        painPoint: "Need managed services operating cadence",
        serviceFit: "Managed services expansion",
        timeline: "this_quarter",
        budgetRange: "150m-250m",
        authority: "ops_lead",
        status: "opportunity_created",
        ownerUserId: founder.id,
        qualificationSummary: "Qualified for proposal follow-up"
      }
    ],
    skipDuplicates: true
  });

  const [projectAlpha, projectBeta] = await Promise.all([
    client.project.upsert({
      where: { workspaceId_code: { workspaceId: workspace.id, code: "PRJ-ALPHA" } },
      update: {},
      create: {
        id: "prj-alpha",
        workspaceId: workspace.id,
        accountId: alpha.id,
        code: "PRJ-ALPHA",
        name: "Alpha CRM/ERP Implementation",
        status: "active",
        marginPercent: "32"
      }
    }),
    client.project.upsert({
      where: { workspaceId_code: { workspaceId: workspace.id, code: "PRJ-BETA" } },
      update: {},
      create: {
        id: "prj-beta",
        workspaceId: workspace.id,
        accountId: beta.id,
        code: "PRJ-BETA",
        name: "Beta Managed Services Discovery",
        status: "planning",
        marginPercent: "24"
      }
    })
  ]);

  await Promise.all([
    client.portalIdentity.upsert({
      where: {
        provider_providerUserId_tenantKey: {
          provider: "lark",
          providerUserId: "ou-demo-customer-alpha",
          tenantKey: demoTenantKey
        }
      },
      update: { userId: customer.id },
      create: {
        userId: customer.id,
        provider: "lark",
        providerUserId: "ou-demo-customer-alpha",
        tenantKey: demoTenantKey
      }
    }),
    client.customerAccessGrant.createMany({
      data: [
        {
          id: "grant-alpha-account",
          workspaceId: workspace.id,
          userId: customer.id,
          accountId: alpha.id,
          scope: "CUSTOMER_ACCOUNT" as any
        },
        {
          id: "grant-alpha-project",
          workspaceId: workspace.id,
          userId: customer.id,
          projectId: projectAlpha.id,
          scope: "CUSTOMER_PROJECT" as any
        }
      ],
      skipDuplicates: true
    }),
    client.projectMember.createMany({
      data: [
        { workspaceId: workspace.id, projectId: projectAlpha.id, userId: sales.id, relation: "sales_owner" },
        { workspaceId: workspace.id, projectId: projectAlpha.id, userId: delivery.id, relation: "delivery_lead" },
        { workspaceId: workspace.id, projectId: projectAlpha.id, userId: founder.id, relation: "executive_sponsor" }
      ],
      skipDuplicates: true
    })
  ]);

  await client.opportunity.createMany({
    data: [
      {
        workspaceId: workspace.id,
        accountId: alpha.id,
        leadId: "lead-alpha-crm",
        title: "CRM/ERP phase 1",
        ownerUserId: sales.id,
        stage: "won",
        amount: "350000000",
        probability: 100,
        forecastCategory: "closed_won",
        stageEnteredAt: new Date("2026-06-01T03:00:00.000Z")
      },
      {
        workspaceId: workspace.id,
        accountId: beta.id,
        leadId: "lead-beta-managed-services",
        title: "Managed services expansion",
        ownerUserId: founder.id,
        stage: "proposal",
        amount: "180000000",
        probability: 45,
        forecastCategory: "best_case",
        stageEnteredAt: new Date("2026-05-15T03:00:00.000Z")
      }
    ],
    skipDuplicates: true
  });

  const alphaOpportunity = await client.opportunity.findFirstOrThrow({
    where: { workspaceId: workspace.id, accountId: alpha.id, title: "CRM/ERP phase 1" },
    select: { id: true, accountId: true }
  });
  const betaOpportunity = await client.opportunity.findFirstOrThrow({
    where: { workspaceId: workspace.id, accountId: beta.id, title: "Managed services expansion" },
    select: { id: true, accountId: true }
  });

  await Promise.all([
    client.opportunity.update({
      where: { id: alphaOpportunity.id },
      data: {
        ownerUserId: sales.id,
        forecastCategory: "closed_won",
        stageEnteredAt: new Date("2026-06-01T03:00:00.000Z")
      }
    }),
    client.opportunity.update({
      where: { id: betaOpportunity.id },
      data: {
        ownerUserId: founder.id,
        forecastCategory: "best_case",
        stageEnteredAt: new Date("2026-05-15T03:00:00.000Z")
      }
    }),
    client.project.update({
      where: { workspaceId_code: { workspaceId: workspace.id, code: "PRJ-ALPHA" } },
      data: { opportunityId: alphaOpportunity.id }
    }),
    client.project.update({
      where: { workspaceId_code: { workspaceId: workspace.id, code: "PRJ-BETA" } },
      data: { opportunityId: betaOpportunity.id }
    })
  ]);

  await client.opportunityStageHistory.createMany({
    data: [
      {
        id: "hist-alpha-closed-won",
        workspaceId: workspace.id,
        opportunityId: alphaOpportunity.id,
        accountId: alphaOpportunity.accountId,
        fromStage: "contracting",
        toStage: "won",
        probability: 100,
        amount: "350000000",
        forecastCategory: "closed_won",
        changedByUserId: sales.id,
        changedAt: new Date("2026-06-01T03:00:00.000Z"),
        reason: "Demo seed baseline"
      },
      {
        id: "hist-beta-proposal",
        workspaceId: workspace.id,
        opportunityId: betaOpportunity.id,
        accountId: betaOpportunity.accountId,
        fromStage: "discovery",
        toStage: "proposal",
        probability: 45,
        amount: "180000000",
        forecastCategory: "best_case",
        changedByUserId: founder.id,
        changedAt: new Date("2026-05-15T03:00:00.000Z"),
        reason: "Demo seed stale review baseline"
      }
    ],
    skipDuplicates: true
  });

  await client.opportunityActivity.createMany({
    data: [
      {
        id: "act-alpha-kickoff-evidence",
        workspaceId: workspace.id,
        opportunityId: alphaOpportunity.id,
        accountId: alphaOpportunity.accountId,
        type: "handoff",
        subject: "Confirm delivery kickoff evidence",
        note: "Sales to delivery packet needs final SOW link.",
        dueAt: new Date("2026-06-12T03:00:00.000Z"),
        status: "open",
        createdByUserId: sales.id
      },
      {
        id: "act-beta-proposal-revision",
        workspaceId: workspace.id,
        opportunityId: betaOpportunity.id,
        accountId: betaOpportunity.accountId,
        type: "follow_up",
        subject: "Send managed services proposal revision",
        note: "Founder review requested before customer follow-up.",
        status: "open",
        createdByUserId: founder.id
      }
    ],
    skipDuplicates: true
  });

  await client.projectTask.createMany({
    data: [
      {
        id: "task-alpha-kickoff",
        workspaceId: workspace.id,
        accountId: alpha.id,
        projectId: projectAlpha.id,
        opportunityId: alphaOpportunity.id,
        title: "Run delivery kickoff",
        description: "Confirm stakeholder map, scope baseline and first implementation cadence.",
        taskType: "kickoff",
        status: "completed",
        priority: "high",
        ownerUserId: delivery.id,
        assigneeUserId: delivery.id,
        ownerTeamId: team.id,
        plannedStartAt: new Date("2026-06-03T03:00:00.000Z"),
        dueAt: new Date("2026-06-05T03:00:00.000Z"),
        startedAt: new Date("2026-06-03T03:00:00.000Z"),
        completedAt: new Date("2026-06-05T06:00:00.000Z"),
        estimateMinutes: 480,
        createdByUserId: sales.id
      },
      {
        id: "task-alpha-process-map",
        workspaceId: workspace.id,
        accountId: alpha.id,
        projectId: projectAlpha.id,
        opportunityId: alphaOpportunity.id,
        title: "Map sales-to-delivery process",
        description: "Document current CRM handoff, implementation status gates and owner map.",
        taskType: "implementation",
        status: "in_progress",
        priority: "medium",
        ownerUserId: delivery.id,
        assigneeUserId: delivery.id,
        ownerTeamId: team.id,
        plannedStartAt: new Date("2026-06-06T03:00:00.000Z"),
        dueAt: new Date("2026-06-14T03:00:00.000Z"),
        startedAt: new Date("2026-06-06T03:00:00.000Z"),
        estimateMinutes: 960,
        createdByUserId: delivery.id
      },
      {
        id: "task-alpha-customer-data",
        workspaceId: workspace.id,
        accountId: alpha.id,
        projectId: projectAlpha.id,
        title: "Collect customer master data",
        description: "Waiting for customer to confirm account and contact import file.",
        taskType: "customer_action",
        status: "blocked",
        priority: "high",
        ownerUserId: delivery.id,
        assigneeUserId: sales.id,
        ownerTeamId: team.id,
        plannedStartAt: new Date("2026-06-06T03:00:00.000Z"),
        dueAt: new Date("2026-06-09T03:00:00.000Z"),
        startedAt: new Date("2026-06-06T03:00:00.000Z"),
        estimateMinutes: 240,
        createdByUserId: delivery.id
      },
      {
        id: "task-beta-discovery",
        workspaceId: workspace.id,
        accountId: beta.id,
        projectId: projectBeta.id,
        opportunityId: betaOpportunity.id,
        title: "Prepare managed services discovery",
        taskType: "discovery",
        status: "todo",
        priority: "medium",
        ownerUserId: founder.id,
        assigneeUserId: founder.id,
        ownerTeamId: team.id,
        dueAt: new Date("2026-06-04T03:00:00.000Z"),
        estimateMinutes: 360,
        createdByUserId: founder.id
      }
    ],
    skipDuplicates: true
  });

  await client.taskStatusHistory.createMany({
    data: [
      {
        id: "taskhist-alpha-kickoff-created",
        workspaceId: workspace.id,
        taskId: "task-alpha-kickoff",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        fromStatus: null,
        toStatus: "todo",
        changedByUserId: sales.id,
        changedAt: new Date("2026-06-03T03:00:00.000Z"),
        reason: "Seed task created"
      },
      {
        id: "taskhist-alpha-kickoff-done",
        workspaceId: workspace.id,
        taskId: "task-alpha-kickoff",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        fromStatus: "in_progress",
        toStatus: "completed",
        changedByUserId: delivery.id,
        changedAt: new Date("2026-06-05T06:00:00.000Z"),
        reason: "Kickoff completed"
      },
      {
        id: "taskhist-alpha-process-map-start",
        workspaceId: workspace.id,
        taskId: "task-alpha-process-map",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        fromStatus: "todo",
        toStatus: "in_progress",
        changedByUserId: delivery.id,
        changedAt: new Date("2026-06-06T03:00:00.000Z"),
        reason: "Implementation analysis started"
      },
      {
        id: "taskhist-alpha-customer-data-blocked",
        workspaceId: workspace.id,
        taskId: "task-alpha-customer-data",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        fromStatus: "in_progress",
        toStatus: "blocked",
        changedByUserId: delivery.id,
        changedAt: new Date("2026-06-07T03:00:00.000Z"),
        reason: "Waiting for customer file"
      }
    ],
    skipDuplicates: true
  });

  await client.taskTimeEntry.createMany({
    data: [
      {
        id: "time-alpha-kickoff-delivery-1",
        workspaceId: workspace.id,
        taskId: "task-alpha-kickoff",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        userId: delivery.id,
        workDate: new Date("2026-06-04T00:00:00.000Z"),
        minutes: 300,
        billable: true,
        workType: "delivery",
        approvalStatus: "approved",
        note: "Kickoff preparation and customer meeting"
      },
      {
        id: "time-alpha-kickoff-sales-1",
        workspaceId: workspace.id,
        taskId: "task-alpha-kickoff",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        userId: sales.id,
        workDate: new Date("2026-06-04T00:00:00.000Z"),
        minutes: 120,
        billable: true,
        workType: "sales_handoff",
        approvalStatus: "approved",
        note: "Sales handoff support"
      },
      {
        id: "time-alpha-process-map-delivery-1",
        workspaceId: workspace.id,
        taskId: "task-alpha-process-map",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        userId: delivery.id,
        workDate: new Date("2026-06-07T00:00:00.000Z"),
        minutes: 240,
        billable: true,
        workType: "analysis",
        approvalStatus: "approved",
        note: "Process workshop notes"
      },
      {
        id: "time-alpha-process-map-delivery-20260901",
        workspaceId: workspace.id,
        taskId: "task-alpha-process-map",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        userId: delivery.id,
        workDate: new Date("2026-09-01T00:00:00.000Z"),
        startAt: new Date("2026-09-01T02:00:00.000Z"),
        endAt: new Date("2026-09-01T06:00:00.000Z"),
        minutes: 240,
        billable: true,
        workType: "implementation",
        approvalStatus: "approved",
        reviewedByUserId: founder.id,
        reviewedAt: new Date("2026-09-01T07:00:00.000Z"),
        reviewNote: "Approved for the local analytics demo",
        note: "Map the sales-to-delivery workflow"
      },
      {
        id: "time-alpha-customer-data-sales-20260903",
        workspaceId: workspace.id,
        taskId: "task-alpha-customer-data",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        userId: sales.id,
        workDate: new Date("2026-09-03T00:00:00.000Z"),
        startAt: new Date("2026-09-03T02:00:00.000Z"),
        endAt: new Date("2026-09-03T05:00:00.000Z"),
        minutes: 180,
        billable: true,
        workType: "customer_data",
        approvalStatus: "approved",
        reviewedByUserId: founder.id,
        reviewedAt: new Date("2026-09-03T06:00:00.000Z"),
        reviewNote: "Approved for the local analytics demo",
        note: "Review and clean the customer import file"
      },
      {
        id: "time-beta-discovery-founder-20260904",
        workspaceId: workspace.id,
        taskId: "task-beta-discovery",
        accountId: beta.id,
        projectId: projectBeta.id,
        userId: founder.id,
        workDate: new Date("2026-09-04T00:00:00.000Z"),
        startAt: new Date("2026-09-04T01:30:00.000Z"),
        endAt: new Date("2026-09-04T04:00:00.000Z"),
        minutes: 150,
        billable: true,
        workType: "discovery",
        approvalStatus: "approved",
        reviewedByUserId: founder.id,
        reviewedAt: new Date("2026-09-04T05:00:00.000Z"),
        reviewNote: "Approved for the local analytics demo",
        note: "Managed services discovery workshop"
      },
      {
        id: "time-alpha-process-map-submitted-20260905",
        workspaceId: workspace.id,
        taskId: "task-alpha-process-map",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        userId: delivery.id,
        workDate: new Date("2026-09-05T00:00:00.000Z"),
        startAt: new Date("2026-09-05T02:00:00.000Z"),
        endAt: new Date("2026-09-05T04:00:00.000Z"),
        minutes: 120,
        billable: true,
        workType: "qa",
        approvalStatus: "submitted",
        note: "QA follow-up awaiting approval"
      }
    ],
    skipDuplicates: true
  });

  await client.resourceProfile.upsert({
    where: { userId: delivery.id },
    update: {
      displayRole: "Implementation consultant",
      defaultWeeklyCapacityMinutes: 1200,
      billableTargetPercent: 75,
      skills: ["crm", "implementation", "lark"]
    },
    create: {
      id: "resprof-delivery-alpha",
      userId: delivery.id,
      displayRole: "Implementation consultant",
      defaultWeeklyCapacityMinutes: 1200,
      billableTargetPercent: 75,
      skills: ["crm", "implementation", "lark"]
    }
  });

  await client.resourceCapacityPeriod.upsert({
    where: {
      workspaceId_userId_periodStart_periodEnd: {
        workspaceId: workspace.id,
        userId: delivery.id,
        periodStart: new Date("2026-06-08T00:00:00.000Z"),
        periodEnd: new Date("2026-06-15T00:00:00.000Z")
      }
    },
    update: {
      workspaceId: workspace.id,
      availableMinutes: 1200,
      plannedLeaveMinutes: 0,
      note: "Pilot week capacity baseline"
    },
    create: {
      id: "rescap-delivery-alpha-2026w24",
      workspaceId: workspace.id,
      userId: delivery.id,
      periodStart: new Date("2026-06-08T00:00:00.000Z"),
      periodEnd: new Date("2026-06-15T00:00:00.000Z"),
      availableMinutes: 1200,
      plannedLeaveMinutes: 0,
      note: "Pilot week capacity baseline"
    }
  });

  await client.resourceCapacityPeriod.upsert({
    where: {
      workspaceId_userId_periodStart_periodEnd: {
        workspaceId: workspace.id,
        userId: delivery.id,
        periodStart: new Date("2026-08-31T00:00:00.000Z"),
        periodEnd: new Date("2026-09-08T00:00:00.000Z")
      }
    },
    update: {
      workspaceId: workspace.id,
      availableMinutes: 2400,
      plannedLeaveMinutes: 0,
      note: "Current local demo capacity"
    },
    create: {
      id: "rescap-delivery-alpha-2026w36",
      workspaceId: workspace.id,
      userId: delivery.id,
      periodStart: new Date("2026-08-31T00:00:00.000Z"),
      periodEnd: new Date("2026-09-08T00:00:00.000Z"),
      availableMinutes: 2400,
      plannedLeaveMinutes: 0,
      note: "Current local demo capacity"
    }
  });

  await client.resourceAllocation.upsert({
    where: { id: "resalloc-alpha-delivery-implementation" },
    update: {
      workspaceId: workspace.id,
      accountId: alpha.id,
      projectId: projectAlpha.id,
      opportunityId: alphaOpportunity.id,
      userId: delivery.id,
      status: "CONFIRMED" as any,
      allocationPercent: 110,
      plannedMinutes: 1320,
      startAt: new Date("2026-06-08T00:00:00.000Z"),
      endAt: new Date("2026-06-15T00:00:00.000Z"),
      overbookApproved: true,
      approvedByUserId: founder.id,
      note: "Seed allocation for capacity/P&L smoke data"
    },
    create: {
      id: "resalloc-alpha-delivery-implementation",
      workspaceId: workspace.id,
      accountId: alpha.id,
      projectId: projectAlpha.id,
      opportunityId: alphaOpportunity.id,
      userId: delivery.id,
      role: "Implementation consultant",
      skill: "crm",
      status: "CONFIRMED" as any,
      allocationPercent: 110,
      plannedMinutes: 1320,
      startAt: new Date("2026-06-08T00:00:00.000Z"),
      endAt: new Date("2026-06-15T00:00:00.000Z"),
      overbookApproved: true,
      approvedByUserId: founder.id,
      note: "Seed allocation for capacity/P&L smoke data",
      createdByUserId: founder.id
    }
  });

  await client.resourceAllocation.upsert({
    where: { id: "resalloc-alpha-delivery-2026w36" },
    update: {
      workspaceId: workspace.id,
      accountId: alpha.id,
      projectId: projectAlpha.id,
      opportunityId: alphaOpportunity.id,
      userId: delivery.id,
      status: "CONFIRMED" as any,
      allocationPercent: 55,
      plannedMinutes: 1320,
      startAt: new Date("2026-08-31T00:00:00.000Z"),
      endAt: new Date("2026-09-08T00:00:00.000Z"),
      overbookApproved: false,
      approvedByUserId: founder.id,
      note: "Current local demo allocation"
    },
    create: {
      id: "resalloc-alpha-delivery-2026w36",
      workspaceId: workspace.id,
      accountId: alpha.id,
      projectId: projectAlpha.id,
      opportunityId: alphaOpportunity.id,
      userId: delivery.id,
      role: "Implementation consultant",
      skill: "crm",
      status: "CONFIRMED" as any,
      allocationPercent: 55,
      plannedMinutes: 1320,
      startAt: new Date("2026-08-31T00:00:00.000Z"),
      endAt: new Date("2026-09-08T00:00:00.000Z"),
      overbookApproved: false,
      approvedByUserId: founder.id,
      note: "Current local demo allocation",
      createdByUserId: founder.id
    }
  });

  await client.costRateProfile.createMany({
    data: [
      {
        id: "costrate-delivery-alpha-2026",
        userId: delivery.id,
        role: "Implementation consultant",
        currency: "VND",
        hourlyCostRate: "500000",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z")
      }
    ],
    skipDuplicates: true
  });

  await client.projectBudget.upsert({
    where: { code: "BUD-ALPHA-CRM-ERP-P1" },
    update: {
      workspaceId: workspace.id,
      accountId: alpha.id,
      projectId: projectAlpha.id,
      status: "ACTIVE" as any,
      plannedRevenueAmount: "350000000",
      plannedCostAmount: "180000000",
      baselineMinutes: 2200,
      contingencyPercent: "10"
    },
    create: {
      id: "budget-alpha-phase1",
      workspaceId: workspace.id,
      accountId: alpha.id,
      projectId: projectAlpha.id,
      code: "BUD-ALPHA-CRM-ERP-P1",
      currency: "VND",
      revenueBasis: "signed_contract",
      plannedRevenueAmount: "350000000",
      plannedCostAmount: "180000000",
      baselineMinutes: 2200,
      contingencyPercent: "10",
      status: "ACTIVE" as any,
      createdByUserId: finance.id
    }
  });

  await client.projectCost.createMany({
    data: [
      {
        id: "cost-alpha-lark-setup",
        workspaceId: workspace.id,
        accountId: alpha.id,
        projectId: projectAlpha.id,
        costType: "EXTERNAL" as any,
        label: "Lark setup support",
        currency: "VND",
        amount: "20000000",
        occurredAt: new Date("2026-06-05T00:00:00.000Z"),
        billable: false,
        note: "Seed direct cost for project P&L",
        createdByUserId: finance.id
      }
    ],
    skipDuplicates: true
  });

  await client.proposalPackage.upsert({
    where: { id: "prop-alpha-phase1-v1" },
    update: {
      workspaceId: workspace.id,
      accountId: alpha.id,
      opportunityId: alphaOpportunity.id,
      status: "INTERNALLY_APPROVED" as any,
      approvedAt: new Date("2026-05-28T03:00:00.000Z")
    },
    create: {
      id: "prop-alpha-phase1-v1",
      workspaceId: workspace.id,
      accountId: alpha.id,
      opportunityId: alphaOpportunity.id,
      packageType: "STANDARD_IMPLEMENTATION" as any,
      status: "INTERNALLY_APPROVED" as any,
      version: 1,
      title: "Alpha CRM/ERP phase 1 approved package",
      currency: "VND",
      proposedAmount: "350000000",
      discountPercent: "0",
      paymentTermSummary: "50% kickoff / 50% go-live",
      scopeRiskLevel: "LOW" as any,
      customerVisible: false,
      createdByUserId: sales.id,
      submittedAt: new Date("2026-05-25T03:00:00.000Z"),
      approvedAt: new Date("2026-05-28T03:00:00.000Z")
    }
  });

  await client.proposalDocument.createMany({
    data: [
      {
        id: "doc-alpha-proposal-v1",
        workspaceId: workspace.id,
        proposalPackageId: "prop-alpha-phase1-v1",
        documentType: "PROPOSAL" as any,
        version: 1,
        title: "Alpha CRM/ERP proposal",
        storageKey: "drive/alpha/proposal.pdf",
        customerVisible: true,
        createdByUserId: sales.id
      },
      {
        id: "doc-alpha-sow-v1",
        workspaceId: workspace.id,
        proposalPackageId: "prop-alpha-phase1-v1",
        documentType: "SOW" as any,
        version: 1,
        title: "Alpha CRM/ERP SOW",
        storageKey: "drive/alpha/sow.pdf",
        customerVisible: true,
        createdByUserId: sales.id
      },
      {
        id: "doc-alpha-quotation-v1",
        workspaceId: workspace.id,
        proposalPackageId: "prop-alpha-phase1-v1",
        documentType: "QUOTATION" as any,
        version: 1,
        title: "Alpha CRM/ERP quotation",
        storageKey: "drive/alpha/quotation.pdf",
        customerVisible: true,
        createdByUserId: sales.id
      },
      {
        id: "doc-alpha-payment-v1",
        workspaceId: workspace.id,
        proposalPackageId: "prop-alpha-phase1-v1",
        documentType: "PAYMENT_SCHEDULE" as any,
        version: 1,
        title: "Alpha CRM/ERP payment schedule",
        storageKey: "drive/alpha/payment-schedule.pdf",
        customerVisible: true,
        createdByUserId: sales.id
      }
    ],
    skipDuplicates: true
  });

  await client.dealApprovalRequest.upsert({
    where: { id: "appr-alpha-readiness" },
    update: {
      workspaceId: workspace.id,
      status: "APPROVED" as any,
      decidedAt: new Date("2026-05-28T03:00:00.000Z")
    },
    create: {
      id: "appr-alpha-readiness",
      workspaceId: workspace.id,
      proposalPackageId: "prop-alpha-phase1-v1",
      opportunityId: alphaOpportunity.id,
      requestType: "PROPOSAL_READINESS" as any,
      status: "APPROVED" as any,
      requiredRoleCode: "SALES_OWNER",
      requestedByUserId: sales.id,
      assignedToUserId: sales.id,
      severity: "standard",
      reason: "Seed approval for Alpha phase 1 baseline.",
      submittedAt: new Date("2026-05-25T03:00:00.000Z"),
      decidedAt: new Date("2026-05-28T03:00:00.000Z")
    }
  });

  await client.dealApprovalDecision.createMany({
    data: [
      {
        id: "appr-alpha-readiness-decision",
        workspaceId: workspace.id,
        approvalRequestId: "appr-alpha-readiness",
        decision: "approved",
        decidedByUserId: sales.id,
        comment: "Approved package aligns with commercial scope.",
        decidedAt: new Date("2026-05-28T03:00:00.000Z")
      }
    ],
    skipDuplicates: true
  });

  await client.contract.upsert({
    where: { code: "CON-ALPHA-CRM-ERP-P1" },
    update: {
      workspaceId: workspace.id,
      accountId: alpha.id,
      opportunityId: alphaOpportunity.id,
      projectId: projectAlpha.id,
      proposalPackageId: "prop-alpha-phase1-v1",
      status: "SENT_FOR_SIGNATURE" as any,
      signatureStatus: "SENT" as any,
      customerVisible: true,
      allowedRoles: ["FOUNDER_GM", "FINANCE_ADMIN", "SALES_OWNER", "CUSTOMER_SPONSOR", "CLIENT_PORTAL_ADMIN", "CLIENT_FINANCE"]
    },
    create: {
      id: "contract-alpha-phase1",
      workspaceId: workspace.id,
      accountId: alpha.id,
      opportunityId: alphaOpportunity.id,
      projectId: projectAlpha.id,
      proposalPackageId: "prop-alpha-phase1-v1",
      code: "CON-ALPHA-CRM-ERP-P1",
      title: "Alpha CRM/ERP phase 1 contract",
      status: "SENT_FOR_SIGNATURE" as any,
      signatureStatus: "SENT" as any,
      currency: "VND",
      contractValue: "350000000",
      effectiveDate: new Date("2026-06-01T00:00:00.000Z"),
      expiresAt: new Date("2026-12-31T23:59:59.000Z"),
      customerVisible: true,
      allowedRoles: ["FOUNDER_GM", "FINANCE_ADMIN", "SALES_OWNER", "CUSTOMER_SPONSOR", "CLIENT_PORTAL_ADMIN", "CLIENT_FINANCE"],
      createdByUserId: sales.id
    }
  });

  await client.contractDocument.createMany({
    data: [
      {
        id: "contract-doc-alpha-pdf-v1",
        workspaceId: workspace.id,
        contractId: "contract-alpha-phase1",
        documentType: "CONTRACT_PDF" as any,
        version: 1,
        title: "Alpha CRM/ERP contract PDF",
        storageKey: "drive/alpha/contracts/contract.pdf",
        customerVisible: true,
        checksum: "seed-contract-pdf",
        createdByUserId: sales.id
      }
    ],
    skipDuplicates: true
  });

  await client.paymentSchedule.upsert({
    where: { code: "PAY-ALPHA-CRM-ERP-P1" },
    update: {
      workspaceId: workspace.id,
      accountId: alpha.id,
      contractId: "contract-alpha-phase1",
      opportunityId: alphaOpportunity.id,
      projectId: projectAlpha.id,
      proposalPackageId: "prop-alpha-phase1-v1",
      status: "ACTIVE" as any,
      customerVisible: true,
      allowedRoles: ["FOUNDER_GM", "FINANCE_ADMIN", "SALES_OWNER", "CUSTOMER_SPONSOR", "CLIENT_PORTAL_ADMIN", "CLIENT_FINANCE"]
    },
    create: {
      id: "pay-alpha-phase1",
      workspaceId: workspace.id,
      accountId: alpha.id,
      contractId: "contract-alpha-phase1",
      opportunityId: alphaOpportunity.id,
      projectId: projectAlpha.id,
      proposalPackageId: "prop-alpha-phase1-v1",
      code: "PAY-ALPHA-CRM-ERP-P1",
      title: "Alpha CRM/ERP phase 1 payment schedule",
      status: "ACTIVE" as any,
      currency: "VND",
      totalAmount: "350000000",
      customerVisible: true,
      allowedRoles: ["FOUNDER_GM", "FINANCE_ADMIN", "SALES_OWNER", "CUSTOMER_SPONSOR", "CLIENT_PORTAL_ADMIN", "CLIENT_FINANCE"],
      createdByUserId: sales.id
    }
  });

  await client.paymentMilestone.createMany({
    data: [
      {
        id: "payms-alpha-kickoff",
        workspaceId: workspace.id,
        scheduleId: "pay-alpha-phase1",
        accountId: alpha.id,
        contractId: "contract-alpha-phase1",
        projectId: projectAlpha.id,
        code: "PAY-ALPHA-KICKOFF",
        sequence: 1,
        label: "Kickoff payment",
        triggerType: "KICKOFF" as any,
        percentage: "50",
        amount: "175000000",
        dueAt: new Date("2026-06-03T00:00:00.000Z"),
        invoiceReadyAt: new Date("2026-06-01T03:00:00.000Z"),
        invoicedAt: new Date("2026-06-02T03:00:00.000Z"),
        status: "INVOICED" as any,
        invoiceStatus: "SENT" as any,
        paymentStatus: "OVERDUE" as any,
        financeOwnerUserId: finance.id,
        overdueOwnerUserId: finance.id,
        customerVisible: true,
        customerNote: "Kickoff invoice is visible to customer sponsor.",
        createdByUserId: sales.id
      },
      {
        id: "payms-alpha-golive",
        workspaceId: workspace.id,
        scheduleId: "pay-alpha-phase1",
        accountId: alpha.id,
        contractId: "contract-alpha-phase1",
        projectId: projectAlpha.id,
        code: "PAY-ALPHA-GOLIVE",
        sequence: 2,
        label: "Go-live acceptance payment",
        triggerType: "ACCEPTANCE" as any,
        percentage: "50",
        amount: "175000000",
        dueAt: new Date("2026-07-15T00:00:00.000Z"),
        status: "PLANNED" as any,
        invoiceStatus: "DRAFT" as any,
        paymentStatus: "UNPAID" as any,
        financeOwnerUserId: finance.id,
        overdueOwnerUserId: finance.id,
        customerVisible: true,
        customerNote: "Invoice after go-live acceptance.",
        createdByUserId: sales.id
      }
    ],
    skipDuplicates: true
  });

  await client.invoice.createMany({
    data: [
      {
        id: "inv-alpha-kickoff",
        workspaceId: workspace.id,
        milestoneId: "payms-alpha-kickoff",
        accountId: alpha.id,
        contractId: "contract-alpha-phase1",
        projectId: projectAlpha.id,
        code: "INV-ALPHA-KICKOFF",
        status: "SENT" as any,
        paymentStatus: "OVERDUE" as any,
        currency: "VND",
        amount: "175000000",
        issuedAt: new Date("2026-06-02T03:00:00.000Z"),
        sentAt: new Date("2026-06-02T04:00:00.000Z"),
        dueAt: new Date("2026-06-03T00:00:00.000Z"),
        externalInvoiceNo: "ALPHA-2026-001",
        customerVisible: true,
        storageKey: "drive/alpha/invoices/kickoff.pdf",
        createdByUserId: finance.id
      }
    ],
    skipDuplicates: true
  });

  await client.invoice.update({
    where: { id: "inv-alpha-kickoff" },
    data: {
      paidAmount: "87500000",
      paymentStatus: "PARTIALLY_PAID" as any,
      paidAt: new Date("2026-06-08T03:00:00.000Z")
    }
  });

  await client.paymentMilestone.update({
    where: { id: "payms-alpha-kickoff" },
    data: {
      paymentStatus: "PARTIALLY_PAID" as any,
      paidAt: new Date("2026-06-08T03:00:00.000Z")
    }
  });

  await client.invoicePayment.createMany({
    data: [
      {
        id: "invpay-alpha-kickoff-partial",
        workspaceId: workspace.id,
        invoiceId: "inv-alpha-kickoff",
        milestoneId: "payms-alpha-kickoff",
        accountId: alpha.id,
        projectId: projectAlpha.id,
        currency: "VND",
        amount: "87500000",
        paidAt: new Date("2026-06-08T03:00:00.000Z"),
        evidenceType: "BANK_TRANSFER" as any,
        evidenceTitle: "Partial kickoff transfer",
        externalUrl: "https://example.test/payments/alpha-kickoff-partial",
        note: "Seed partial cash collection ledger entry",
        createdByUserId: finance.id
      }
    ],
    skipDuplicates: true
  });

  await client.arFollowUp.createMany({
    data: [
      {
        id: "ar-alpha-kickoff-follow-up",
        workspaceId: workspace.id,
        milestoneId: "payms-alpha-kickoff",
        invoiceId: "inv-alpha-kickoff",
        accountId: alpha.id,
        ownerUserId: finance.id,
        status: "OPEN" as any,
        reason: "Kickoff invoice overdue",
        nextActionAt: new Date("2026-06-10T03:00:00.000Z"),
        note: "Finance to confirm payment date with customer sponsor.",
        createdByUserId: finance.id
      }
    ],
    skipDuplicates: true
  });

  await client.paymentEvidence.createMany({
    data: [
      {
        id: "payev-alpha-kickoff-invoice-file",
        workspaceId: workspace.id,
        milestoneId: "payms-alpha-kickoff",
        invoiceId: "inv-alpha-kickoff",
        accountId: alpha.id,
        evidenceType: "INVOICE_FILE" as any,
        title: "Kickoff invoice PDF",
        storageKey: "drive/alpha/invoices/kickoff.pdf",
        customerVisible: true,
        createdByUserId: finance.id
      }
    ],
    skipDuplicates: true
  });

  await client.ticket.createMany({
    data: [
      {
        id: "tkt-alpha",
        workspaceId: workspace.id,
        accountId: alpha.id,
        projectId: projectAlpha.id,
        requesterUserId: customer.id,
        code: "TKT-ALPHA-001",
        title: "Portal rollout question",
        description: "Customer asked for a rollout checklist before the next onboarding session.",
        category: "lark_usage",
        source: "portal",
        ownerQueue: "customer_success",
        priority: "high",
        status: "open",
        customerVisibleNote: "Waiting for implementation checklist",
        internalNote: "Internal delivery note"
      },
      {
        id: "tkt-beta",
        workspaceId: workspace.id,
        accountId: beta.id,
        projectId: projectBeta.id,
        code: "TKT-BETA-001",
        title: "Internal discovery risk",
        description: "Internal team is tracking discovery risk before proposal scope is final.",
        category: "configuration_issue",
        source: "internal",
        ownerQueue: "delivery",
        priority: "medium",
        status: "open",
        customerVisibleNote: "Discovery is in progress",
        internalNote: "Competitive account risk"
      }
    ],
    skipDuplicates: true
  });

  await client.projectArtifact.createMany({
    data: [
      {
        id: "art-alpha-sow",
        workspaceId: workspace.id,
        accountId: alpha.id,
        projectId: projectAlpha.id,
        code: "ART-ALPHA-SOW",
        name: "Alpha approved SOW",
        artifactType: "sow",
        storageKey: "drive/alpha/sow.pdf",
        customerVisible: true,
        internalOnly: false,
        allowedRoles: ["FOUNDER_GM", "SALES_OWNER", "CUSTOMER_SPONSOR"],
        signedUrlExpiresSeconds: 300
      },
      {
        id: "art-beta-internal",
        workspaceId: workspace.id,
        accountId: beta.id,
        projectId: projectBeta.id,
        code: "ART-BETA-INTERNAL",
        name: "Beta internal discovery note",
        artifactType: "internal_note",
        storageKey: "drive/beta/internal-note.pdf",
        customerVisible: false,
        internalOnly: true,
        allowedRoles: ["FOUNDER_GM"],
        signedUrlExpiresSeconds: 120
      }
    ],
    skipDuplicates: true
  });
}

async function main() {
  await seedDemoData(prisma);
}

if (require.main === module) {
  main()
    .finally(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
