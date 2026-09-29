import Link from "next/link";
import { UserRound, UsersRound } from "lucide-react";
import type { ViewerScope } from "./timesheet-types";

type TimesheetAudience = "group" | "personal";

/**
 * Shared entry point for the two Timesheet audiences. The links keep the
 * selected audience in the URL so switching views is bookmarkable and does
 * not reset the existing table view.
 */
export function TimesheetAudienceSwitch({
  active,
  view = "monthly",
  groupScope = "workspace"
}: {
  active: TimesheetAudience;
  view?: string;
  groupScope?: ViewerScope;
}) {
  const groupHref = `/timesheet?view=${encodeURIComponent(view)}&scope=${groupScope}`;
  const items = [
    {
      id: "group" as const,
      href: groupHref,
      label: "Theo nhóm",
      description: groupScope === "workspace" ? "Toàn workspace" : "Dự án tôi quản lý",
      icon: UsersRound
    },
    {
      id: "personal" as const,
      href: `/timesheet/me?view=${encodeURIComponent(view)}`,
      label: "Cá nhân",
      description: "Giờ của tôi",
      icon: UserRound
    }
  ];

  return (
    <nav aria-label="Phạm vi xem Timesheet" className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm">
      {items.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex min-w-[132px] items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${selected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold leading-4">{item.label}</span>
              <span className="block truncate text-[10px] leading-4 opacity-80">{item.description}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
