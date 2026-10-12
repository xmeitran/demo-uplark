"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil } from "lucide-react";
import type { PnlStaffCostApproveInput, PnlStaffCostComponents, PnlStaffCostImportInput, PnlStaffCostImportResult, PnlStaffCostInput, PnlStaffCostRow, PnlStaffCostsResponse, PnlStaffCostTemplateResponse, StaffMonthlyCostRow, StaffMonthlyCostsResponse } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { MonthFilter } from "@/components/filters/filter-controls";
import { currentPeriodKey, formatMoneyInput, importResultText, inputClass, mapStaffCostSheet, parseMoneyInput, periodLabel, type StaffCostImportRow } from "./pnl-cost-shared";
import { formatDay, formatDong, formatHoursValue, formatMillions, formatMonth } from "./pnl-format";
import { Field, linkClass, LoadingBlock, ModalActions, numberCellClass, PnlModal, ReadOnlyNote, SaveFeedback, smallButton, Strip, tableCellClass, tableHeadClass, toneClass, useSave } from "./pnl-setup-ui";
import { cardClass, PnlLoadError, pnlRequest, usePnlLoad } from "./pnl-ui";

/** The six cost components, named after the payroll system's output (mục 6.7 khối 3), in column order. */
const COMPONENTS: Array<{ key: keyof PnlStaffCostComponents; head: string; label: string }> = [
  { key: "baseSalaryAmount", head: "Lương TC", label: "Lương tiêu chuẩn" },
  { key: "performanceBonusAmount", head: "Thưởng HS", label: "Thưởng hiệu suất" },
  { key: "resultBonusAmount", head: "Thưởng HQ", label: "Thưởng hiệu quả" },
  { key: "allowanceAmount", head: "Phụ cấp", label: "Phụ cấp" },
  { key: "overtimeAmount", head: "OT", label: "OT" },
  { key: "socialInsuranceAmount", head: "BHXH", label: "BHXH công ty đóng" }
];
const STATUS_TONE: Record<PnlStaffCostRow["status"], string> = { APPROVED: toneClass.ok, DRAFT: toneClass.info, NONE: toneClass.warn, LOCKED: "text-slate-600" };
const PERIOD_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const FORBIDDEN = "Chỉ nhóm quyền chi phí xem và sửa chi phí nhân sự theo tháng. Liên hệ Admin để được cấp quyền chi phí.";
const head = `${tableHeadClass} !px-2.5 whitespace-nowrap`;
const cell = `${tableCellClass} !px-2.5 whitespace-nowrap`;
const num = `${numberCellClass} !px-2.5 whitespace-nowrap`;

type EditTarget = Pick<PnlStaffCostRow, "userId" | "periodKey" | "components" | "status"> & { displayName?: string; employeeCode?: string | null };

/** Excel cell → plain value (formula results and rich text included). */
function cellValue(value: unknown): unknown {
  if (value && typeof value === "object") {
    const object = value as { result?: unknown; text?: unknown; richText?: Array<{ text: string }> };
    if (object.result !== undefined) return object.result;
    if (object.richText) return object.richText.map((part) => part.text).join("");
    if (object.text !== undefined) return object.text;
  }
  return value;
}

