import type { PnlFixTarget, PnlGateReasonCode, PnlGateStatusCode, PnlMonthMissing, PnlPendingStripItem, PnlReason, PnlResult, PnlResultLabelCode } from "@b2b-crm/contracts";
import { formatHoursValue, formatMonth } from "./pnl-format";
import { fixTargetHref } from "./pnl-query";

/*
 * Plain Vietnamese for the P&L screens. The API keeps its codes and its own short labels; a first-time reader gets
 * the sentences below instead, built from the codes and counts the API already returns. Wording only — no figure,
 * rule or condition is decided here.
 */

/** The phrase used everywhere in place of "cost rate". */
export const STAFF_COST_PHRASE = "chi phí nhân sự tháng được duyệt";
export const COST_GROUP_ONLY = "Chỉ nhóm quyền chi phí xem được số tiền";

export const RESULT_NAME: Record<PnlResultLabelCode, string> = { official: "Chính thức", provisional: "Tạm tính", not_computable: "Không tính được" };

export const RESULT_MEANING: Record<PnlResultLabelCode, string> = {
  official: "Chính thức: dự án đã nghiệm thu, đủ dữ liệu và mọi tháng đã khóa sổ — số không đổi nữa.",
  provisional: "Tạm tính: đã có số nhưng còn dữ liệu chờ bổ sung hoặc còn tháng chưa khóa sổ — số còn có thể đổi.",
  not_computable: "Không tính được: thiếu dữ liệu bắt buộc nên chưa ra được lãi lỗ; dự án chưa được cộng vào các ô tổng."
};

const monthList = (keys: readonly string[] | undefined) => (keys?.length ? keys.map((key) => formatMonth(key)).join(", ") : "");
const inMonths = (keys: readonly string[] | undefined) => (keys?.length ? ` (tháng ${monthList(keys)})` : "");
const hoursOf = (minutes: number | undefined) => (minutes === undefined ? "Có" : formatHoursValue(minutes));

/** One reason a project is Tạm tính / Không tính được, as a full sentence. */
export function plainReason(reason: PnlReason): string {
  const hours = hoursOf(reason.minutes);
  switch (reason.code) {
    case "no_project_value": return "Chưa có Giá trị dự án nên chưa tính được doanh thu";
    case "no_cost_rate": return `Chưa có ${STAFF_COST_PHRASE} nào nên chưa tính được chi phí nhân sự`;
    case "not_closed": return "Dự án chưa nghiệm thu (chưa qua mốc G7)";
    case "missing_acceptance_date": return "Chưa có ngày nghiệm thu (G7); tháng nghiệm thu đang là ước lượng";
    case "pending_cost_rate": return `${hours} giờ chưa có ${STAFF_COST_PHRASE}${inMonths(reason.periodKeys)}`;
    case "pending_classification": return `${hours} giờ chưa phân loại công việc`;
    case "pending_layer2_mismatch": return `${hours} giờ chọn loại công việc không khớp với task`;
    case "pending_locked_period": return `${hours} giờ ghi bù vào tháng đã khóa sổ`;
    case "months_unlocked": return `Tháng ${monthList(reason.periodKeys)} chưa khóa sổ`;
    case "fund_unallocated": return `Quỹ chi phí chung tháng ${monthList(reason.periodKeys)} chưa chia cho dự án`;
    case "missing_commission_rate": return "Chưa nhập tỷ lệ hoa hồng";
    case "uncosted_hours": return `${hours} giờ ngoài P&L dự án chưa có ${STAFF_COST_PHRASE}`;
    default: return reason.label;
  }
}

/** What the result badge says on hover: what the label means, then this project's reasons. */
export function resultExplanation(result: PnlResult): string {
  const reasons = result.reasons.map(plainReason);
  return reasons.length ? `${RESULT_MEANING[result.label]} Lý do: ${reasons.join("; ")}.` : RESULT_MEANING[result.label];
}

