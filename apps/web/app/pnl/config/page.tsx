import { PnlConfigPage } from "@/components/pnl/pnl-config-workbench";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function PnlConfigRoute() {
  return <PnlConfigPage />;
}
