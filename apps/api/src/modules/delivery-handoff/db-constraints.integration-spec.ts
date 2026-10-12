import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Rules that live only in SQL (triggers, partial unique indexes, CHECK constraints of the 2026-10-11/12 migrations).
 * The service specs run on hand-written fakes, so nothing else exercises them.
 * Everything happens inside ONE transaction that is always rolled back; the spec checks row counts before/after itself.
 * Skipped when DATABASE_URL is missing or the database does not answer. Prisma reads DATABASE_URL from the repo .env by itself.
 *
 *   cd apps/api && npx vitest run --config vitest.integration.config.ts src/modules/delivery-handoff/db-constraints.integration-spec.ts
 *   (all integration specs: pnpm --filter @b2b-crm/api test:integration)
 */
const ROLLBACK = new Error("rollback");
const run = `dbc-${Date.now()}`;
const prisma = new PrismaClient();

const TABLES = ["project", "projectPnlRecord", "projectBaseline", "projectWarning", "projectStatusProposal", "projectRisk", "projectContractItem",
  "projectContractInstallment", "pnlFund", "pnlFundPeriod", "pnlParameterValue", "pnlCostItem"] as const;
const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await (prisma as any)[table].count()])));

describe.runIf(Boolean(process.env.DATABASE_URL))("SQL-only rules on the real schema (rolled back)", () => {
  afterAll(() => prisma.$disconnect());

  it("triggers, partial unique indexes and CHECK constraints hold", async (context) => {
    if (!(await prisma.$queryRaw`SELECT 1`.then(() => true, () => false))) return context.skip();
    const before = await counts();

    await prisma.$transaction(async (tx) => {
      // A failed statement aborts a Postgres transaction, so every expected rejection runs inside its own savepoint.
      const rejection = async (attempt: () => Promise<unknown>): Promise<string> => {
        await tx.$executeRawUnsafe("SAVEPOINT expected_rejection");
        try {
          await attempt();
        } catch (error) {
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT expected_rejection");
          return String((error as Error).message);
        }
        throw new Error("the database accepted a row it must reject");
      };

      const { workspaceId, accountId } = await tx.project.findFirstOrThrow({ select: { workspaceId: true, accountId: true } });
      const project = await tx.project.create({ data: { workspaceId, accountId, code: `${run}-A`, name: `${run} A`, status: "planning" } });
      const projectId = project.id;

      // 1. PL-28: the P&L record is created by the database with the project.
      expect(await tx.projectPnlRecord.findUnique({ where: { projectId } })).toMatchObject({ id: `ppr_${projectId}`, workspaceId, contractStatus: "draft" });
      expect(await rejection(() => tx.projectPnlRecord.update({ where: { projectId }, data: { contractStatus: "cancelled" } }))).toContain("ProjectPnlRecord_contractStatus_check");

      // 2. D-20: a stored baseline version cannot be rewritten; a new version can be added.
      const baseline = { workspaceId, projectId, layer: "B0", snapshot: {}, reason: run, causeType: "manual" };
      const b0 = await tx.projectBaseline.create({ data: { ...baseline, version: 1 } });
      expect(await rejection(() => tx.projectBaseline.update({ where: { id: b0.id }, data: { reason: "rewritten" } }))).toContain("ProjectBaseline rows are immutable");
      expect(await rejection(() => tx.$executeRaw`UPDATE "ProjectBaseline" SET "version" = 9 WHERE "id" = ${b0.id}`)).toContain("immutable");
      await tx.projectBaseline.create({ data: { ...baseline, version: 2 } });
      expect(await rejection(() => tx.projectBaseline.create({ data: { ...baseline, version: 2 } }))).toMatch(/Unique constraint/i);
      expect(await rejection(() => tx.projectBaseline.create({ data: { ...baseline, layer: "B2", version: 1 } }))).toContain("ProjectBaseline_layer_check");
      expect(await rejection(() => tx.projectBaseline.create({ data: { ...baseline, layer: "B1", version: 0 } }))).toContain("ProjectBaseline_version_check");

      // 3. One OPEN warning per (projectId, dedupeKey); a closed one does not block a new open one.
      const warning = { workspaceId, projectId, typeCode: "TEST", title: run, dedupeKey: `${run}-k` };
      const open = await tx.projectWarning.create({ data: warning });
      expect(await rejection(() => tx.projectWarning.create({ data: warning }))).toMatch(/Unique constraint/i);
      await tx.projectWarning.create({ data: { ...warning, dedupeKey: `${run}-other` } });
      await tx.projectWarning.update({ where: { id: open.id }, data: { status: "closed" } });
      await tx.projectWarning.create({ data: warning });
      expect(await tx.projectWarning.count({ where: { projectId, dedupeKey: warning.dedupeKey } })).toBe(2);

      // 4. One PENDING status proposal per project; decided ones stay.
      const proposal = { workspaceId, projectId, fromStatus: "planning", proposedStatus: "in_progress", basis: run };
      const pending = await tx.projectStatusProposal.create({ data: proposal });
      expect(await rejection(() => tx.projectStatusProposal.create({ data: proposal }))).toMatch(/Unique constraint/i);
      expect(await rejection(() => tx.projectStatusProposal.update({ where: { id: pending.id }, data: { status: "ignored" } }))).toContain("ProjectStatusProposal_status_check");
      await tx.projectStatusProposal.update({ where: { id: pending.id }, data: { status: "superseded" } });
      await tx.projectStatusProposal.create({ data: proposal });

      // 5. Issue log: the record code is unique per project (same code is fine in another project); value CHECKs.
      const other = await tx.project.create({ data: { workspaceId, accountId, code: `${run}-B`, name: `${run} B`, status: "planning" } });
      const issue = { workspaceId, projectId, accountId, description: run, code: "VD-001" };
      await tx.projectRisk.create({ data: issue });
      expect(await rejection(() => tx.projectRisk.create({ data: issue }))).toMatch(/Unique constraint/i);
      await tx.projectRisk.create({ data: { ...issue, projectId: other.id } });
      for (const [field, constraint] of [["type", "ProjectRisk_type_check"], ["status", "ProjectRisk_status_check"], ["severity", "ProjectRisk_severity_check"], ["escalationLevel", "ProjectRisk_escalationLevel_check"]]) {
        expect(await rejection(() => tx.projectRisk.create({ data: { ...issue, code: `VD-${field}`, [field]: "bogus" } }))).toContain(constraint);
      }

      // 6. Money / status CHECKs of the P&L engine.
      const fund = await tx.pnlFund.create({ data: { workspaceId, code: `${run}-F`, name: run, targetItemCode: "X" } });
      const fundPeriod = { workspaceId, fundId: fund.id, periodKey: "2026-09", amount: 0, sourceAmount: 0 };
      expect(await rejection(() => tx.pnlFundPeriod.create({ data: { ...fundPeriod, amount: -1 } }))).toContain("PnlFundPeriod_amount_check");
      expect(await rejection(() => tx.pnlFundPeriod.create({ data: { ...fundPeriod, status: "pending" } }))).toContain("PnlFundPeriod_status_check");
      await tx.pnlFundPeriod.create({ data: fundPeriod });
      expect(await rejection(() => tx.pnlFundPeriod.create({ data: fundPeriod }))).toMatch(/Unique constraint/i);

      const item = await tx.projectContractItem.create({ data: { workspaceId, projectId, code: "HD-01", name: run } });
      const installment = { workspaceId, projectId, contractItemId: item.id, sequence: 1, label: "Đợt 1", percent: 40 };
      for (const percent of [0, -5, 100.01]) expect(await rejection(() => tx.projectContractInstallment.create({ data: { ...installment, percent } }))).toContain("ProjectContractInstallment_percent_check");
      expect(await rejection(() => tx.projectContractInstallment.create({ data: { ...installment, status: "cancelled" } }))).toContain("ProjectContractInstallment_status_check");
      await tx.projectContractInstallment.create({ data: { ...installment, percent: 100 } });

      const costItem = { workspaceId, code: `${run}-C`, name: run, method: "MANUAL" };
      expect(await rejection(() => tx.pnlCostItem.create({ data: { ...costItem, sign: 0 } }))).toContain("PnlCostItem_sign_check");
      expect(await rejection(() => tx.pnlCostItem.create({ data: { ...costItem, method: "GUESS" } }))).toContain("PnlCostItem_method_check");
      expect(await rejection(() => tx.pnlCostItem.create({ data: { ...costItem, status: "deleted" } }))).toContain("PnlCostItem_status_check");

      // 7. PL-19: parameter values are append-only and keyed by a real month.
      const parameter = { workspaceId, key: `${run}-p`, value: 1, effectiveFrom: "2026-09" };
      const stored = await tx.pnlParameterValue.create({ data: parameter });
      expect(await rejection(() => tx.pnlParameterValue.update({ where: { id: stored.id }, data: { value: 2 } }))).toContain("PnlParameterValue rows are immutable");
      for (const effectiveFrom of ["2026-13", "2026-9", "09-2026"]) expect(await rejection(() => tx.pnlParameterValue.create({ data: { ...parameter, effectiveFrom } }))).toContain("PnlParameterValue_effectiveFrom_check");
      expect(await rejection(() => tx.pnlParameterValue.create({ data: { ...parameter, scopeType: "team" } }))).toContain("PnlParameterValue_scopeType_check");

      throw ROLLBACK;
    }, { timeout: 60000, maxWait: 15000 }).catch((error) => { if (error !== ROLLBACK) throw error; });

    // Nothing survived.
    expect(await counts()).toEqual(before);
    expect(await prisma.project.count({ where: { code: { startsWith: run } } })).toBe(0);
  });
});
