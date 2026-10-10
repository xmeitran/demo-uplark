"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/constructor-x/app-shell";
import { WorkspaceTabBar } from "@/components/workspace-tab-bar";
import { PnlCostRates } from "./pnl-cost-rates";
import { PnlOtherCosts } from "./pnl-other-costs";
import { currentPeriodKey } from "./pnl-cost-shared";

type CostTab = "rates" | "other";
const TABS: Array<{ id: CostTab; label: string; description: string }> = [
  { id: "rates", label: "Cost rate nhân sự", description: "Đơn giá giờ theo tháng" },
  { id: "other", label: "Chi phí khác theo dự án", description: "Thuê ngoài, phần mềm, đi lại…" }
];

/**
 * One place to enter every cost the P&L needs. Tab, month and project live in
 * the URL so a link from a project's P&L opens the right view.
 */
export function PnlCostInputPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: CostTab = searchParams.get("tab") === "other" ? "other" : "rates";
  const requestedPeriod = searchParams.get("periodKey") ?? "";
  const periodKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod) ? requestedPeriod : currentPeriodKey();
  const projectId = searchParams.get("projectId") ?? "";

  function update(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) { if (value) params.set(key, value); else params.delete(key); }
    router.replace(`/pnl/costs?${params.toString()}`, { scroll: false });
  }

  return (
    <AppShell activeRoute="/pnl" title="Nhập chi phí">
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
        <header>
          <Link href="/pnl" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Project P&amp;L</Link>
          <h1 className="mt-3 !text-xl font-bold text-foreground">Nhập chi phí</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Hai loại chi phí tạo nên P&amp;L của dự án: chi phí nhân sự (giờ × cost rate) và các khoản chi khác.</p>
        </header>
        <WorkspaceTabBar items={TABS} value={tab} onChange={(next) => update({ tab: next === "rates" ? "" : next })} ariaLabel="Loại chi phí" idPrefix="pnl-costs" />
        {tab === "rates"
          ? <PnlCostRates periodKey={periodKey} onPeriodChange={(next) => update({ periodKey: next })} />
          : <PnlOtherCosts periodKey={periodKey} projectId={projectId} onProjectChange={(next) => update({ projectId: next })} onPeriodChange={(next) => update({ periodKey: next })} />}
      </main>
    </AppShell>
  );
}
