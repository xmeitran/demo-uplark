export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function AccountsPage({
  searchParams
}: {
  searchParams?: Promise<{ principal?: string; session?: string }>;
}) {
  const { AccountsFunctionPage } = await import("../../src/components/crm-workspace/accounts");
  return <AccountsFunctionPage searchParams={searchParams} />;
}
