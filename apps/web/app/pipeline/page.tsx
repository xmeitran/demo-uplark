export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function PipelinePage({
  searchParams
}: {
  searchParams?: Promise<{ principal?: string; session?: string }>;
}) {
  const { PipelineFunctionPage } = await import("../../src/components/crm-workspace/pipeline");
  return <PipelineFunctionPage searchParams={searchParams} />;
}