async function downloadTemplate(periodKey: string) {
  const template = (await pnlRequest<PnlStaffCostTemplateResponse>(`/api/pnl/staff-costs/template?periodKey=${periodKey}`, undefined, "Không tải được file mẫu.")).data;
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Chi phi ${periodKey}`);
  sheet.addRow(template.columns.map((column) => column.label)).font = { bold: true };
  for (const row of template.rows) sheet.addRow(template.columns.map((column) => column.key === "employeeCode" ? row.employeeCode ?? "" : column.key === "displayName" ? row.displayName : null));
  sheet.columns.forEach((column) => { column.width = 20; });
  const url = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = Object.assign(document.createElement("a"), { href: url, download: `chi-phi-thang-${periodKey}.xlsx` });
  anchor.click();
  URL.revokeObjectURL(url);
}

async function readImportFile(file: File, periodKey: string): Promise<StaffCostImportRow[]> {
  const template = (await pnlRequest<PnlStaffCostTemplateResponse>(`/api/pnl/staff-costs/template?periodKey=${periodKey}`, undefined, "Không đọc được cấu trúc file mẫu.")).data;
  const { loadExcelWorkbook } = await import("@/lib/excel-import");
  const sheet = (await loadExcelWorkbook(await file.arrayBuffer())).worksheets[0];
  if (!sheet) throw new Error("File không có trang tính nào.");
  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => { matrix.push((Array.isArray(row.values) ? row.values.slice(1) : []).map(cellValue)); });
  const mapped = mapStaffCostSheet(matrix, template.columns);
  if (mapped.missingColumns.length) throw new Error(`File thiếu cột: ${mapped.missingColumns.join(", ")}. Dùng “Tải file mẫu” của đúng tháng.`);
  if (!mapped.rows.length) throw new Error("File không có dòng dữ liệu nào.");
  return mapped.rows;
}

/**
 * Mục 6.7 — "Hồ sơ nhân sự › Chi phí theo tháng": the one place that produces cost rates.
 * ① thanh kỳ và tiến độ, ② ghi chú giai đoạn, ③ bảng chi phí, ④ kết quả import, ⑤ quy tắc khóa. Nháp → Đã duyệt → Đã khóa.
 */
export function StaffCostsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("periodKey") ?? "";
  const periodKey = PERIOD_KEY.test(requested) ? requested : "";
  const api = usePnlLoad<PnlStaffCostsResponse>(`/api/pnl/staff-costs${periodKey ? `?periodKey=${periodKey}` : ""}`, "Không tải được chi phí theo tháng.");
  const save = useSave(api.reload);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const data = api.data?.data;
  const meta = api.data?.meta;

  let body: ReactNode;
  if (!data || !meta) {
    body = api.loading ? <LoadingBlock rows={7} label="Đang tải chi phí theo tháng…" /> : (api.error ? <PnlLoadError error={api.error} onRetry={api.reload} forbiddenText={FORBIDDEN} /> : null);
  } else {
    const period = data.periodKey;
    const locked = data.periodState === "locked";
    const canEdit = meta.canEdit && !locked;
    const canApprove = meta.canApprove && !locked;
    const options = [...new Set([period, ...data.periodOptions])].sort((a, b) => b.localeCompare(a)).map((key) => ({ value: key, label: periodLabel(key) }));
    const approve = (userIds?: string[]) => {
      const input: PnlStaffCostApproveInput = { periodKey: period, ...(userIds ? { userIds } : {}) };
      void save.run(() => pnlRequest("/api/pnl/staff-costs/approve", { method: "POST", body: input }), userIds ? "Đã duyệt bản nháp." : `Đã duyệt các bản nháp của ${periodLabel(period).toLowerCase()}.`);
    };
    const importFile = (file: File) => void save.run(async () => {
      const input: PnlStaffCostImportInput = { periodKey: period, rows: await readImportFile(file, period) };
      const result = await pnlRequest<{ data: PnlStaffCostImportResult }>("/api/pnl/staff-costs/import", { method: "POST", body: input }, "Không import được file.");
      setShowErrors(result.data.errors.length > 0);
    });
    const lastImport = data.lastImport;

    body = (
      <>
        {locked ? <Strip tone="muted">{periodLabel(period)} đã khóa: không nhập, sửa hay duyệt được, kể cả dữ liệu từ hệ thống lương. Muốn đổi thì mở lại kỳ ở <Link href={`/pnl/costs?tab=periods&periodKey=${period}`} className={linkClass}>Thiết lập P&amp;L › Kỳ và khóa kỳ</Link>.</Strip> : null}
        {!meta.canEdit && !meta.canApprove ? <ReadOnlyNote>Chế độ chỉ xem. Nhập và import cần quyền Sửa chi phí; duyệt bản nháp cần quyền Duyệt chi phí.</ReadOnlyNote> : null}

        {/* ① Thanh kỳ và tiến độ */}
        <section aria-label="Thanh kỳ và tiến độ" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-[10.5rem]"><CrmSelect ariaLabel="Tháng" value={period} onChange={(next) => router.replace(`/users/costs?periodKey=${next}`, { scroll: false })} options={options} /></div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={smallButton} disabled={save.busy} onClick={() => void save.run(() => downloadTemplate(period))}>Tải file mẫu</button>
              <button type="button" className={smallButton} disabled={save.busy || !canEdit} onClick={() => fileInput.current?.click()}>Import Excel</button>
              <input ref={fileInput} type="file" accept=".xlsx" className="sr-only" tabIndex={-1} aria-label="Chọn file Excel chi phí tháng" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) importFile(file); }} />
              <button type="button" className={smallButton} disabled={save.busy || !canApprove || !data.counts.draft} onClick={() => { if (window.confirm(`Duyệt ${data.counts.draft} bản nháp của ${periodLabel(period).toLowerCase()}? Bản Đã duyệt được dùng để tính cost rate cho P&L.`)) approve(); }}>Duyệt bản nháp</button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Giờ chuẩn tháng {formatHoursValue(data.standardMinutes)} giờ ({data.workingDays} ngày × {data.standardDayHours}) · Đã duyệt {data.counts.approved} · Nháp {data.counts.draft} · Chưa có {data.counts.missing}</p>
        </section>

        {/* ② Ghi chú giai đoạn */}
        <Strip tone="muted">{data.notes.phase}</Strip>
        <SaveFeedback error={save.error} message={save.message} />

        {/* ③ Bảng chi phí */}
        <section aria-label="Bảng chi phí" className={`${cardClass} overflow-x-auto`}>
          <table className="w-full min-w-[940px] text-sm">
            <thead><tr>
              <th scope="col" className={head}>Mã NS</th><th scope="col" className={head}>Nhân sự</th>
              {COMPONENTS.map((component) => <th key={component.key} scope="col" title={component.label} className={`${head} !text-right`}>{component.head}</th>)}
              <th scope="col" className={`${head} !text-right`}>Tổng</th><th scope="col" className={`${head} !text-right`}>Cost rate</th><th scope="col" className={head}>Nguồn</th><th scope="col" className={head}>Trạng thái</th>
              <th scope="col" className={head}><span className="sr-only">Thao tác</span></th>
            </tr></thead>
            <tbody>
              {data.rows.map((row) => {
                const waiting = row.waitingMinutes > 0;
                const waitingText = `${formatHoursValue(row.waitingMinutes)} giờ log trong tháng đang chờ chi phí tháng này`;
                return (
                  <tr key={row.userId} className={waiting ? "bg-amber-50" : "hover:bg-muted/25"}>
                    <td className={`${cell} font-mono text-xs`}>{row.employeeCode ?? <span className={toneClass.warn}>Chưa gán mã</span>}</td>
                    <td className={cell}><Link href={`/users/${encodeURIComponent(row.userId)}`} className="font-medium !text-foreground hover:!text-primary hover:underline">{row.displayName}</Link>{row.department ? <span className="block text-[11px] text-muted-foreground">{row.department}</span> : null}</td>
                    {row.components
                      ? <>{COMPONENTS.map((component) => <td key={component.key} className={num}>{formatMillions(row.components?.[component.key], "table")}</td>)}<td className={`${num} font-bold`}>{formatMillions(row.totalAmount, "table")}</td><td className={num}>{formatDong(row.hourlyCostRate === null ? null : Math.round(row.hourlyCostRate))}</td></>
                      : <td colSpan={8} className={`${cell} ${waiting ? "font-medium text-amber-700" : "text-muted-foreground"}`}>{waiting ? waitingText : "Chưa nhập chi phí tháng này"}</td>}
                    <td className={cell}>{row.sourceLabel ?? ""}</td>
                    <td className={cell}>
                      <span className={`font-medium ${STATUS_TONE[row.status]}`}>{row.statusLabel}</span>
                      {row.approvedAt ? <span className="block text-[11px] text-muted-foreground">{row.approvedByName ?? "—"} · {formatDay(row.approvedAt, false)}</span> : row.updatedAt ? <span className="block text-[11px] text-muted-foreground">sửa {formatDay(row.updatedAt, false)}</span> : null}
                      {waiting && row.components ? <span className="block text-[11px] text-amber-700">{waitingText}</span> : null}
                    </td>
                    <td className={`${cell} text-right`}>
                      {canApprove && row.status === "DRAFT" ? <button type="button" className={`${linkClass} mr-2 text-xs`} disabled={save.busy} onClick={() => approve([row.userId])}>Duyệt</button> : null}
                      {canEdit && row.status !== "LOCKED" ? <button type="button" aria-label={`${row.components ? "Sửa" : "Nhập"} chi phí tháng của ${row.displayName}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary" onClick={() => setEditing(row)}><Pencil className="h-3.5 w-3.5" aria-hidden /></button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data.rows.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Chưa có nhân sự nào trong tháng. Bấm “Tải file mẫu”, điền chi phí rồi “Import Excel”.</p> : null}
        </section>

        {/* ④ Kết quả import */}
        {lastImport ? (
          <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground">
            <p>
              {importResultText(lastImport)}
              {lastImport.errors.length ? <button type="button" aria-expanded={showErrors} aria-label="Xem danh sách dòng lỗi" className="ml-1 rounded px-1 font-bold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => setShowErrors((value) => !value)}>›</button> : null}
              <span className="ml-2 text-xs text-muted-foreground">{lastImport.byName ?? "—"} · {formatDay(lastImport.at)}</span>
            </p>
            {showErrors && lastImport.errors.length ? <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs">{lastImport.errors.map((entry) => <li key={`${entry.rowNumber}:${entry.employeeCode}`}>Dòng {entry.rowNumber}{entry.employeeCode ? ` · mã ${entry.employeeCode}` : ""} · {entry.reason}</li>)}</ul> : null}
          </div>
        ) : null}

        {/* ⑤ Quy tắc khóa */}
        <div className="text-sm text-muted-foreground">{data.notes.lockRules.map((line) => <p key={line}>{line}</p>)}</div>

        {editing ? <StaffCostModal target={editing} locked={locked} reload={api.reload} onClose={() => setEditing(null)} /> : null}
      </>
    );
  }

  return (
    <AppShell activeRoute="/users" title="Chi phí theo tháng">
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="!text-xl font-bold text-foreground"><Link href="/users" className="hover:text-primary">Hồ sơ nhân sự</Link> › Chi phí theo tháng</h1>
          <p className="text-sm text-muted-foreground">Chỉ nhóm quyền chi phí · đơn vị triệu đồng</p>
        </header>
        {body}
      </main>
    </AppShell>
  );
}

