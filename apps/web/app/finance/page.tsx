export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function FinancePage() {
  const { FinanceFunctionPage } = await import("../../src/components/crm-workspace/finance-workbench");
  return <FinanceFunctionPage />;
}
