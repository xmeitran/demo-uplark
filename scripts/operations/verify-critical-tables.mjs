import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const criticalTables = [
  "User",
  "TenantWorkspace",
  "Role",
  "RoleBinding",
  "Account",
  "Opportunity",
  "Project",
  "ProjectTask",
  "Contract",
  "PaymentSchedule",
  "Ticket",
  "ProjectArtifact",
  "FileObject",
  "IntegrationEventLog",
  "AuditEvent",
  "PortalSession"
];

try {
  const missing = [];

  for (const table of criticalTables) {
    const rows = await prisma.$queryRawUnsafe(
      "select to_regclass($1)::text as table_name",
      `public."${table}"`
    );
    if (!rows[0]?.table_name) {
      missing.push(table);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing critical tables: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`Critical table verification passed: ${criticalTables.length} tables`);
  }
} finally {
  await prisma.$disconnect();
}
