import { PnlControlCenter } from "@/components/pnl/pnl-control-center";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function PnlPage() {
  return <PnlControlCenter />;
}
