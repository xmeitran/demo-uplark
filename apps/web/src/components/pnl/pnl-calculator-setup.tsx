"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ProjectCostCategory } from "@b2b-crm/contracts";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { EXPENSE_GROUPS } from "./pnl-data";
import { inputClass, moneyFormat, readParameterValue, secondaryButton, thClass } from "./pnl-cost-shared";

/** A number the user maintains for the month; formulas refer to it by its code. */
export type CalcParameter = { code: string; label: string; value: string; type?: string; scope?: string };
/** A cost the system calculates per project from a user formula. */
export type CalcItem = { code: string; label: string; category: ProjectCostCategory; formula: string; active: boolean };

// Figures the system supplies for each project and month. Everything else is a user parameter.
export const SYSTEM_VARIABLES: Array<{ code: string; meaning: string }> = [
  { code: "DOANH_THU_THANG", meaning: "Doanh thu nhập tay của project trong tháng (0 nếu chưa nhập)" },
  { code: "DOANH_THU_KE_HOACH", meaning: "Doanh thu kế hoạch của cả project" },
  { code: "GIO_DUYET", meaning: "Số giờ đã duyệt của project trong tháng" },
  { code: "CP_NHAN_SU", meaning: "Chi phí nhân sự trong tháng (giờ đã duyệt × cost rate)" },
  { code: "CP_KHAC", meaning: "Tổng chi phí khác đã nhập cho project trong tháng" },
  { code: "QUY_DUNG_CHUNG", meaning: "Phần quỹ dùng chung project được chia trong tháng" },
  { code: "SO_NHAN_SU", meaning: "Số người có giờ đã duyệt ở project trong tháng" }
];
const SYSTEM_CODES = new Set(SYSTEM_VARIABLES.map((variable) => variable.code));
const CATEGORY_OPTIONS = EXPENSE_GROUPS.filter((group) => group.key !== "salaries-related").map((group) => ({ value: group.key, label: group.label, subtext: group.hint }));

/** Codes are typed by people: keep them to letters, digits and underscores, upper-cased. */
export function normalizeCode(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "D").toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+/, "").slice(0, 40);
}

function parameterProblem(parameter: CalcParameter, all: CalcParameter[]) {
  if (!parameter.code) return "Thiếu mã";
  if (SYSTEM_CODES.has(parameter.code)) return "Trùng tên biến hệ thống";
  if (all.filter((other) => other.code === parameter.code).length > 1) return "Mã bị trùng";
  if (readParameterValue(parameter.value) === undefined) return "Chưa có giá trị số";
  return null;
}

