import { DashboardPanel, IntegrationPanel, PolicyPanel, SourceOfTruthPanel } from "./panels";
import { CrmPageShell, resolveWorkspaceData, type SearchParams } from "./shared";

export async function DataFunctionPage({ searchParams }: { searchParams?: SearchParams }) {
  const data = await resolveWorkspaceData(searchParams, {
    accounts: true,
    dashboard: true
  });

  return (
    <CrmPageShell
      active="data"
      data={data}
      title="Dữ liệu & tích hợp"
      description="Theo dõi nguồn dữ liệu vận hành, trạng thái đồng bộ Lark và chất lượng số liệu theo quyền truy cập."
    >
      <div className="shopify-two-column">
        <div className="shopify-stack">
          <SourceOfTruthPanel />
          <DashboardPanel dashboard={data.dashboard} title="Số liệu đang được phép xem" />
        </div>
        <div className="shopify-stack">
          <IntegrationPanel />
          <PolicyPanel accounts={data.accounts} />
        </div>
      </div>
    </CrmPageShell>
  );
}
