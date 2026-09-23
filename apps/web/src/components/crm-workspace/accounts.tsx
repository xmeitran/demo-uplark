import { AccountsWorkbench } from "./accounts-workbench";
import { CrmPageShell, resolveWorkspaceData, type SearchParams } from "./shared";

export async function AccountsFunctionPage({ searchParams }: { searchParams?: SearchParams }) {
  const data = await resolveWorkspaceData(searchParams, {
    accounts: true,
    opportunities: true,
    projects: true
  });

  return (
    <CrmPageShell
      active="accounts"
      data={data}
      title="Khách hàng"
      description="Quản lý khách hàng, đội phụ trách, sức khỏe tài khoản và giá trị hợp đồng theo phạm vi quyền truy cập."
    >
      <AccountsWorkbench
        accounts={data.accounts}
        opportunities={data.opportunities}
        projects={data.projects}
        principal={data.principal}
      />
    </CrmPageShell>
  );
}
