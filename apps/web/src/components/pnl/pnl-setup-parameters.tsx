"use client";

import Link from "next/link";
import { useState } from "react";
import type { PnlParameterRow, PnlParametersResponse, PnlParameterScopeType, PnlParameterValueInput, PnlStandardHoursResponse } from "@b2b-crm/contracts";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { currentPeriodKey, inputClass, parseDecimalInput } from "./pnl-cost-shared";
import { formatDay, formatMonth } from "./pnl-format";
import { Field, linkClass, LoadingBlock, SaveFeedback, tableCellClass, tableHeadClass, useSave } from "./pnl-setup-ui";
import { cardClass, PnlLoadError, pnlRequest, primaryButtonClass, secondaryButtonClass, usePnlLoad } from "./pnl-ui";

const SCOPE_LABELS: Record<PnlParameterScopeType, string> = { company: "Công ty", customer: "Khách hàng", project_type: "Loại dự án", project: "Dự án" };
const FORBIDDEN = "Chỉ tài khoản Admin vào được Thiết lập P&L. Tài khoản User không xem được tham số.";
const rowKey = (row: Pick<PnlParameterRow, "key" | "subKey">) => `${row.key}:${row.subKey ?? ""}`;

/** Where a moved parameter now lives (khối 2): the destination text comes from the API, the link is this app's route. */
function movedHref(movedTo: string): string | null {
  if (movedTo.includes("Quỹ chi phí chung")) return "/pnl/costs?tab=funds";
  if (movedTo.includes("Hồ sơ nhân sự")) return "/users/costs";
  return null;
}

/** Mục 6.3 — tab Tham số: ① bảng tham số (chỉ đọc), ② tham số đã chuyển đi, ③ giá trị theo phạm vi và lịch sử. */
export function PnlSetupParameters() {
  const api = usePnlLoad<PnlParametersResponse>("/api/pnl/config/parameters", "Không tải được tham số.");
  const save = useSave(api.reload);
  const [selectedKey, setSelectedKey] = useState("commissionPercent:");
  const [showMonths, setShowMonths] = useState(false);
  const data = api.data?.data;
  if (!data || api.error) return api.loading ? <LoadingBlock rows={6} label="Đang tải tham số…" /> : (api.error ? <PnlLoadError error={api.error} onRetry={api.reload} forbiddenText={FORBIDDEN} /> : null);

  const selected = data.rows.find((row) => rowKey(row) === selectedKey) ?? data.rows[0] ?? null;

  return (
    <>
      {/* ① Bảng tham số */}
      <section aria-label="Bảng tham số" className={`${cardClass} overflow-x-auto`}>
        <table className="w-full min-w-[680px] text-sm">
          <thead><tr>
            <th scope="col" className={tableHeadClass}>Tham số</th><th scope="col" className={tableHeadClass}>Giá trị mặc định</th><th scope="col" className={tableHeadClass}>Phạm vi</th>
            <th scope="col" className={tableHeadClass}>Giá trị riêng</th><th scope="col" className={tableHeadClass}>Hiệu lực từ</th><th scope="col" className={tableHeadClass}><span className="sr-only">Ghi chú</span></th>
          </tr></thead>
          <tbody>
            {data.rows.map((row) => {
              const active = selected ? rowKey(row) === rowKey(selected) : false;
              const empty = row.defaultValueText === null;
              const cell = `${tableCellClass} ${row.derived ? "!border-b-0" : ""} ${empty && !active ? "!text-muted-foreground" : ""}`;
              return [
                <tr key={rowKey(row)} className={active ? "bg-primary/10" : "hover:bg-muted/25"}>
                  <td className={cell}><button type="button" aria-pressed={active} aria-label={`Xem giá trị theo phạm vi của ${row.label}`} className={`rounded text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "!font-bold" : ""}`} onClick={() => setSelectedKey(rowKey(row))}>{row.label}</button></td>
                  <td className={cell}>{row.defaultValueText ?? "Chưa nhập"}</td>
                  <td className={cell}>{row.scopeText}</td>
                  <td className={cell}>{empty && !row.specificValueCount ? "" : row.specificValueCount}</td>
                  <td className={cell}>{row.effectiveFrom ? formatMonth(row.effectiveFrom) : ""}</td>
                  <td className={`${cell} whitespace-nowrap text-right`}>
                    {row.derived ? <button type="button" aria-expanded={showMonths} className={linkClass} onClick={() => setShowMonths((value) => !value)}>Xem ›</button> : <span className="text-muted-foreground">{row.note ?? ""}</span>}
                  </td>
                </tr>,
                row.derived ? (
                  <tr key={`${rowKey(row)}:derived`} className={active ? "bg-primary/10" : undefined}>
                    <td colSpan={6} className="border-b border-border/70 px-4 pb-3 pl-10 text-sm text-muted-foreground">
                      {row.derived.text}
                      {showMonths ? <StandardHoursList year={row.derived.periodKey.slice(0, 4)} /> : null}
                    </td>
                  </tr>
                ) : null
              ];
            })}
          </tbody>
        </table>
        {!data.rows.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Chưa có tham số nào.</p> : null}
      </section>
      <p className="text-sm text-muted-foreground">{data.priorityNote}</p>

      <div className={`grid items-start gap-4 ${data.moved.length ? "lg:grid-cols-2" : ""}`}>
        {/* ② Tham số đã chuyển đi */}
        {data.moved.length ? (
          <section aria-label="Tham số đã chuyển đi" className="rounded-xl border border-border bg-muted/50 p-4 sm:p-5">
            <h2 className="!text-base font-bold text-foreground">Tham số đã chuyển đi</h2>
            <p className="text-sm text-muted-foreground">Mục này chỉ hiển thị trong giai đoạn chuyển đổi.</p>
            <ul className="mt-3 space-y-2.5 text-sm text-foreground">
              {data.moved.map((entry) => { const href = movedHref(entry.movedTo); return <li key={entry.label}>{entry.label} → {href ? <Link href={href} className={linkClass}>{entry.movedTo}</Link> : entry.movedTo}</li>; })}
            </ul>
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">Ngưỡng cảnh báo và các tham số hệ thống khác vẫn ở <Link href="/admin#parameters" className={linkClass}>Admin › Tham số</Link>; lịch nghỉ, lễ ở <Link href="/admin#day-offs" className={linkClass}>Admin › Ngày nghỉ</Link>.</p>
          </section>
        ) : null}

        {/* ③ Giá trị theo phạm vi và lịch sử */}
        {selected ? <ValuePanel key={rowKey(selected)} row={selected} data={data} save={save} /> : null}
      </div>
    </>
  );
}

