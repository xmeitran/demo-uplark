export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function ProposalsPage() {
  const { ProposalBusinessFunctionPage } = await import("../../src/components/crm-workspace/proposal-workbench");
  return <ProposalBusinessFunctionPage />;
}
