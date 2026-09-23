export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function PortalPage() {
  const { PortalFunctionPage } = await import("../../src/components/crm-workspace/portal");
  return <PortalFunctionPage />;
}
