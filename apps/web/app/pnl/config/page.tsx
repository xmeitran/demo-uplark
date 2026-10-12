import { redirect } from "next/navigation";

/** Old address of "Admin › Thiết lập P&L". The five tabs (Khoản mục, Tham số, Quỹ chi phí chung, Kỳ và khóa kỳ, Mẫu khoản mục) live at /pnl/costs. */
export default function PnlConfigRoute() {
  redirect("/pnl/costs?tab=periods");
}
