"use client";

import { UserAvatar } from "@/components/user-avatar";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil } from "lucide-react";
import type { PnlStaffCostApproveInput, PnlStaffCostImportInput, PnlStaffCostImportResult, PnlStaffCostInput, PnlStaffCostRow, PnlStaffCostsResponse, PnlStaffCostTemplateResponse, StaffMonthlyCostRow, StaffMonthlyCostsResponse } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import { FilterBar, FilterField, MonthFilter, MultiSelectFilter, SearchFilter, matchesAny } from "@/components/filters";
import { PageHeader, pageMainClassName } from "@/components/page-header";
import { currentPeriodKey, formatMoneyInput, importResultText, inputClass, mapStaffCostSheet, parseMoneyInput, periodLabel, type StaffCostImportRow } from "./pnl-cost-shared";
import { formatDay, formatDong, formatHoursValue, formatMonth } from "./pnl-format";
import { Field, linkClass, LoadingBlock, ModalActions, numberCellClass, PnlModal, ReadOnlyNote, SaveFeedback, smallButton, Strip, tableCellClass, tableHeadClass, toneClass, useSave } from "./pnl-setup-ui";
import { cardClass, PnlLoadError, pnlRequest, usePnlLoad } from "./pnl-ui";

const STATUS_TONE: Record<PnlStaffCostRow["status"], string> = { APPROVED: toneClass.ok, DRAFT: toneClass.info, NONE: toneClass.warn, LOCKED: "text-slate-600" };
const PERIOD_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const FORBIDDEN = "Chỉ nhóm quyền chi phí xem và sửa chi phí nhân sự theo tháng. Liên hệ Admin để được cấp quyền chi phí.";
const head = `${tableHeadClass} !px-2.5 whitespace-nowrap`;
const cell = `${tableCellClass} !px-2.5 whitespace-nowrap`;
const num = `${numberCellClass} !px-2.5 whitespace-nowrap`;

type EditTarget = Pick<PnlStaffCostRow, "userId" | "periodKey" | "components" | "hourlyCostRate" | "status"> & { displayName?: string; employeeCode?: string | null };