/** "Xem ›" of Giờ chuẩn một ngày: giờ chuẩn của từng tháng, tính từ lịch ngày nghỉ. */
function StandardHoursList({ year }: Readonly<{ year: string }>) {
  const api = usePnlLoad<PnlStandardHoursResponse>(`/api/pnl/calendar/standard-hours?from=${year}-01&to=${year}-12`, "Không tải được giờ chuẩn theo tháng.");
  if (!api.data) return <p className="mt-2 text-xs">{api.loading ? "Đang tải giờ chuẩn từng tháng…" : <>{api.error?.message} <button type="button" className={linkClass} onClick={() => void api.reload()}>Thử lại</button></>}</p>;
  return (
    <div className="mt-2">
      <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {api.data.data.map((month) => <li key={month.periodKey} title={month.holidays.map((holiday) => `${formatDay(holiday.dateKey, false)} ${holiday.name}`).join(", ") || undefined}>{formatMonth(month.periodKey)}: {month.workingDays} ngày × {month.standardDayHours} = <span className="font-semibold text-foreground">{month.standardHours} giờ</span>{month.holidays.length ? ` · ${month.holidays.length} ngày lễ` : ""}</li>)}
      </ul>
      <p className="mt-1.5 text-xs">Đổi lịch nghỉ, lễ ở <Link href="/admin#day-offs" className={linkClass}>Admin › Ngày nghỉ</Link>.</p>
    </div>
  );
}

