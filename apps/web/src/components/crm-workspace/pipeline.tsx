import { SalesPipelineCrud } from "../sales-pipeline-crud";
import { CrmPageShell, resolveWorkspaceData, type SearchParams } from "./shared";

export async function PipelineFunctionPage({ searchParams }: { searchParams?: SearchParams }) {
  const data = await resolveWorkspaceData(searchParams, {
    accounts: true,
    leads: true,
    opportunities: true,
    salesOwners: true
  });

  return (
    <CrmPageShell
      active="pipeline"
      data={data}
      title="Cơ hội"
    >
      <SalesPipelineCrud
        accounts={data.accounts}
        initialLeads={data.leads}
        initialOpportunities={data.opportunities}
        salesOwners={data.salesOwners}
        principal={data.principal}
      />
    </CrmPageShell>
  );
}
