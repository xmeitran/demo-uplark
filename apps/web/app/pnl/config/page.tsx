import { redirect } from "next/navigation";

/** Old address of "Admin › Thiết lập P&L". Keep it compatible with the two-tab setup screen. */
export default function PnlConfigRoute() {
  redirect("/pnl/costs?tab=items");
}
