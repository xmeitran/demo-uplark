"use client";

import React, { Suspense } from "react";
import { AppShell } from "@/components/constructor-x/app-shell";
import { PersonalTimesheet } from "@/components/timesheet/personal-timesheet";

function PersonalTimesheetFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải Giờ của tôi">
      <div className="h-14 animate-pulse rounded-xl bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => <div key={index} className="h-[104px] animate-pulse rounded-xl bg-muted" />)}
      </div>
      <div className="h-[320px] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default function PersonalTimesheetPage() {
  return (
    <AppShell
      activeRoute="/timesheet"
      desktopSidebarTestId="timesheet-personal-desktop-sidebar"
      mobileHeaderTestId="timesheet-personal-mobile-shell"
      shellTestId="timesheet-personal-shell"
      title="Giờ của tôi"
    >
      <main data-testid="timesheet-personal-main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-none p-4 sm:p-6">
        <Suspense fallback={<PersonalTimesheetFallback />}>
          <PersonalTimesheet />
        </Suspense>
      </main>
    </AppShell>
  );
}
