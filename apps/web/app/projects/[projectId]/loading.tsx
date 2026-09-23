import { AppShell } from "../../../src/components/constructor-x/app-shell";

export default function ProjectDetailLoading() {
  return (
    <AppShell activeRoute="/projects" title="Project Detail">
        <main className="flex-1 overflow-auto p-4 sm:p-8 [overflow-anchor:none]">
          <div className="mx-auto max-w-5xl space-y-5" aria-busy="true" aria-label="Preparing project workspace">
            <span className="sr-only">Preparing project workspace</span>
            <div className="h-28 animate-pulse rounded-2xl border border-border bg-card" />
            <div className="h-10 w-full animate-pulse rounded-xl border border-border bg-card" />
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <div className="h-64 animate-pulse rounded-xl border border-border bg-card md:col-span-2" />
              <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
            </div>
          </div>
        </main>
    </AppShell>
  );
}
