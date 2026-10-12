import { PnlHoursPage } from "@/components/pnl/pnl-hours";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function PnlHoursRoute() {
  return <PnlHoursPage />;
}
