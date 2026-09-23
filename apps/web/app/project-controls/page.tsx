export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function ProjectControlsPage() {
  const { ProjectControlsFunctionPage } = await import("../../src/components/crm-workspace/project-controls");
  return <ProjectControlsFunctionPage />;
}