function ValuePanel({ row, data, save }: Readonly<{ row: PnlParameterRow; data: PnlParametersResponse["data"]; save: ReturnType<typeof useSave> }>) {
  const [adding, setAdding] = useState(false);
  const [scopeType, setScopeType] = useState<PnlParameterScopeType>(row.allowedScopes[0] ?? "company");
  const [scopeId, setScopeId] = useState("");
  const [value, setValue] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(data.openPeriodKeys.includes(currentPeriodKey()) ? currentPeriodKey() : data.openPeriodKeys[0] ?? "");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const current = row.values.filter((entry) => entry.current);
  const isGate = row.key === "pnlCloseGate";
  const targets = scopeType === "customer" ? data.scopeOptions.customers.map((entry) => ({ value: entry.id, label: entry.name }))
    : scopeType === "project" ? data.scopeOptions.projects.map((entry) => ({ value: entry.id, label: entry.name }))
    : scopeType === "project_type" ? data.scopeOptions.projectTypes : [];
  const id = `pnl-param-${row.key}-${row.subKey ?? "x"}`;

  async function submit() {
    const parsed = isGate ? value : parseDecimalInput(value);
    if (parsed === undefined || parsed === "") { setFormError("Nhập giá trị."); return; }
    if (scopeType !== "company" && !scopeId) { setFormError(`Chọn ${SCOPE_LABELS[scopeType].toLowerCase()} áp dụng.`); return; }
    if (!effectiveFrom) { setFormError("Chọn kỳ hiệu lực (chỉ kỳ đang mở)."); return; }
    if (!reason.trim()) { setFormError("Nhập lý do (bắt buộc)."); return; }
    setFormError(null);
    const body: PnlParameterValueInput = { key: row.key, subKey: row.subKey, scopeType, scopeId: scopeType === "company" ? null : scopeId, value: parsed, effectiveFrom, reason: reason.trim() };
    if (await save.run(() => pnlRequest("/api/pnl/config/parameters", { method: "POST", body }), `Đã thêm giá trị mới cho ${row.label}.`)) { setAdding(false); setValue(""); setReason(""); }
  }

  return (
    <section aria-label={`${row.label}: giá trị theo phạm vi và lịch sử`} className="rounded-xl border border-primary bg-card p-4 shadow-sm sm:p-5">
      <h2 className="!text-base font-bold text-foreground">{row.label} · giá trị theo phạm vi</h2>
      <ul className="mt-2 space-y-1 text-sm text-foreground">
        {current.map((entry) => <li key={entry.id}>{entry.scopeLabel} · {entry.valueText ?? "—"} · từ {formatMonth(entry.effectiveFrom)}</li>)}
        {!current.length ? <li className="text-muted-foreground">Chưa có giá trị nào. Thêm giá trị mới ở dưới.</li> : null}
      </ul>
      <div className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm text-muted-foreground">
        {row.history.length
          ? row.history.map((entry, index) => <p key={`${entry.at}:${index}`}>{index === 0 ? "Lịch sử: " : ""}{formatDay(entry.at, false)} · {entry.text} · {entry.byName ?? "—"}{entry.reason ? ` · lý do: ${entry.reason}` : ""}</p>)
          : <p>Lịch sử: chưa có thay đổi nào.</p>}
      </div>
      <div className="mt-3 space-y-3">
        <SaveFeedback error={save.error} message={save.message} />
        {!adding ? (
          <button type="button" aria-expanded={false} className="w-full rounded-lg border border-primary px-3.5 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => { save.clear(); setAdding(true); }}>+ Thêm giá trị mới: phạm vi · giá trị · kỳ · lý do</button>
        ) : (
          <form className="space-y-3 rounded-lg border border-primary p-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <p className="text-sm font-semibold text-foreground">Thêm giá trị mới</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phạm vi"><CrmSelect ariaLabel="Phạm vi" value={scopeType} onChange={(next) => { setScopeType(next as PnlParameterScopeType); setScopeId(""); }} options={row.allowedScopes.map((scope) => ({ value: scope, label: SCOPE_LABELS[scope] }))} /></Field>
              {scopeType !== "company" ? <Field label={`${SCOPE_LABELS[scopeType]} áp dụng`}><CrmSelect ariaLabel={`${SCOPE_LABELS[scopeType]} áp dụng`} value={scopeId} onChange={setScopeId} options={targets} searchable placeholder="Chọn…" /></Field> : null}
              <Field label={`Giá trị${row.unit ? ` (${row.unit})` : ""}`} htmlFor={`${id}-value`}>
                {isGate
                  ? <CrmSelect id={`${id}-value`} ariaLabel="Giá trị" value={value} onChange={setValue} placeholder="Chọn mốc…" options={[{ value: "G7", label: "G7 (nghiệm thu)" }, { value: "G8", label: "G8" }]} />
                  : <input id={`${id}-value`} inputMode="decimal" autoComplete="off" autoFocus value={value} onChange={(event) => setValue(event.target.value)} className={inputClass} />}
              </Field>
              <Field label="Hiệu lực từ kỳ" hint="Chỉ kỳ đang mở; kỳ đã khóa không nhận giá trị mới."><CrmSelect ariaLabel="Hiệu lực từ kỳ" value={effectiveFrom} onChange={setEffectiveFrom} placeholder="Chọn kỳ…" options={data.openPeriodKeys.map((periodKey) => ({ value: periodKey, label: formatMonth(periodKey) }))} /></Field>
            </div>
            <Field label="Lý do (bắt buộc)" htmlFor={`${id}-reason`}><input id={`${id}-reason`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={inputClass} /></Field>
            {formError ? <p role="alert" className="text-xs font-semibold text-red-700">{formError}</p> : null}
            <p className="text-[11px] text-muted-foreground">Giá trị mới không sửa đè giá trị cũ; người thêm và thời điểm được ghi vào lịch sử.</p>
            <div className="flex justify-end gap-2"><button type="button" className={secondaryButtonClass} disabled={save.busy} onClick={() => setAdding(false)}>Hủy</button><button type="submit" className={primaryButtonClass} disabled={save.busy}>{save.busy ? "Đang lưu…" : "Thêm giá trị"}</button></div>
          </form>
        )}
      </div>
    </section>
  );
}
