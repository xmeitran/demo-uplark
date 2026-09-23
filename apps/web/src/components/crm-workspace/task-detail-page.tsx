import { TaskDetailWorkbench } from "./task-detail-workbench";
import { resolveWorkspaceData, type SearchParams } from "./shared";

export async function TaskDetailFunctionPage({
  taskId,
  searchParams
}: {
  taskId: string;
  searchParams?: SearchParams;
}) {
  const data = await resolveWorkspaceData(searchParams, {
    accounts: true,
    projects: true,
    tasks: true
  });

  return (
    <TaskDetailWorkbench
      taskId={taskId}
      tasks={data.tasks}
      accounts={data.accounts}
      projects={data.projects}
      principal={data.principal}
    />
  );
}