/** Why a "Không tính được" row has no figure: only the reasons that block the calculation. */
export function notComputableWhy(result: PnlResult): string | null {
  if (result.label !== "not_computable") return null;
  const blocking = result.reasons.filter((reason) => reason.code === "no_project_value" || reason.code === "no_cost_rate");
  return (blocking.length ? blocking : result.reasons).map(plainReason).join("; ") || "Thiếu dữ liệu bắt buộc";
}

/** The caption / tooltip of an empty money cell ("—"). */
export function whyNoValue(moneyVisible: boolean, result?: PnlResult): string {
  if (!moneyVisible) return COST_GROUP_ONLY;
  return (result && notComputableWhy(result)) ?? "Chưa có số liệu";
}

export interface PlainPendingItem {
  kind: PnlPendingStripItem["kind"];
  text: string;
  actionLabel: string;
  href: string;
  /** false: the fix needs the right to edit or approve costs. */
  open: boolean;
}

/**
 * One line of "Vì sao số liệu còn tạm tính?": a sentence with its count and the one place to fix it.
 * `period` is the filter period of the dashboard (months), used to scope the hours list.
 */
export function plainPending(item: PnlPendingStripItem, period: { from: string; to: string }): PlainPendingItem {
  const hours = hoursOf(item.minutes);
  const people = item.userCount ? ` của ${item.userCount} người` : "";
  const firstMonth = item.periodKeys?.[0];
  const hoursHref = fixTargetHref("pending_hours", { from: period.from, to: period.to, group: item.kind });
  const line = (text: string, actionLabel: string, href: string, open = false): PlainPendingItem => ({ kind: item.kind, text, actionLabel, href, open });
  switch (item.kind) {
    case "cost_rate": return line(`${hours} giờ${people} chưa tính được chi phí vì chưa có ${STAFF_COST_PHRASE}${inMonths(item.periodKeys)}.`, "Nhập / duyệt chi phí nhân sự", fixTargetHref("staff_costs", { periodKey: firstMonth }));
    case "classification": return line(`${hours} giờ${people} chưa phân loại công việc.`, "Phân loại giờ", hoursHref, true);
    case "layer2_mismatch": return line(`${hours} giờ${people} chọn loại công việc không khớp với task.`, "Sửa phân loại giờ", hoursHref, true);
    case "locked_period": return line(`${hours} giờ${people} ghi bù vào tháng đã khóa sổ${inMonths(item.periodKeys)}.`, "Mở lại kỳ", fixTargetHref("periods", { periodKey: firstMonth }));
    case "fund_unallocated": return line(`Quỹ chi phí chung tháng ${monthList(item.periodKeys)} chưa chia cho dự án.`, "Chia quỹ", fixTargetHref("funds", { periodKey: firstMonth }));
    case "months_unlocked": return line(`Tháng ${monthList(item.periodKeys)} chưa khóa sổ nên số còn có thể đổi.`, "Khóa kỳ", fixTargetHref("periods", { periodKey: firstMonth }));
    case "not_computable": return line(`${item.projectCount ?? 0} dự án chưa tính được lãi lỗ nên chưa cộng vào các ô tổng.`, "Xem lý do từng dự án", "#pnl-projects", true);
  }
}

/** Short status of a month or a person on the project screen, by what is missing. */
export const MISSING_LABEL: Record<PnlMonthMissing["kind"], string> = {
  cost_rate: "Chưa có chi phí nhân sự tháng được duyệt",
  classification: "Giờ chưa phân loại",
  layer2_mismatch: "Loại công việc không khớp với task",
  locked_period: "Giờ ghi bù vào tháng đã khóa sổ",
  fund_unallocated: "Quỹ chi phí chung chưa chia"
};

/** "Chưa có chi phí nhân sự tháng được duyệt · tháng 09/2026". */
export function plainMissing(missing: PnlMonthMissing, withMonth = true): string {
  return `${MISSING_LABEL[missing.kind] ?? missing.label}${withMonth ? ` · tháng ${formatMonth(missing.periodKey)}` : ""}`;
}

/** A person's status on the project screen: what is missing and in which months, or null when nothing is. */
export function plainPersonStatus(missing: readonly PnlMonthMissing[], withMonths = true): string | null {
  if (!missing.length) return null;
  const kinds = [...new Set(missing.map((row) => row.kind))];
  return kinds.map((kind) => `${MISSING_LABEL[kind]}${withMonths ? ` (tháng ${monthList(missing.filter((row) => row.kind === kind).map((row) => row.periodKey))})` : ""}`).join("; ");
}

