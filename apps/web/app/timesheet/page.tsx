"use client";

import React, { Suspense } from "react";
import { AppShell } from "@/components/constructor-x/app-shell";
import { TimesheetWorkbench } from "@/components/timesheet/timesheet-workbench";

function WorkbenchFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải bảng chấm công dự án">
      <div className="h-14 animate-pulse rounded-xl bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[104px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-[320px] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default function TimesheetPage() {
  return (
    <AppShell
      activeRoute="/timesheet"
      desktopSidebarTestId="timesheet-desktop-sidebar"
      mobileHeaderTestId="timesheet-mobile-shell"
      shellTestId="timesheet-shell"
      title="Timesheet"
    >
      <main data-testid="timesheet-main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-none p-4 sm:p-6">
        <Suspense fallback={<WorkbenchFallback />}>
          <TimesheetWorkbench />
        </Suspense>
      </main>
    </AppShell>
  );
}