/** Nhập / sửa một dòng: sáu cấu phần (đồng), luôn lưu ở trạng thái Nháp; gán mã nhân sự của hệ thống lương. */
function StaffCostModal({ target, locked, reload, onClose }: Readonly<{ target: EditTarget; locked: boolean; reload: () => Promise<void>; onClose: () => void }>) {
  const save = useSave(reload);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(COMPONENTS.map((component) => { const value = target.components?.[component.key]; return [component.key, value === null || value === undefined ? "" : formatMoneyInput(String(value))]; })));
  const codeEditable = target.employeeCode !== undefined;
  const [employeeCode, setEmployeeCode] = useState(target.employeeCode ?? "");
  const month = periodLabel(target.periodKey).toLowerCase();

  async function submit() {
    const input: PnlStaffCostInput = { userId: target.userId, periodKey: target.periodKey };
    for (const component of COMPONENTS) input[component.key] = parseMoneyInput(values[component.key]) ?? 0;
    const ok = await save.run(async () => {
      if (codeEditable && employeeCode.trim() && employeeCode.trim() !== (target.employeeCode ?? "")) await pnlRequest("/api/pnl/staff-costs/employee-code", { method: "PUT", body: { userId: target.userId, employeeCode: employeeCode.trim() } }, "Không gán được mã nhân sự.");
      await pnlRequest("/api/pnl/staff-costs", { method: "PUT", body: input }, "Không lưu được chi phí tháng.");
    });
    if (ok) onClose();
  }
  async function removeDraft() {
    if (!window.confirm(`Xóa bản nháp chi phí ${month}${target.displayName ? ` của ${target.displayName}` : ""}?`)) return;
    const input: PnlStaffCostInput = { userId: target.userId, periodKey: target.periodKey, monthlyCostAmount: null };
    if (await save.run(() => pnlRequest("/api/pnl/staff-costs", { method: "PUT", body: input }, "Không xóa được bản nháp."))) onClose();
  }

  return (
    <PnlModal title={`Chi phí ${month}${target.displayName ? ` · ${target.displayName}` : ""}`} onClose={onClose} onSubmit={() => void submit()}
      footer={<>{target.status === "DRAFT" ? <button type="button" className="mr-auto text-sm font-semibold text-destructive hover:underline" disabled={save.busy} onClick={() => void removeDraft()}>Xóa bản nháp</button> : null}<ModalActions onCancel={onClose} busy={save.busy} disabled={locked} submitLabel="Lưu bản nháp" /></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {COMPONENTS.map((component) => (
          <Field key={component.key} label={`${component.label} (đồng)`} htmlFor={`staff-cost-${component.key}`}>
            <input id={`staff-cost-${component.key}`} inputMode="numeric" autoComplete="off" disabled={locked} value={values[component.key]} placeholder="0" onChange={(event) => setValues((current) => ({ ...current, [component.key]: formatMoneyInput(event.target.value) }))} className={`${inputClass} text-right font-mono tabular-nums`} />
          </Field>
        ))}
      </div>
      {codeEditable ? <Field label="Mã nhân sự (đúng mã của hệ thống lương)" htmlFor="staff-cost-code"><input id="staff-cost-code" value={employeeCode} maxLength={40} onChange={(event) => setEmployeeCode(event.target.value)} className={inputClass} placeholder="Ví dụ: NS-012" /></Field> : null}
      <p className="text-xs text-muted-foreground">Lưu ở trạng thái Nháp, chưa dùng cho P&amp;L cho tới khi được duyệt{target.status === "APPROVED" ? "; bản Đã duyệt hiện tại quay về Nháp và cần duyệt lại" : ""}. Tổng chi phí và cost rate do hệ thống tính (Tổng ÷ giờ chuẩn của tháng). Người sửa, thời điểm, giá trị trước và sau được ghi lại.</p>
      <SaveFeedback error={save.error} message={null} />
    </PnlModal>
  );
}

