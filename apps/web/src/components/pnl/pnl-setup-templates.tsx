"use client";

import Link from "next/link";
import { useState } from "react";
import type { PnlTemplateInput, PnlTemplatesResponse } from "@b2b-crm/contracts";
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import { FilterBar, FilterField, SearchFilter } from "@/components/filters";
import { formatDay } from "./pnl-format";
import { linkClass, LoadingBlock, Mark, ModalActions, PnlModal, SaveFeedback, smallButton, tableCellClass, tableHeadClass, useSave } from "./pnl-setup-ui";
import { cardClass, PnlLoadError, pnlRequest, usePnlLoad } from "./pnl-ui";

type TemplateData = PnlTemplatesResponse["data"];
const FORBIDDEN = "Chỉ tài khoản Admin vào được Thiết lập P&L. Tài khoản User không xem được mẫu khoản mục.";

/** Bật / tắt từng khoản mục của bộ mặc định. Chi phí nhân sự và dòng Tổng chi phí không tắt được (canDisable = false). */
export function TemplateItemChecklist({ items, disabledCodes, onChange, lockedOff = [] }: Readonly<{ items: TemplateData["items"]; disabledCodes: readonly string[]; onChange: (codes: string[]) => void; lockedOff?: readonly string[] }>) {
  const off = new Set(disabledCodes);
  return (
    <ul className="max-h-[45dvh] space-y-0.5 overflow-y-auto rounded-lg border border-border p-2">
      {items.map((item) => {
        const fixed = !item.canDisable || lockedOff.includes(item.code);
        return (
          <li key={item.code} style={{ paddingLeft: `${Math.max(0, item.level - 1) * 18}px` }}>
            <label className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm ${fixed ? "text-muted-foreground" : "text-foreground hover:bg-muted/50"}`}>
              <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={!off.has(item.code)} disabled={fixed}
                onChange={(event) => onChange(event.target.checked ? disabledCodes.filter((code) => code !== item.code) : [...disabledCodes, item.code])} />
              <span className={item.level === 1 ? "font-semibold" : ""}>{item.name}</span>
              {!item.canDisable ? <span className="text-[11px]">(luôn bật)</span> : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Mục 6.6 — tab Mẫu khoản mục: ① thẻ mẫu, ② bảng so sánh, ③ dự án ghi đè mẫu. */
export function PnlSetupTemplates() {
  const api = usePnlLoad<PnlTemplatesResponse>("/api/pnl/config/templates", "Không tải được mẫu khoản mục.");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const data = api.data?.data;
  if (!data || api.error) return api.loading ? <LoadingBlock rows={5} label="Đang tải mẫu khoản mục…" /> : (api.error ? <PnlLoadError error={api.error} onRetry={api.reload} forbiddenText={FORBIDDEN} /> : null);
  const editing = data.templates.find((template) => template.key === editingKey) ?? null;
  // One search over the three lists: template cards, the rows of the comparison, the overriding projects.
  const query = search.trim();
  const cards = data.templates.filter((template) => matchesSearch(query, template.name, template.description));
  const comparison = data.comparison.filter((row) => matchesSearch(query, row.label));
  const overrides = data.overrides.filter((entry) => matchesSearch(query, entry.projectName, entry.summary));
  const noMatch = <>Không có kết quả phù hợp bộ lọc. <button type="button" onClick={() => setSearch("")} className="font-semibold text-primary hover:underline">Đặt lại bộ lọc</button></>;

  return (
    <>
      <FilterBar onReset={query ? () => setSearch("") : undefined} activeCount={query ? 1 : 0}>
        <FilterField label="Tìm mẫu hoặc khoản mục" className="min-w-[220px] max-w-md flex-1">
          <SearchFilter value={search} onChange={setSearch} placeholder="Tên mẫu, khoản mục, tham số hoặc dự án ghi đè..." ariaLabel="Tìm mẫu hoặc khoản mục" className="" />
        </FilterField>
      </FilterBar>

      {/* ① Thẻ mẫu */}
      <ul aria-label="Thẻ mẫu" className="grid gap-3 md:grid-cols-3">
        {cards.map((template) => (
          <li key={template.key} className={`${cardClass} flex flex-col px-4 py-3.5`}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="!text-base font-bold text-foreground">{template.name}</h2>
              <button type="button" className={smallButton} aria-label={`Sửa mẫu ${template.name}`} onClick={() => setEditingKey(template.key)}>Sửa mẫu</button>
            </div>
            <p className="mt-1 flex-1 text-sm text-foreground">{template.description}</p>
            <p className="mt-3 text-sm text-muted-foreground">{template.enabledItemCount} khoản mục đang bật · {template.projectCount} dự án đang dùng</p>
          </li>
        ))}
      </ul>
      {!cards.length ? <p className={`${cardClass} p-5 text-sm text-muted-foreground`}>{data.templates.length ? noMatch : "Chưa có mẫu khoản mục nào."}</p> : null}

      {/* ② Bảng so sánh */}
      <section aria-label="Bảng so sánh" className={`${cardClass} overflow-x-auto`}>
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr>
            <th scope="col" className={tableHeadClass}>Khoản mục hoặc tham số có khác biệt</th>
            {data.templates.map((template) => <th key={template.key} scope="col" className={`${tableHeadClass} !text-center`}>{template.name}</th>)}
          </tr></thead>
          <tbody>
            {comparison.map((row) => (
              <tr key={`${row.kind}:${row.code}`}>
                <th scope="row" className={`${tableCellClass} text-left font-normal ${row.kind === "parameter" ? "!text-muted-foreground" : ""}`}>{row.label}</th>
                {data.templates.map((template) => {
                  const cell = row.cells[template.key];
                  return <td key={template.key} className={`${tableCellClass} text-center`}>{cell?.text !== undefined ? <span className={cell.text === "—" ? "text-muted-foreground" : ""}>{cell.text}</span> : cell?.enabled !== undefined ? <Mark ok={cell.enabled} okLabel="Bật" failLabel="Tắt" /> : <span className="text-muted-foreground">—</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!comparison.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{data.comparison.length ? noMatch : "Các mẫu chưa có khác biệt nào."}</p> : null}
      </section>
      <p className="text-sm text-muted-foreground">{data.comparisonNote}</p>

      {/* ③ Dự án ghi đè mẫu */}
      <section aria-labelledby="pnl-template-overrides" className={`${cardClass} px-4 py-3.5 sm:px-5`}>
        <h2 id="pnl-template-overrides" className="!text-base font-bold text-foreground">Dự án ghi đè mẫu ({data.overrides.length})</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-foreground">
          {overrides.map((entry) => <li key={entry.projectId}><Link href={`/projects/${encodeURIComponent(entry.projectId)}`} className={linkClass}>{entry.projectName}</Link> · {entry.summary} · {entry.byName ?? "—"} · {formatDay(entry.at)} · lý do: {entry.reason}</li>)}
          {data.overrides.length && !overrides.length ? <li className="text-muted-foreground">{noMatch}</li> : null}
          {!data.overrides.length ? <li className="text-muted-foreground">Chưa có dự án nào khác mẫu. Ghi đè (kèm lý do, chỉ ảnh hưởng dự án đó) ở Thiết lập P&amp;L trong chi tiết dự án.</li> : null}
        </ul>
      </section>

      {editing ? <TemplateModal template={editing} items={data.items} reload={api.reload} onClose={() => setEditingKey(null)} /> : null}
    </>
  );
}

function TemplateModal({ template, items, reload, onClose }: Readonly<{ template: TemplateData["templates"][number]; items: TemplateData["items"]; reload: () => Promise<void>; onClose: () => void }>) {
  const save = useSave(reload);
  const [disabledCodes, setDisabledCodes] = useState<string[]>(template.disabledCodes);
  async function submit() {
    const body: PnlTemplateInput = { disabledCodes };
    if (await save.run(() => pnlRequest(`/api/pnl/config/templates/${encodeURIComponent(template.key)}`, { method: "PUT", body }))) onClose();
  }
  return (
    <PnlModal title={`Mẫu ${template.name}: bật, tắt khoản mục`} onClose={onClose} onSubmit={() => void submit()} footer={<ModalActions onCancel={onClose} busy={save.busy} submitLabel="Lưu mẫu" />}>
      <p className="text-xs text-muted-foreground">Mẫu chỉ bật hoặc tắt khoản mục của bộ mặc định, không tạo cây riêng. Thay đổi có hiệu lực từ kỳ đang mở; dự án đã qua G7 giữ mẫu tại thời điểm nghiệm thu.</p>
      <TemplateItemChecklist items={items} disabledCodes={disabledCodes} onChange={setDisabledCodes} />
      <p className="text-xs text-muted-foreground">Đang tắt {disabledCodes.length} khoản mục.</p>
      <SaveFeedback error={save.error} message={null} />
    </PnlModal>
  );
}
