/** Display helpers of the Baseline block; no React here so they can be unit-tested. */
import { BASELINE_CAUSE_LABELS, type BaselineDiffEntry, type BaselineVersionSummary } from "@b2b-crm/contracts";
import { formatVietnamDate } from "@/lib/vietnam-time";

const ENTITY_LABELS: Record<BaselineDiffEntry["entity"], string> = { milestone: "Milestone", stage: "Stage", task: "Task" };
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

/** "Điểm chốt G1" / "Gia hạn stage". */
export function baselineCauseLabel(version: Pick<BaselineVersionSummary, "causeType" | "causeCode">): string {
  return `${BASELINE_CAUSE_LABELS[version.causeType] ?? version.causeType}${version.causeCode ? ` ${version.causeCode}` : ""}`;
}
