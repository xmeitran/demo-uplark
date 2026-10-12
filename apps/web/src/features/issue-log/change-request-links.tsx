"use client";

/**
 * Parts of the issue log that belong to change requests only:
 *  - what the system created for a request (V-39 stage + evaluation task, V-30 line item) and effort assessed vs actual;
 *  - the import of the old CR Log file (9.4), CSV or XLSX. The API maps the columns and reports what it could not map.
 */
import React, { useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { CrLogImportResult, CrLogImportRow, ProjectRiskSummary } from "@b2b-crm/contracts";
import { apiErrorMessage, readApiError } from "@/lib/api-error";
import { parseCsvRows } from "@/features/project-baseline/baseline-view";

const md = (value?: number) => (value === undefined ? "—" : `${value.toLocaleString("vi-VN")} MD`);

export function ChangeRequestLinksBlock({ record, projectId }: { record: ProjectRiskSummary; projectId: string }) {
  const links = record.changeRequestLinks;
  if (record.type !== "change_request" || !links) return null;
  const tasksHref = `/projects/${encodeURIComponent(projectId)}?tab=Tasks`;
  const over = links.actualEffortMd !== undefined && links.estimatedEffortMd !== undefined && links.actualEffortMd > links.estimatedEffortMd;
  return (
    <dl aria-label="Liên kết của yêu cầu thay đổi" className="mb-4 grid gap-x-6 gap-y-1.5 rounded-lg border border-border bg-background p-3 text-xs sm:grid-cols-3">
      <div>
        <dt className="font-bold text-foreground">Stage của yêu cầu</dt>
        <dd className="text-muted-foreground">{links.stageName ? <><a href={tasksHref} className="!text-primary underline">{links.stageName}</a>{links.evaluationTaskTitle ? <> · task “{links.evaluationTaskTitle}” ({md(links.evaluationEffortMd)} đã ghi)</> : null}</> : "Chưa tạo (sinh khi PM kết luận là yêu cầu thay đổi)"}</dd>
      </div>
      <div>
        <dt className="font-bold text-foreground">Hạng mục hợp đồng</dt>
        <dd className="text-muted-foreground">{links.contractItemCode ? `${links.contractItemCode} · ${links.contractItemName}` : "Tạo khi khách duyệt (CR-07C)"}</dd>
      </div>
      <div>
        <dt className="font-bold text-foreground">Effort đánh giá · thực tế</dt>
        <dd className="text-muted-foreground">{md(links.estimatedEffortMd)} · <span className={over ? "font-semibold text-rose-600" : "text-foreground"}>{md(links.actualEffortMd)}</span>{links.actualEffortMd !== undefined ? " (tự tính từ giờ log)" : ""}</dd>
      </div>
    </dl>
  );
}

async function readRows(file: File): Promise<CrLogImportRow[]> {
  if (/\.csv$/i.test(file.name)) return parseCsvRows(await file.text());
  const { loadExcelWorkbook } = await import("@/lib/excel-import");
  const sheet = (await loadExcelWorkbook(await file.arrayBuffer())).worksheets[0];
  if (!sheet) return [];
  const cell = (value: unknown): string | number | null => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object") return String((value as { text?: unknown; result?: unknown }).text ?? (value as { result?: unknown }).result ?? "");
    return typeof value === "number" ? value : String(value);
  };
  const headers = ((sheet.getRow(1).values as unknown[]) ?? []).map((value) => String(cell(value) ?? "").trim());
  const rows: CrLogImportRow[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const values = row.values as unknown[];
    rows.push(Object.fromEntries(headers.map((header, column) => [header, cell(values[column])] as const).filter(([header]) => header)));
  });
  return rows;
}

export function CrLogImportButton({ projectId, onImported }: { projectId: string; onImported: () => void | Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CrLogImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const rows = await readRows(file);
      if (!rows.length) throw new Error("File không có dòng dữ liệu nào.");
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/risks/import`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }) });
      if (!response.ok) throw await readApiError(response);
      setResult((await response.json()) as CrLogImportResult);
      await onImported();
    } catch (failure) {
      setError(apiErrorMessage(failure, "Không nhập được file CR Log."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input ref={input} type="file" accept=".csv,.xlsx" aria-label="File CR Log" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
      <button type="button" disabled={busy} title="Admin: nhập file CR Log cũ (CSV hoặc XLSX), giữ nguyên mã CR" onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-60">
        <Upload className="h-3.5 w-3.5" /> {busy ? "Đang nhập…" : "Nhập CR Log"}
      </button>
      {error ? <p role="alert" className="basis-full text-xs text-rose-600">{error}</p> : null}
      {result ? (
        <div role="status" className="basis-full rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <p className="text-foreground">Đã nhập {result.created.length} yêu cầu thay đổi; {result.unchanged.length} mã đã có trong sổ nên giữ nguyên{result.rejected.length ? `; ${result.rejected.length} dòng không nhập được` : ""}. Mã CR tiếp theo: CR-{String(result.counterLast + 1).padStart(3, "0")}.</p>
          {result.rejected.length ? <ul className="mt-1 list-disc pl-4">{result.rejected.map((item) => <li key={item.row}>Dòng {item.row}{item.code ? ` (${item.code})` : ""}: {item.reason}</li>)}</ul> : null}
          {result.unmappedColumns.length ? <p className="mt-1">Cột không dùng: {result.unmappedColumns.join(", ")}.</p> : null}
        </div>
      ) : null}
    </>
  );
}
