export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function SupportPage() {
  const { BusinessPlaceholderWorkbench } = await import("../../src/components/crm-workspace/business-placeholder-workbench");
  return <BusinessPlaceholderWorkbench area="support" />;
}
