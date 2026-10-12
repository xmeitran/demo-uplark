/**
 * Table 9.1 of "Nguyên tắc nền tảng hệ thống PM" — moving running projects onto the new framework, one project at a
 * time and only on request. Rules: apps/api/src/modules/delivery-handoff/framework-conversion.ts.
 *
 *   npx tsx --tsconfig apps/api/tsconfig.json scripts/operations/convert-project-frameworks.ts --convert-frameworks --dry-run
 *   npx tsx --tsconfig apps/api/tsconfig.json scripts/operations/convert-project-frameworks.ts --convert-frameworks --apply --projects=<id,id>
 *   npx tsx --tsconfig apps/api/tsconfig.json scripts/operations/convert-project-frameworks.ts --restore=/path/to/backups/framework-conversion-<stamp>
 *
 * Options: --workspace=<id>, --projects=<id or code, ...> (required with --apply; narrows --dry-run), --backup-dir=<path>
 * (default $LEGACY_CONVERSION_BACKUP_DIR, else ./backups), --position=before_g1|milestone_2|milestone_3_4 (the PM's
 * answer for projects whose position is "Không xác định"; applies to every project of the run), --verbose (every step).
 *
 * --dry-run applies each plan inside a transaction, plans again to prove a second run would do nothing, and rolls back.
 * --apply writes <backup>/<projectId>.json before touching a project and refuses to run without --projects.
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { EMPTY_FRAMEWORK_TOTALS, planFrameworkConversion, type FrameworkConversionPlan, type FrameworkTotals } from "../../apps/api/src/modules/delivery-handoff/framework-conversion";
import { applyFrameworkConversion, backupFrameworkConversion, frameworkBackupDirectory, loadFrameworkSnapshot, projectsServiceHooks, restoreFrameworkConversion } from "../../apps/api/src/modules/delivery-handoff/framework-conversion.service";
import { PROJECT_POSITIONS, type ProjectPosition } from "../../apps/api/src/modules/delivery-handoff/legacy-conversion";
import { ProjectsService } from "../../apps/api/src/modules/delivery-handoff/projects.service";

const args = new Map(process.argv.slice(2).map((arg) => { const [key, ...rest] = arg.replace(/^--/, "").split("="); return [key, rest.join("=") || "true"] as const; }));
const prisma = new PrismaClient();
const service = new ProjectsService(prisma as any);
class DryRunRollback extends Error {}

async function main() {
  if (args.has("restore")) {
    for (const row of await restoreFrameworkConversion(prisma, args.get("restore")!)) console.log(`Đã khôi phục ${row.projectCode}: ${row.tasks} task, ${row.timeEntries} giờ log, xóa ${row.deleted} dòng do chuyển đổi tạo.`);
    return;
  }
  const apply = args.has("apply");
  if (!args.has("convert-frameworks") || apply === args.has("dry-run")) throw new Error("Dùng --convert-frameworks cùng với --dry-run hoặc --apply --projects=<id,id>.");
  const wanted = (args.get("projects") ?? "").split(",").map((value) => value.trim()).filter((value) => value && value !== "true");
  if (apply && !wanted.length) throw new Error("--apply bắt buộc có --projects=<id,id>: chuyển đổi khung chỉ chạy cho từng dự án được chỉ định.");
  const position = args.get("position") as ProjectPosition | undefined;
  if (position && (!(position in PROJECT_POSITIONS) || position === "unknown")) throw new Error(`--position không hợp lệ: ${position}`);

  const projects = await prisma.project.findMany({
    where: { ...(args.has("workspace") ? { workspaceId: args.get("workspace") } : {}), ...(wanted.length ? { OR: [{ id: { in: wanted } }, { code: { in: wanted } }] } : {}) },
    select: { id: true, code: true, workspaceId: true }, orderBy: { code: "asc" }
  });
  const missing = wanted.filter((value) => !projects.some((project) => project.id === value || project.code === value));
  if (missing.length) throw new Error(`Không tìm thấy dự án: ${missing.join(", ")}`);
  const now = new Date();
  const backupDir = frameworkBackupDirectory(args.get("backup-dir"), now);
  const summary = new Map<string, { projects: number; withOperations: number; totals: FrameworkTotals }>();

  for (const project of projects) {
    const ctx = { workspaceId: project.workspaceId, now, hooks: projectsServiceHooks(service, { workspaceId: project.workspaceId, subjectType: "system", roleCodes: [] }), backupDirectory: apply ? backupDir : undefined };
    const plan: FrameworkConversionPlan = planFrameworkConversion((await loadFrameworkSnapshot(prisma, project.workspaceId, project.id))!, { position });
    let remaining = 0;
    if (plan.operations.length) {
      if (apply) console.log(`Sao lưu: ${await backupFrameworkConversion(prisma, backupDir, project.workspaceId, plan)}`);
      try {
        await prisma.$transaction(async (tx) => {
          await applyFrameworkConversion(tx, plan, ctx);
          remaining = planFrameworkConversion((await loadFrameworkSnapshot(tx, project.workspaceId, project.id))!, { position }).operations.length;
          if (!apply) throw new DryRunRollback();
        }, { timeout: 600_000, maxWait: 20_000 });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
      }
    }
    const bucket = summary.get(plan.positionLabel) ?? { projects: 0, withOperations: 0, totals: { ...EMPTY_FRAMEWORK_TOTALS } };
    bucket.projects += 1;
    if (plan.operations.length) bucket.withOperations += 1;
    for (const key of Object.keys(bucket.totals) as Array<keyof FrameworkTotals>) bucket.totals[key] += plan.totals[key];
    summary.set(plan.positionLabel, bucket);
    if (!plan.operations.length && !args.has("verbose") && !wanted.length) continue;
    console.log(`\n${plan.projectCode} · ${plan.projectName} — ${plan.positionLabel}${plan.operations.length ? ` — ${plan.operations.length} thao tác${remaining ? ` (CHẠY LẠI CÒN ${remaining} THAO TÁC)` : ""}` : " — không có gì để làm"}`);
    for (const step of plan.steps) console.log(`  - ${step}`);
    for (const note of plan.notes) console.log(`  ! ${note}`);
  }
  console.log(`\nTổng hợp theo vị trí (bảng 9.1):\n${JSON.stringify(Object.fromEntries(summary), null, 2)}`);
  console.log(apply ? `ĐÃ ÁP DỤNG. Hoàn tác: --restore=${backupDir}` : "CHẠY THỬ: không có gì được ghi vào cơ sở dữ liệu.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
