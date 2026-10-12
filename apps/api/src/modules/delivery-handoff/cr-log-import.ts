/**
 * 9.4: "File CR Log hiện có được nhập vào sổ vấn đề và thay đổi, giữ nguyên mã CR cũ; trạng thái quy đổi theo bảng 5.4."
 * The web reads the CSV / XLSX into rows keyed by the file's headers; this file maps them. Admin only.
 *
 *  - the old CR code is the record code; a code that already exists in the project is left untouched (re-import is a no-op);
 *  - the four status columns of the file collapse into one status (5.4), the most final non-empty one winning;
 *  - the per-project CR counter moves past the highest imported "CR-<n>", so new requests never reuse a number;
 *  - a row that cannot be mapped is reported with its row number and never half-imported.
 */
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import type { ChangeRequestStepCode, CrLogImportResult, CrLogImportRow, IssueLogStatus } from "@b2b-crm/contracts";
import type { IssueLogContext } from "./issue-log.service";

/** Column of the record ← accepted file headers (compared without case, accents and punctuation). */
export const CR_LOG_COLUMNS = {
  code: ["ma cr", "ma", "ma yeu cau", "cr id", "cr code", "cr no", "so cr", "code", "id"],
  title: ["tieu de", "ten yeu cau", "ten cr", "ten", "title", "summary"],
  description: ["mo ta", "mo ta yeu cau", "noi dung", "chi tiet", "description"],
  requester: ["nguoi yeu cau", "nguoi de xuat", "requester", "requested by"],
  requestedAt: ["ngay yeu cau", "ngay tao", "ngay ghi nhan", "ngay", "request date", "created", "created at", "date"],
  closedAt: ["ngay dong", "ngay hoan thanh", "closed date", "close date"],
  status: ["trang thai cr", "trang thai", "cr status", "status"],
  customerDecision: ["quyet dinh kh", "quyet dinh khach hang", "customer decision"],
  implementationStatus: ["trang thai trien khai", "implementation status"],
  finalStatus: ["trang thai cuoi", "final status"],
  reason: ["ly do thay doi", "ly do", "reason"],
  effortMd: ["effort du kien", "effort md", "effort", "md"]
} as const;
type Column = keyof typeof CR_LOG_COLUMNS;

/** Table 5.4, column "Thay cho giá trị trong file CR Log" → status and the step the record resumes at. */
const STATUS_MAP: Record<string, { status: IssueLogStatus; step: ChangeRequestStepCode | null }> = {
  open: { status: "new", step: "CR-01" },
  assessing: { status: "assessing", step: "CR-02" },
  "request revision": { status: "assessing", step: "CR-04" },
  "awaiting commercial review": { status: "commercial_review", step: "CR-05B" },
  "awaiting customer approval": { status: "customer_approval", step: "CR-06" },
  pending: { status: "customer_approval", step: "CR-06" },
  approved: { status: "approved", step: "CR-07C" },
  implementing: { status: "implementing", step: "CR-08A" },
  "in progress": { status: "implementing", step: "CR-08A" },
  "qa uat": { status: "implementing", step: "CR-08C" },
  closed: { status: "closed", step: "CR-09" },
  "closed accepted": { status: "closed", step: "CR-09" },
  completed: { status: "closed", step: "CR-09" },
  rejected: { status: "rejected", step: null },
  deferred: { status: "deferred", step: null },
  cancelled: { status: "deferred", step: null }
};
const FINAL: readonly string[] = ["closed", "rejected", "deferred"];

