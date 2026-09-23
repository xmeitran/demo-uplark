export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DataPage({
  searchParams
}: {
  searchParams?: Promise<{ principal?: string; session?: string }>;
}) {
  const { DataFunctionPage } = await import("../../src/components/crm-workspace/data");
  return <DataFunctionPage searchParams={searchParams} />;
}