export function ParametersEditor({ parameters, disabled, onChange }: Readonly<{ parameters: CalcParameter[]; disabled: boolean; onChange: (parameters: CalcParameter[]) => void }>) {
  const update = (index: number, patch: Partial<CalcParameter>) => onChange(parameters.map((parameter, position) => position === index ? { ...parameter, ...patch } : parameter));
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="!text-sm font-bold">Tham số của tháng</h2><p className="mt-0.5 text-xs text-muted-foreground">Các con số bạn tự nhập (tỷ lệ, đơn giá, tỷ giá, định mức…). Công thức gọi tham số bằng <strong>mã</strong>. Hệ thống không tự đặt giá trị nào.</p></div>
        <button type="button" disabled={disabled} className={secondaryButton} onClick={() => onChange([...parameters, { code: "", label: "", value: "" }])}><Plus className="h-4 w-4" /> Thêm tham số</button>
      </div>
      {parameters.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead><tr className="border-b border-border bg-muted/30"><th className={thClass}>Tên tham số</th><th className={`${thClass} w-56`}>Mã dùng trong công thức</th><th className={`${thClass} w-48`}>Giá trị</th><th className={thClass}>Hệ thống hiểu là</th><th className={`${thClass} w-12`}><span className="sr-only">Xóa</span></th></tr></thead>
            <tbody>
              {parameters.map((parameter, index) => {
                const problem = parameterProblem(parameter, parameters);
                const value = readParameterValue(parameter.value);
                return (
                  <tr key={index} className="border-b border-border/50">
                    <td className="px-4 py-2.5"><input aria-label={`Tên tham số ${index + 1}`} disabled={disabled} value={parameter.label} placeholder="Ví dụ: Tỷ lệ hoa hồng bán hàng" onChange={(event) => update(index, { label: event.target.value, ...(parameter.code ? {} : { code: normalizeCode(event.target.value) }) })} onBlur={() => { if (!parameter.code && parameter.label) update(index, { code: normalizeCode(parameter.label) }); }} className={inputClass} /></td>
                    <td className="px-4 py-2.5"><input aria-label={`Mã tham số ${index + 1}`} disabled={disabled} value={parameter.code} placeholder="TY_LE_HOA_HONG" onChange={(event) => update(index, { code: normalizeCode(event.target.value) })} className={`${inputClass} font-mono text-xs`} /></td>
                    <td className="px-4 py-2.5"><input aria-label={`Giá trị ${parameter.code || index + 1}`} disabled={disabled} value={parameter.value} placeholder="5% hoặc 26.300" onChange={(event) => update(index, { value: event.target.value })} className={`${inputClass} text-right font-mono`} /></td>
                    <td className="px-4 py-2.5 text-xs">{problem ? <span className="font-semibold text-destructive">{problem}</span> : <span className="font-mono text-muted-foreground">{new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }).format(value ?? 0)}</span>}</td>
                    <td className="px-2 py-2.5 text-right"><button type="button" disabled={disabled} aria-label={`Xóa tham số ${parameter.code || index + 1}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" onClick={() => onChange(parameters.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="px-4 py-8 text-center text-sm text-muted-foreground">Chưa có tham số nào cho tháng này. Thêm tham số, hoặc chép thiết lập từ tháng trước.</p>}
      <p className="border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">Viết tỷ lệ kèm dấu % (5% = 0,05). Số có đúng 3 chữ số sau một dấu chấm hoặc dấu phẩy (26.300, 1,250) được hiểu là hàng nghìn; số bắt đầu bằng 0 (0.125, 0,005) luôn là số thập phân. Khi có cả hai dấu, dấu đứng sau là dấu thập phân (1.250,5 = 1,250.5). Luôn kiểm tra cột “Hệ thống hiểu là”.</p>
    </section>
  );
}

export function FormulaItemsEditor({ items, parameters, results, disabled, onChange }: Readonly<{ items: CalcItem[]; parameters: CalcParameter[]; results: Record<string, number>; disabled: boolean; onChange: (items: CalcItem[]) => void }>) {
  const update = (index: number, patch: Partial<CalcItem>) => onChange(items.map((item, position) => position === index ? { ...item, ...patch } : item));
  const parameterCodes = parameters.filter((parameter) => parameter.code && !parameterProblem(parameter, parameters));
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="!text-sm font-bold">Khoản chi phí tính theo công thức</h2><p className="mt-0.5 text-xs text-muted-foreground">Mỗi khoản được tính riêng cho từng project có hoạt động trong tháng, rồi cộng vào chi phí của project theo nhóm đã chọn.</p></div>
          <button type="button" disabled={disabled} className={secondaryButton} onClick={() => onChange([...items, { code: `KHOAN_${Date.now().toString(36).toUpperCase()}`, label: "", category: "functional-operation", formula: "", active: true }])}><Plus className="h-4 w-4" /> Thêm khoản</button>
        </div>
        {items.length ? (
          <ul className="divide-y divide-border">
            {items.map((item, index) => (
              <li key={item.code} className={`space-y-3 px-4 py-4 ${item.active ? "" : "opacity-60"}`}>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px_auto]">
                  <input aria-label={`Tên khoản ${index + 1}`} disabled={disabled} value={item.label} placeholder="Ví dụ: Hoa hồng bán hàng" onChange={(event) => update(index, { label: event.target.value })} className={inputClass} />
                  <CrmSelect ariaLabel={`Nhóm chi phí của khoản ${index + 1}`} disabled={disabled} options={CATEGORY_OPTIONS} value={item.category} onChange={(category) => update(index, { category: category as ProjectCostCategory })} />
                  <div className="flex items-center justify-end gap-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><input type="checkbox" disabled={disabled} checked={item.active} onChange={(event) => update(index, { active: event.target.checked })} className="h-4 w-4 rounded border-input" /> Đang dùng</label>
                    <button type="button" disabled={disabled} aria-label={`Xóa khoản ${item.label || index + 1}`} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" onClick={() => onChange(items.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor={`formula-${item.code}`}>Công thức</label>
                  <input id={`formula-${item.code}`} disabled={disabled} value={item.formula} spellCheck={false} autoComplete="off" placeholder="DOANH_THU_THANG × TY_LE_HOA_HONG" onChange={(event) => update(index, { formula: event.target.value })} className={`${inputClass} font-mono text-xs`} />
                </div>
                <p className="text-xs text-muted-foreground">Kết quả theo số đã lưu: <strong className="font-mono text-foreground">{results[item.code] === undefined ? "chưa có" : `${moneyFormat.format(results[item.code])} ₫`}</strong>{results[item.code] === undefined ? " — lưu thiết lập để tính." : " cộng cho các project trong tháng."}</p>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-8 text-center text-sm text-muted-foreground">Chưa có khoản nào tính theo công thức. P&amp;L tháng này chỉ gồm chi phí nhân sự, chi phí nhập tay và quỹ dùng chung.</p>}
      </section>
      <aside className="space-y-4">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="!text-sm font-bold">Biến hệ thống cung cấp</h2>
          <dl className="mt-3 space-y-2.5">{SYSTEM_VARIABLES.map((variable) => <div key={variable.code}><dt className="font-mono text-xs font-semibold text-primary">{variable.code}</dt><dd className="text-xs text-muted-foreground">{variable.meaning}</dd></div>)}</dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="!text-sm font-bold">Tham số của bạn</h2>
          {parameterCodes.length ? <ul className="mt-3 space-y-1.5">{parameterCodes.map((parameter) => <li key={parameter.code} className="flex items-baseline justify-between gap-3 text-xs"><span className="font-mono font-semibold text-primary">{parameter.code}</span><span className="truncate text-muted-foreground">{parameter.value}</span></li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">Chưa có. Thêm ở tab Tham số.</p>}
        </section>
        <section className="rounded-xl border border-border bg-card p-4 text-xs leading-5 text-muted-foreground">
          <h2 className="!text-sm font-bold text-foreground">Cách viết công thức</h2>
          <p className="mt-2">Dùng số, mã, và các phép <span className="font-mono">+ − × ÷ ( )</span>. Thêm <span className="font-mono">%</span> sau một số để chia 100. Có sẵn <span className="font-mono">MIN(a, b)</span>, <span className="font-mono">MAX(a, b)</span>, <span className="font-mono">ROUND(a, số chữ số)</span>. Chia cho 0 cho kết quả 0.</p>
          <p className="mt-2">Trong công thức, số thập phân <strong>chỉ viết bằng dấu chấm</strong> (<span className="font-mono">21.5</span>) và <strong>không dùng dấu phân cách hàng nghìn</strong> (<span className="font-mono">1250000</span>). Dấu phẩy và dấu chấm phẩy luôn là dấu tách đối số của hàm: <span className="font-mono">ROUND(X/3, 2)</span>. Viết <span className="font-mono">X*21,5</span> hay <span className="font-mono">26.300</span> sẽ bị báo lỗi, không tự đoán.</p>
        </section>
      </aside>
    </div>
  );
}