/** Lower case, no accents, punctuation to single spaces. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  // Excel serial day number.
  if (typeof value === "number" && value > 20_000 && value < 80_000) return new Date(Math.round((value - 25_569) * 86_400_000));
  const text = String(value).trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const date = dmy ? new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))) : new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export interface MappedCrLogRow {
  code: string;
  description: string;
  status: IssueLogStatus;
  crStep: ChangeRequestStepCode | null;
  createdAt: Date | null;
  closedAt: Date | null;
  extension: Record<string, string | number>;
}

export function mapCrLogRows(rows: readonly CrLogImportRow[]): { mapped: MappedCrLogRow[]; rejected: CrLogImportResult["rejected"]; unmappedColumns: string[] } {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))];
  const columnOf = new Map<string, Column>();
  for (const header of headers) {
    const key = normalizeHeader(header);
    const column = (Object.keys(CR_LOG_COLUMNS) as Column[]).find((candidate) => (CR_LOG_COLUMNS[candidate] as readonly string[]).includes(key));
    if (column) columnOf.set(header, column);
  }
  const mapped: MappedCrLogRow[] = [];
  const rejected: CrLogImportResult["rejected"] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const value: Partial<Record<Column, unknown>> = {};
    // When two file columns map to the same field, the leftmost one that has a value wins.
    for (const header of headers) {
      const column = columnOf.get(header);
      const cell = row?.[header];
      if (column && value[column] === undefined && cell !== null && cell !== undefined && String(cell).trim() !== "") value[column] = cell;
    }
    const text = (column: Column) => String(value[column] ?? "").trim();
    if (!Object.keys(value).length) return; // blank line
    const number = index + 1;
    const code = text("code").toUpperCase();
    const reject = (reason: string) => rejected.push({ row: number, ...(code ? { code } : {}), reason });
    if (!code) return reject("Thiếu mã CR.");
    if (seen.has(code)) return reject(`Mã ${code} lặp lại trong file.`);
    const description = [text("title"), text("description")].filter(Boolean).join(" — ");
    if (!description) return reject("Thiếu tiêu đề và mô tả.");
    // 5.4: one life cycle instead of four status columns — the most final column that has a value decides.
    const rawStatus = text("finalStatus") || text("implementationStatus") || text("customerDecision") || text("status");
    const target = rawStatus ? STATUS_MAP[normalizeHeader(rawStatus)] : STATUS_MAP.open;
    if (!target) return reject(`Trạng thái "${rawStatus}" không có trong bảng quy đổi 5.4.`);
    const createdAt = parseDate(value.requestedAt);
    const closedAt = parseDate(value.closedAt);
    if (createdAt === undefined || closedAt === undefined) return reject("Ngày không đọc được (dùng dd/mm/yyyy hoặc yyyy-mm-dd).");
    const effort = Number(String(value.effortMd ?? "").replace(",", "."));
    seen.add(code);
    mapped.push({
      code, description, status: target.status, crStep: target.step, createdAt, closedAt: FINAL.includes(target.status) ? closedAt ?? createdAt ?? null : null,
      extension: {
        requesterName: text("requester") || "Không rõ (CR Log)", intakeChannel: "other", changeReason: text("reason") || description, initialReceiver: "CR Log",
        ...(value.effortMd !== undefined && Number.isFinite(effort) ? { estimatedEffortMd: effort } : {})
      }
    });
  });
  return { mapped, rejected, unmappedColumns: headers.filter((header) => !columnOf.has(header)) };
}

/** Highest running number among codes of the form CR-<n>; other code shapes do not move the counter. */
export function highestCrNumber(codes: readonly string[]): number {
  return codes.reduce((max, code) => Math.max(max, Number(/^CR-(\d+)$/.exec(code)?.[1] ?? 0)), 0);
}

export async function importCrLog(ctx: IssueLogContext, project: { id: string; accountId: string }, rows: unknown): Promise<CrLogImportResult> {
  if (!ctx.actor.isAdmin) throw new ForbiddenException("Chỉ Admin mới được nhập file CR Log.");
  if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException("File CR Log không có dòng dữ liệu nào.");
  if (rows.length > 2000) throw new BadRequestException("File CR Log quá lớn (tối đa 2000 dòng mỗi lần nhập).");
  const { mapped, rejected, unmappedColumns } = mapCrLogRows(rows as CrLogImportRow[]);
  const now = ctx.now ?? new Date();
  const workspaceId = ctx.principal.workspaceId;

  return ctx.prisma.$transaction(async (tx: any) => {
    const existing: Array<{ code: string }> = await tx.projectRisk.findMany({ where: { projectId: project.id, code: { in: mapped.map((row) => row.code) } }, select: { code: true } });
    const known = new Set(existing.map((row) => row.code));
    const created: string[] = [];
    for (const row of mapped) {
      if (known.has(row.code)) continue;
      const record = await tx.projectRisk.create({
        data: {
          workspaceId, accountId: project.accountId, projectId: project.id, code: row.code, type: "change_request", status: row.status, crStep: row.crStep, description: row.description,
          severity: "medium", extension: row.extension, closedAt: row.closedAt, createdByUserId: ctx.principal.subjectId, ...(row.createdAt ? { createdAt: row.createdAt } : {})
        }
      });
      await tx.projectRiskEvent.create({ data: { riskId: record.id, action: "migrated", toStatus: row.status, toStep: row.crStep, note: "Nhập từ file CR Log", actorUserId: ctx.principal.subjectId, actorName: ctx.principal.displayName, at: now } });
      created.push(row.code);
    }
    // The counter never decreases: it moves past the highest imported number.
    const highest = highestCrNumber(mapped.map((row) => row.code));
    const counter = await tx.projectRiskCounter.upsert({ where: { projectId_prefix: { projectId: project.id, prefix: "CR" } }, create: { projectId: project.id, prefix: "CR", last: highest }, update: {} });
    const counterLast = Math.max(counter.last, highest);
    if (counterLast !== counter.last) await tx.projectRiskCounter.update({ where: { projectId_prefix: { projectId: project.id, prefix: "CR" } }, data: { last: counterLast } });
    await tx.auditEvent?.create({ data: { workspaceId, actorUserId: ctx.principal.subjectId, action: "issue_log.cr_log_imported", resource: "project", resourceId: project.id, after: { created, unchanged: [...known], rejected: rejected.length, counterLast }, requestId: `cr-log:${project.id}:${now.getTime()}` } });
    return { created, unchanged: mapped.filter((row) => known.has(row.code)).map((row) => row.code), rejected, unmappedColumns, counterLast };
  });
}
