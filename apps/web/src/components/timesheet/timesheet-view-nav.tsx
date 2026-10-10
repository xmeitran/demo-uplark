"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ViewerScope } from "./timesheet-types";

type TimesheetView = "monthly" | "project";

export function TimesheetViewNav({
  groupScope = "workspace"
}: {
  groupScope?: ViewerScope;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Switching view keeps every current filter param; only `view` changes.
  const hrefFor = (view: TimesheetView) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("view", view);
    if (groupScope === "self") next.set("scope", "self");
    return `/timesheet?${next.toString()}`;
  };
  const activeView: TimesheetView = searchParams.get("view") === "project" ? "project" : "monthly";

  const items = [
    {
      id: "monthly" as const,
      href: hrefFor("monthly"),
      label: "Theo tháng",
      description: "Tổng hợp theo nhân sự",
    },
    {
      id: "project" as const,
      href: hrefFor("project"),
      label: "Theo dự án",
      description: "Tổng hợp theo dự án",
    }
  ];

  if (pathname === "/timesheet/me") return null;

  return (
    <nav
      aria-label="Chọn màn hình Timesheet"
      className="grid w-full grid-cols-1 gap-1 rounded-xl border border-border bg-card p-1 shadow-sm sm:grid-cols-2"
    >
      {items.map((item) => {
        const active = item.id === activeView;
        return (
          <Link
            key={item.id}
            href={item.href}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={`group relative min-w-0 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
          >
            <span className={`block truncate text-[12.5px] font-semibold ${active ? "text-primary" : "text-foreground"}`}>{item.label}</span>
            <span className="mt-0.5 block truncate text-[10.5px]">{item.description}</span>
            {active ? <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
