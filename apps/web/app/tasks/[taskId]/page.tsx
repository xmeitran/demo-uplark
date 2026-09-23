export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function TaskDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ taskId: string }>;
  searchParams?: Promise<{ principal?: string; session?: string }>;
}) {
  const resolvedParams = await params;
  const { TaskDetailFunctionPage } = await import("../../../src/components/crm-workspace/task-detail-page");
  return (
    <TaskDetailFunctionPage
      taskId={resolvedParams.taskId}
      searchParams={searchParams}
    />
  );
}
