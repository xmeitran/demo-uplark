import { PolicyAccessAdmin } from "./policy-access-admin";
import { CrmPageShell, resolveWorkspaceData, type SearchParams } from "./shared";

export async function PolicyFunctionPage({ searchParams }: { searchParams?: SearchParams }) {
  const data = await resolveWorkspaceData(searchParams, {
    accounts: true,
    projects: true,
    salesOwners: true
  });

  return (
    <CrmPageShell
      active="policy"
      data={data}
      title="Phân quyền & truy cập"
      description="Quản lý danh sách member, scope truy cập và lời mời vào hệ thống."
    >
      <PolicyAccessAdmin
        accounts={data.accounts}
        projects={data.projects}
        salesOwners={data.salesOwners}
        showDemoSessionAction={process.env.NODE_ENV !== "production"}
      />
    </CrmPageShell>
  );
}
