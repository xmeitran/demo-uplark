import { PnlCostInputPage } from "@/components/pnl/pnl-cost-input";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function PnlCostsRoute() {
  return <PnlCostInputPage />;
}
