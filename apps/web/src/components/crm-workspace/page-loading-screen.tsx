/**
 * Shared skeleton loading screen used across page-level loading.tsx files.
 * Mimics the sidebar + header + content panel layout of the app shell.
 */
export function PageLoadingScreen({
  title = "Đang tải dữ liệu...",
  icon,
  columns = 3
}: {
  title?: string;
  icon?: string;
  columns?: number;
}) {
  return (
    <div className="flex h-screen bg-[#f5f7fa] overflow-hidden">
      {/* Sidebar skeleton */}
      <div className="hidden lg:flex h-full w-[220px] shrink-0 bg-white border-r border-slate-100 flex-col gap-3 p-4 animate-pulse">
        <div className="h-8 w-8 rounded-xl bg-slate-100 mb-2" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="h-4 w-4 rounded-md bg-slate-100 shrink-0" />
            <div
              className="h-3 rounded-full bg-slate-100"
              style={{ width: `${55 + (i % 3) * 15}%` }}
            />
          </div>
        ))}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header skeleton */}
        <div className="h-14 shrink-0 bg-white border-b border-slate-100 flex items-center px-6 gap-4 animate-pulse">
          <div className="h-5 w-5 rounded-lg bg-slate-100" />
          <div className="h-4 w-36 rounded-full bg-slate-100" />
          <div className="flex-1" />
          <div className="h-8 w-24 rounded-xl bg-slate-100" />
          <div className="h-8 w-8 rounded-full bg-slate-100" />
        </div>

        {/* Page body */}
        <main className="flex-1 overflow-auto bg-[#f5f7fa] p-6">
          <div className="flex flex-col gap-5 animate-pulse">

            {/* Page title / filter bar skeleton */}
            <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-slate-100" />
                <div>
                  <div className="h-4 w-40 rounded-full bg-slate-100 mb-1.5" />
                  <div className="h-3 w-24 rounded-full bg-slate-100" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-32 rounded-xl bg-slate-100" />
                <div className="h-8 w-28 rounded-xl bg-slate-100" />
                <div className="h-8 w-28 rounded-xl bg-indigo-50" />
              </div>
            </div>

            {/* Content grid / list skeleton */}
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: columns * 2 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white border border-slate-100 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden"
                >
                  {/* Card header */}
                  <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-5 w-5 rounded-lg bg-slate-100" />
                      <div className="h-3.5 w-32 rounded-full bg-slate-100" />
                    </div>
                    <div className="h-5 w-16 rounded-full bg-slate-100" />
                  </div>
                  {/* Card body lines */}
                  <div className="px-5 py-4 flex flex-col gap-3">
                    {Array.from({ length: 3 + (i % 2) }).map((_, li) => (
                      <div
                        key={li}
                        className="h-3 rounded-full bg-slate-100"
                        style={{ width: `${90 - li * 10}%` }}
                      />
                    ))}
                    {/* Tags row */}
                    <div className="flex items-center gap-2 pt-1">
                      <div className="h-5 w-16 rounded-full bg-slate-100" />
                      <div className="h-5 w-12 rounded-full bg-slate-100" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* Floating bottom progress indicator */}
          <div className="fixed inset-0 pointer-events-none flex items-end justify-center pb-8">
            <div className="flex items-center gap-2.5 bg-white/90 backdrop-blur-sm border border-slate-100 rounded-2xl px-5 py-3 shadow-lg">
              <svg
                className="animate-spin h-4 w-4 text-indigo-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-xs font-semibold text-slate-600">{title}</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