export const ENTRY_STATUS_NAME: Record<PnlGateStatusCode, string> = { pending: "Chờ xử lý", included: "Đã tính vào P&L", excluded: "Không tính vào P&L dự án" };

export const ENTRY_STATUS_MEANING: Record<PnlGateStatusCode, string> = {
  pending: "Giờ đã ghi nhưng chưa được tính vào P&L dự án vì còn thiếu một thông tin. Bổ sung xong, giờ tự chuyển sang “Đã tính vào P&L”.",
  included: "Giờ đã được quy ra chi phí nhân sự của P&L dự án.",
  excluded: "Giờ không thuộc P&L dự án: việc nội bộ, ghi sau khi dự án nghiệm thu, hoặc pre-sale của deal thua. Vẫn được quy ra tiền ở phần chi phí cấp công ty."
};

/** The four kinds of pending hours, named by what has to be done. */
export const ENTRY_GROUP_NAME: Record<string, string> = {
  cost_rate: "Chờ chi phí nhân sự tháng",
  classification: "Thiếu phân loại",
  layer2_mismatch: "Loại công việc không khớp",
  locked_period: "Ghi bù vào tháng đã khóa"
};

/** What the viewer should do with each kind of pending hour. */
export const ENTRY_GROUP_TODO: Record<string, string> = {
  cost_rate: "Người phụ trách chi phí nhập và duyệt chi phí nhân sự của tháng đó ở “Chi phí nhân sự theo tháng”.",
  classification: "PIC mở task và chọn loại công việc. Nhóm này chặn duyệt nghiệm thu G7.",
  layer2_mismatch: "Người ghi giờ hoặc PIC mở task và chọn lại loại công việc cho khớp. Nhóm này chặn duyệt nghiệm thu G7.",
  locked_period: "Admin mở lại kỳ ở “Thiết lập P&L › Kỳ và khóa kỳ” (cần ghi lý do), hoặc chuyển giờ sang tháng đang mở."
};

const GATE_REASON: Record<PnlGateReasonCode, string> = {
  internal: "Việc nội bộ",
  after_close: "Ghi sau khi dự án đã nghiệm thu",
  lost_deal_pre_sale: "Pre-sale của deal thua",
  missing_project: "Giờ chưa gắn dự án",
  missing_layer1: "Chưa chọn nhóm công việc (Lớp 1)",
  missing_layer2: "Chưa chọn loại công việc (Lớp 2)",
  layer2_mismatch: "Loại công việc (Lớp 2) không khớp với task",
  unknown_close_position: "Chưa xác định giờ này trước hay sau nghiệm thu",
  legacy_group_in_project: "Dữ liệu cũ: nhóm Họp/Khác nằm trong dự án",
  legacy_unmapped_stage: "Dữ liệu cũ: giai đoạn chưa gắn được nhóm công việc",
  legacy_no_stage: "Dữ liệu cũ: task không thuộc giai đoạn nào",
  missing_staff_cost: "Chưa có chi phí nhân sự tháng được duyệt",
  locked_period: "Ghi bù vào tháng đã khóa sổ"
};

/** Why one logged hour is pending or excluded, in plain words; `fallback` is the API's own label for an unknown code. */
export function plainGateReason(code: string, fallback?: string): string {
  return GATE_REASON[code as PnlGateReasonCode] ?? fallback ?? code;
}

/** Text of the link to the screen that fixes a missing input, as an action. */
export const FIX_ACTION_LABELS: Record<PnlFixTarget, string> = {
  staff_costs: "Nhập / duyệt chi phí nhân sự",
  pending_hours: "Mở task để phân loại",
  funds: "Chia quỹ chi phí chung",
  periods: "Mở kỳ và khóa kỳ",
  project_setup: "Mở dự án",
  project_value: "Nhập Giá trị dự án",
  parameters: "Mở tham số",
  approval: "Mở duyệt nghiệm thu"
};
