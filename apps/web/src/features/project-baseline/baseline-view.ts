/** Display helpers of the Baseline block and of the CR Log import; no React here so they can be unit-tested. */
import { BASELINE_CAUSE_LABELS, type BaselineDiffEntry, type BaselineVersionSummary } from "@b2b-crm/contracts";
import { formatVietnamDate } from "@/lib/vietnam-time";

const ENTITY_LABELS: Record<BaselineDiffEntry["entity"], string> = { lineItem: "Hạng mục", milestone: "Milestone", stage: "Stage", task: "Task" };
const CHANGE_LABELS = { added: "thêm mới", removed: "bỏ khỏi baseline" } as const;

function value(field: string, raw: string | number | null): string {
  if (raw === null || raw === "") return "—";
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw)) return formatVietnamDate(raw);
  if (typeof raw === "number" && field.includes("phút")) return `${Math.round((raw / 60) * 10) / 10} giờ`;
  return typeof raw === "number" ? raw.toLocaleString("vi-VN") : raw;
}

/** One line per changed row: "Task Khảo sát: Giờ dự kiến 8 giờ → 16 giờ". */
export function baselineDiffLine(entry: BaselineDiffEntry): string {
  const head = `${ENTITY_LABELS[entry.entity]} ${entry.name}`;
  if (entry.change !== "changed") return `${head}: ${CHANGE_LABELS[entry.change]}`;
  return `${head}: ${(entry.fields ?? []).map((item) => `${item.field.replace(" (phút)", "")} ${value(item.field, item.before)} → ${value(item.field, item.after)}`).join("; ")}`;
}

/** "Yêu cầu thay đổi CR-001" / "Điểm chốt G1" / "Gia hạn stage". */
export function baselineCauseLabel(version: Pick<BaselineVersionSummary, "causeType" | "causeCode">): string {
  return `${BASELINE_CAUSE_LABELS[version.causeType] ?? version.causeType}${version.causeCode ? ` ${version.causeCode}` : ""}`;
}

/** Minimal RFC 4180 reader (quotes, doubled quotes, commas or semicolons, CRLF) → rows keyed by the header line. */
export function parseCsvRows(text: string): Array<Record<string, string>> {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const separator = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const lines: string[][] = [[]];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { lines[lines.length - 1].push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      lines[lines.length - 1].push(cell);
      cell = "";
      lines.push([]);
    } else cell += char;
  }
  lines[lines.length - 1].push(cell);
  const [headers, ...body] = lines.filter((line) => line.some((item) => item.trim() !== ""));
  return (body ?? []).map((line) => Object.fromEntries((headers ?? []).map((header, index) => [header.trim(), (line[index] ?? "").trim()]).filter(([header]) => header)));
}
