import { PnlProjectScreen } from "@/components/pnl/pnl-project";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function PnlProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <PnlProjectScreen projectId={projectId} />;
}
