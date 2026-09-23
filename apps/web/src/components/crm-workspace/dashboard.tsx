import { CrmPageShell, resolveWorkspaceData, type SearchParams } from "./shared";
import { LazyDashboardWorkbench } from "./dashboard-workbench.lazy";

export async function CrmWorkspace({ searchParams }: { searchParams?: SearchParams }) {
  return <CrmDashboardPage searchParams={searchParams} />;
}

export async function CrmDashboardPage({ searchParams }: { searchParams?: SearchParams }) {
  const data = await resolveWorkspaceData(searchParams, {
    accounts: true,
    opportunities: true,
    processMetrics: true,
    salesTargets: true
  });

  return (
    <CrmPageShell
      active="dashboard"
      data={data}
      title="Tổng quan vận hành"
    >
      <LazyDashboardWorkbench
        accounts={data.accounts}
        initialOpportunities={data.opportunities}
        processMetrics={data.processMetrics}
        principal={data.principal}
        salesTargets={data.salesTargets}
      />
    </CrmPageShell>
  );
}
