import type { MemberParticipationState } from "@b2b-crm/contracts";
import { toVietnamDateKey } from "./vietnam-time";

/**
 * EV-035 participation state: one label + badge class per state, shared by every screen that shows it.
 * Labels are Vietnamese on purpose so they cannot be read as a Project Status (Active / On Hold).
 */
export const PARTICIPATION_STATE: Record<MemberParticipationState, { label: string; className: string }> = {
  active: { label: "Đang tham gia", className: "bg-emerald-50 text-emerald-700" },
  on_hold: { label: "Tạm dừng theo dự án", className: "bg-slate-100 text-slate-600" },
  missing_data: { label: "Thiếu dữ liệu", className: "bg-amber-50 text-amber-700" },
  no_log: { label: "Chưa có giờ trong kỳ", className: "bg-muted text-muted-foreground" }
};

/** Current calendar month in Asia/Ho_Chi_Minh as API date keys plus the "mm/yyyy" label. */
export function currentVietnamMonthRange(now = new Date()) {
  const [year, month] = toVietnamDateKey(now).split("-");
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { startDate: `${year}-${month}-01`, endDate: `${year}-${month}-${String(lastDay).padStart(2, "0")}`, label: `${month}/${year}` };
}
