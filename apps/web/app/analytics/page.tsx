"use client";

import React, { Suspense } from "react";
import { AppShell } from "@/components/constructor-x/app-shell";
import { AnalyticsWorkbench } from "@/components/analytics/analytics-workbench";

function WorkbenchFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải phân tích vận hành">
      <div className="h-10 animate-pulse rounded-xl bg-muted" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[104px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-[320px] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <AppShell
      activeRoute="/analytics"
      desktopSidebarTestId="analytics-desktop-sidebar"
      mobileHeaderTestId="analytics-mobile-shell"
      shellTestId="analytics-shell"
      title="Phân tích vận hành"
    >
        <main data-testid="analytics-main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-none p-4 sm:p-6">
          <Suspense fallback={<WorkbenchFallback />}>
            <AnalyticsWorkbench />
          </Suspense>
        </main>
    </AppShell>
  );
}
