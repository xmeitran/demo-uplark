export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function TasksPage({
  searchParams
}: {
  searchParams?: Promise<{ principal?: string; session?: string }>;
}) {
  const { TasksFunctionPage } = await import("../../src/components/crm-workspace/tasks");
  return <TasksFunctionPage searchParams={searchParams} />;
}
