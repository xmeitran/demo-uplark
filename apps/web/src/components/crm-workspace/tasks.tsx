import { TasksWorkbench } from "./tasks-workbench";
import { CrmPageShell, resolveWorkspaceData, type SearchParams } from "./shared";

export async function TasksFunctionPage({ searchParams }: { searchParams?: SearchParams }) {
  const data = await resolveWorkspaceData(searchParams, {
    accounts: true,
    opportunities: true,
    projects: true,
    tasks: true
  });

  return (
    <CrmPageShell
      active="tasks"
      data={data}
      title="Công việc vận hành"
      description="Quản lý công việc dự án, đổi trạng thái và ghi nhận thời gian làm việc."
    >
      <TasksWorkbench
        tasks={data.tasks}
        accounts={data.accounts}
        projects={data.projects}
        opportunities={data.opportunities}
        principal={data.principal}
      />
    </CrmPageShell>
  );
}