function HourlyRateCell({ rate, status }: Readonly<{ rate: number | null; status: PnlStaffCostRow["status"] | StaffMonthlyCostRow["status"] }>) {
  if (rate === null) return <span title="Chưa nhập đơn giá giờ">—</span>;
  const draft = status === "DRAFT";
  return (
    <span title={draft ? "Đơn giá giờ đang chờ duyệt. P&L chỉ dùng sau khi bản ghi được duyệt." : "Đơn giá giờ đã nhập/được duyệt; P&L nhân số này với số giờ được tính."}>
      {formatDong(Math.round(rate))}
      {draft ? <span className="block text-[11px] font-normal text-amber-700">chờ duyệt</span> : null}
    </span>
  );
}

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
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const data = api.data?.data;
  const meta = api.data?.meta;
  const allRows = data?.rows;
  // Filters work on the month already loaded; the counts and "Duyệt bản nháp" stay those of the whole month.
  const rows = useMemo(() => (allRows ?? []).filter((row) => matchesSearch(search, row.displayName, row.employeeCode ?? undefined) && matchesAny(statuses, row.status) && matchesAny(departments, row.department)), [allRows, search, statuses, departments]);
  const statusOptions = useMemo(() => [...new Map((allRows ?? []).map((row) => [row.status, row.statusLabel])).entries()].map(([value, label]) => ({ value, label })), [allRows]);
  const departmentOptions = useMemo(() => [...new Set((allRows ?? []).map((row) => row.department).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, "vi")).map((name) => ({ value: name, label: name })), [allRows]);
  const activeCount = [Boolean(search.trim()), statuses.length > 0, departments.length > 0].filter(Boolean).length;
  const resetFilters = () => { setSearch(""); setStatuses([]); setDepartments([]); };

  let body: ReactNode;
  if (!data || !meta) {
    body = api.loading ? <LoadingBlock rows={7} label="Đang tải chi phí theo tháng…" /> : (api.error ? <PnlLoadError error={api.error} onRetry={api.reload} forbiddenText={FORBIDDEN} /> : null);
  } else {
    const period = data.periodKey;
    const locked = data.periodState === "locked";
    const canEdit = meta.canEdit && !locked;
    const canApprove = meta.canApprove && !locked;
    const months = [...new Set([period, ...data.periodOptions])];
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

        <Strip tone={data.counts.draft ? "warn" : "muted"}>
          <p className="font-semibold">Cách đưa chi phí vào P&amp;L</p>
          <p className="mt-0.5 text-xs">Nhập đơn giá cho 1 giờ làm việc → Lưu bản nháp → Duyệt bản nháp. P&amp;L sẽ lấy đơn giá giờ đã duyệt × số giờ được tính; bản Nháp chưa được dùng{data.counts.draft ? ` · hiện có ${data.counts.draft} bản nháp cần duyệt` : ""}.</p>
        </Strip>

        {/* ① Thanh kỳ và tiến độ */}
        <section aria-label="Thanh kỳ và tiến độ" className="space-y-2">
          <FilterBar
            onReset={activeCount ? resetFilters : undefined}
            activeCount={activeCount}
            actions={
              <>
                <button type="button" className={smallButton} disabled={save.busy} onClick={() => void save.run(() => downloadTemplate(period))}>Tải file mẫu</button>
                <button type="button" className={smallButton} disabled={save.busy || !canEdit} onClick={() => fileInput.current?.click()}>Import Excel</button>
                <input ref={fileInput} type="file" accept=".xlsx" className="sr-only" tabIndex={-1} aria-label="Chọn file Excel chi phí tháng" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) importFile(file); }} />
                <button type="button" className={smallButton} disabled={save.busy || !canApprove || !data.counts.draft} onClick={() => {
                  // Only the drafts this screen shows: a draft imported by someone else after it loaded is not approved unseen.
                  const draftIds = (allRows ?? []).filter((row) => row.status === "DRAFT").map((row) => row.userId);
                  if (draftIds.length && window.confirm(`Duyệt ${draftIds.length} bản nháp của ${periodLabel(period).toLowerCase()}? Bản Đã duyệt được dùng để tính đơn giá giờ (cost rate) cho P&L.`)) approve(draftIds);
                }}>Duyệt bản nháp</button>
              </>
            }
          >
            <FilterField label="Tìm kiếm" className="min-w-[200px] max-w-sm flex-1">
              <SearchFilter value={search} onChange={setSearch} placeholder="Tên hoặc mã nhân sự..." ariaLabel="Tìm nhân sự" className="" />
            </FilterField>
            <FilterField label="Tháng" className="shrink-0">
              <MonthFilter ariaLabel="Tháng" value={period} months={months} onChange={(next) => router.replace(`/users/costs?periodKey=${next}`, { scroll: false })} />
            </FilterField>
            <MultiSelectFilter label="Trạng thái" options={statusOptions} values={statuses} onChange={setStatuses} allLabel="Tất cả trạng thái" searchable={false} className="min-w-[170px] max-w-[16rem] flex-1" />
            <MultiSelectFilter label="Phòng ban" options={departmentOptions} values={departments} onChange={setDepartments} allLabel="Tất cả phòng ban" hideWhenSingle className="min-w-[170px] max-w-[16rem] flex-1" />
          </FilterBar>
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
              <th scope="col" title="Số tiền cho một giờ làm việc" className={`${head} !text-right`}>Đơn giá giờ</th><th scope="col" className={`${head} !text-right`}>Giờ đã ghi</th><th scope="col" className={head}>Nguồn</th><th scope="col" className={head}>Trạng thái</th>
              <th scope="col" className={head}><span className="sr-only">Thao tác</span></th>
            </tr></thead>
            <tbody>
              {rows.map((row) => {
                const waiting = row.waitingMinutes > 0;
                const waitingText = `${formatHoursValue(row.waitingMinutes)} giờ đã ghi trong tháng đang chờ chi phí tháng này`;
                return (
                  <tr key={row.userId} className={waiting ? "bg-amber-50" : "hover:bg-muted/25"}>
                    <td className={`${cell} font-mono text-xs`}>{row.employeeCode ?? <span className={toneClass.warn}>Chưa gán mã</span>}</td>
                    <td className={cell}><Link href={`/users/${encodeURIComponent(row.userId)}`} className="inline-flex items-center gap-1.5 font-medium !text-foreground hover:!text-primary hover:underline"><UserAvatar id={row.userId} name={row.displayName} size="xs" />{row.displayName}</Link>{row.department ? <span className="block text-[11px] text-muted-foreground">{row.department}</span> : null}</td>
                    {row.components
                      ? <><td className={`${num} font-semibold`}><HourlyRateCell rate={row.hourlyCostRate} status={row.status} /></td><td className={num}>{formatHoursValue(row.loggedMinutes)} giờ</td></>
                      : <td colSpan={2} className={`${cell} ${waiting ? "font-medium text-amber-700" : "text-muted-foreground"}`}>{waiting ? waitingText : "Chưa nhập đơn giá giờ tháng này"}</td>}
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
          {!rows.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{data.rows.length ? <>Không có kết quả phù hợp bộ lọc. <button type="button" onClick={resetFilters} className="font-semibold text-primary hover:underline">Đặt lại bộ lọc</button></> : "Chưa có nhân sự nào trong tháng. Bấm “Tải file mẫu”, điền chi phí rồi “Import Excel”."}</p> : null}
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
    <AppShell activeRoute="/users" title="Chi phí nhân sự theo tháng">
      <main className={pageMainClassName}>
        <PageHeader
          back={{ href: "/users", label: "Nhân sự" }}
          title="Chi phí nhân sự theo tháng"
          subtitle="Nhập đơn giá một giờ làm việc và duyệt; P&L lấy đơn giá đã duyệt nhân với số giờ được tính."
          meta="Chỉ nhóm quyền chi phí · đơn vị nhập là đồng/giờ"
        />
        {body}
      </main>
    </AppShell>
  );
}

/** Nhập / sửa đơn giá giờ cho một người, luôn lưu ở trạng thái Nháp; gán mã nhân sự của hệ thống lương. */
function StaffCostModal({ target, locked, reload, onClose }: Readonly<{ target: EditTarget; locked: boolean; reload: () => Promise<void>; onClose: () => void }>) {
  const save = useSave(reload);
  const [hourlyCostRate, setHourlyCostRate] = useState(() => target.hourlyCostRate === null || target.hourlyCostRate === undefined ? "" : formatMoneyInput(String(Math.round(target.hourlyCostRate))));
  const codeEditable = target.employeeCode !== undefined;
  const [employeeCode, setEmployeeCode] = useState(target.employeeCode ?? "");
  const month = periodLabel(target.periodKey).toLowerCase();

  async function submit() {
    const parsedRate = parseMoneyInput(hourlyCostRate);
    if (parsedRate === undefined || parsedRate <= 0) {
      await save.run(async () => { throw new Error("Nhập đơn giá giờ là số tiền lớn hơn 0 (đồng/giờ), không âm, không số lẻ."); });
      return;
    }
    const input: PnlStaffCostInput = { userId: target.userId, periodKey: target.periodKey, hourlyCostRate: parsedRate };
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
      footer={<>{target.status === "DRAFT" && !locked ? <button type="button" className="mr-auto text-sm font-semibold text-destructive hover:underline" disabled={save.busy} onClick={() => void removeDraft()}>Xóa bản nháp</button> : null}<ModalActions onCancel={onClose} busy={save.busy} disabled={locked} submitLabel="Lưu bản nháp" /></>}>
      <Field label="Đơn giá giờ (đồng/giờ)" htmlFor="staff-cost-hourly-rate">
        <input id="staff-cost-hourly-rate" inputMode="numeric" autoComplete="off" disabled={locked} value={hourlyCostRate} placeholder="Ví dụ: 150.000" onChange={(event) => setHourlyCostRate(formatMoneyInput(event.target.value))} className={`${inputClass} text-right font-mono tabular-nums`} />
      </Field>
      {codeEditable ? <Field label="Mã nhân sự (đúng mã của hệ thống lương)" htmlFor="staff-cost-code"><input id="staff-cost-code" value={employeeCode} maxLength={40} onChange={(event) => setEmployeeCode(event.target.value)} className={inputClass} placeholder="Ví dụ: NS-012" /></Field> : null}
      <Strip tone="muted">
        <p className="font-semibold">P&amp;L tính theo đơn giá giờ</p>
        <p className="mt-0.5 text-xs">Ví dụ: 150.000đ/giờ × 4 giờ được tính = 600.000đ chi phí. Lưu xong sẽ là Nháp; cần Duyệt bản nháp thì P&amp;L mới sử dụng{target.status === "APPROVED" ? "; bản Đã duyệt hiện tại sẽ quay về Nháp và cần duyệt lại" : ""}.</p>
      </Strip>
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
  const open = (periodKey: string, row?: StaffMonthlyCostRow) => setEditing({ userId, periodKey, components: row?.components ?? null, hourlyCostRate: row?.hourlyCostRate ?? null, status: row?.status ?? "NONE" });

  return (
    <section aria-labelledby="staff-cost-title" className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 id="staff-cost-title" className="!text-sm font-bold text-foreground">Chi phí theo tháng</h2>
          <p className="mt-1 text-xs text-muted-foreground">Chỉ nhóm quyền chi phí xem và sửa · nhập đơn giá đồng/giờ. P&amp;L tính đơn giá giờ đã duyệt × số giờ được tính. Cùng bảng với <Link href="/users/costs" className={linkClass}>Chi phí nhân sự theo tháng</Link>.</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <MonthFilter ariaLabel="Tháng cần nhập" value={newPeriod} onChange={setNewPeriod} />
            <button type="button" className={smallButton} disabled={lockedKeys.includes(newPeriod)} title={lockedKeys.includes(newPeriod) ? "Tháng đã khóa: mở lại kỳ ở Thiết lập P&L để sửa." : undefined} onClick={() => open(newPeriod, rows.find((row) => row.periodKey === newPeriod))}>Nhập tháng này</button>
          </div>
        ) : api.data ? <p role="status" className="text-xs text-muted-foreground">Chế độ chỉ xem (cần quyền Sửa chi phí).</p> : null}
      </div>
      {rows.some((row) => row.status === "DRAFT") ? (
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Strip tone="warn" action={<Link href={`/users/costs?periodKey=${encodeURIComponent(rows.find((row) => row.status === "DRAFT")?.periodKey ?? newPeriod)}`} className={linkClass}>Mở màn hình duyệt</Link>}>
            <p className="font-semibold">Chi phí đang là bản Nháp</p>
            <p className="mt-0.5 text-xs">Đơn giá giờ bên dưới chỉ là mức dự kiến. Duyệt bản Nháp ở màn hình tổng để chi phí xuất hiện trong P&amp;L.</p>
          </Strip>
        </div>
      ) : null}
      {api.error ? <div className="p-4"><PnlLoadError error={api.error} onRetry={api.reload} /></div> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr>
            <th scope="col" className={head}>Tháng</th>
            <th scope="col" title="Số tiền cho một giờ làm việc" className={`${head} !text-right`}>Đơn giá giờ</th><th scope="col" className={`${head} !text-right`}>Giờ chuẩn</th><th scope="col" className={head}>Nguồn</th><th scope="col" className={head}>Trạng thái</th>
            <th scope="col" className={head}><span className="sr-only">Thao tác</span></th>
          </tr></thead>
          <tbody>{rows.map((row) => {
            const status = row.status;
            return (
              <tr key={row.periodKey} className="hover:bg-muted/25">
                <td className={`${cell} font-semibold`}>{formatMonth(row.periodKey)}</td>
                <td className={`${num} font-semibold`}><HourlyRateCell rate={row.hourlyCostRate} status={row.status} /></td>
                <td className={num}>{formatHoursValue(row.standardHours * 60)} giờ</td>
                <td className={cell}>{row.sourceLabel}</td>
                <td className={`${cell} font-medium ${STATUS_TONE[status]}`}>{row.statusLabel}</td>
                <td className={`${cell} text-right`}>{canEdit && !row.locked && status !== "LOCKED" ? <button type="button" aria-label={`Sửa chi phí ${periodLabel(row.periodKey).toLowerCase()}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary" onClick={() => open(row.periodKey, row)}><Pencil className="h-3.5 w-3.5" aria-hidden /></button> : null}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {!rows.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{api.loading ? "Đang tải…" : api.error ? "" : "Chưa có chi phí tháng nào cho nhân sự này. Tháng chưa có chi phí Đã duyệt thì giờ đã ghi của tháng đó ở trạng thái Chờ xử lý."}</p> : null}
      </div>
      {editing ? <StaffCostModal target={editing} locked={lockedKeys.includes(editing.periodKey)} reload={api.reload} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
