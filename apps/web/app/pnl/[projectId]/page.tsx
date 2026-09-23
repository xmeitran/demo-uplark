import { PnlWorkbench } from "@/components/pnl/pnl-workbench";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function PnlProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <PnlWorkbench projectId={projectId} />;
}