/**
 * Trang hồ sơ từng người: the same table as the company-wide screen, one person, every month ("hai nơi là hai cách
 * nhìn của một bảng"). Rendered only for the cost permission group: anyone else gets a 403 and sees nothing.
 */
export function StaffMonthlyCosts({ userId }: Readonly<{ userId: string; defaultRole?: string }>) {
  const api = usePnlLoad<StaffMonthlyCostsResponse>(`/api/staff-costs?userId=${encodeURIComponent(userId)}`, "Không tải được chi phí nhân sự.");
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [newPeriod, setNewPeriod] = useState(currentPeriodKey);
  if (api.error?.status === 403) return null;
  const rows = api.data?.data ?? [];
  const lockedKeys = api.data?.meta.lockedPeriodKeys ?? [];
  const canEdit = Boolean(api.data?.meta.canEdit);
  const open = (periodKey: string, row?: StaffMonthlyCostRow) => setEditing({ userId, periodKey, components: row?.components ?? null, status: row?.status ?? "NONE" });

  return (
    <section aria-labelledby="staff-cost-title" className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 id="staff-cost-title" className="!text-sm font-bold text-foreground">Chi phí theo tháng</h2>
          <p className="mt-1 text-xs text-muted-foreground">Chỉ nhóm quyền chi phí xem và sửa · đơn vị triệu đồng. Cùng bảng với <Link href="/users/costs" className={linkClass}>Hồ sơ nhân sự › Chi phí theo tháng</Link>. Cost rate = Tổng ÷ giờ chuẩn của tháng; chỉ bản Đã duyệt được dùng cho P&amp;L.</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <MonthFilter ariaLabel="Tháng cần nhập" value={newPeriod} onChange={setNewPeriod} />
            <button type="button" className={smallButton} disabled={lockedKeys.includes(newPeriod)} title={lockedKeys.includes(newPeriod) ? "Tháng đã khóa: mở lại kỳ ở Thiết lập P&L để sửa." : undefined} onClick={() => open(newPeriod, rows.find((row) => row.periodKey === newPeriod))}>Nhập tháng này</button>
          </div>
        ) : api.data ? <p role="status" className="text-xs text-muted-foreground">Chế độ chỉ xem (cần quyền Sửa chi phí).</p> : null}
      </div>
      {api.error ? <div className="p-4"><PnlLoadError error={api.error} onRetry={api.reload} /></div> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr>
            <th scope="col" className={head}>Tháng</th>
            {COMPONENTS.map((component) => <th key={component.key} scope="col" title={component.label} className={`${head} !text-right`}>{component.head}</th>)}
            <th scope="col" className={`${head} !text-right`}>Tổng</th><th scope="col" className={`${head} !text-right`}>Cost rate</th><th scope="col" className={head}>Nguồn</th><th scope="col" className={head}>Trạng thái</th>
            <th scope="col" className={head}><span className="sr-only">Thao tác</span></th>
          </tr></thead>
          <tbody>{rows.map((row) => {
            const status = row.status;
            return (
              <tr key={row.periodKey} className="hover:bg-muted/25">
                <td className={`${cell} font-semibold`}>{formatMonth(row.periodKey)}</td>
                {COMPONENTS.map((component) => <td key={component.key} className={num}>{formatMillions(row.components[component.key], "table")}</td>)}
                <td className={`${num} font-bold`}>{formatMillions(row.monthlyCostAmount, "table")}</td>
                <td className={num}>{formatDong(Math.round(row.hourlyCostRate))}</td>
                <td className={cell}>{row.sourceLabel}</td>
                <td className={`${cell} font-medium ${STATUS_TONE[status]}`}>{row.statusLabel}</td>
                <td className={`${cell} text-right`}>{canEdit && !row.locked && status !== "LOCKED" ? <button type="button" aria-label={`Sửa chi phí ${periodLabel(row.periodKey).toLowerCase()}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary" onClick={() => open(row.periodKey, row)}><Pencil className="h-3.5 w-3.5" aria-hidden /></button> : null}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {!rows.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{api.loading ? "Đang tải…" : api.error ? "" : "Chưa có chi phí tháng nào cho nhân sự này. Tháng chưa có chi phí Đã duyệt thì giờ log của tháng đó ở Chờ xử lý."}</p> : null}
      </div>
      {editing ? <StaffCostModal target={editing} locked={lockedKeys.includes(editing.periodKey)} reload={api.reload} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
