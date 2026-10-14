"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/constructor-x/app-shell";
import { PageHeader, pageMainClassName } from "@/components/page-header";
import { WorkspaceTabBar } from "@/components/workspace-tab-bar";
import { PnlSetupItems } from "./pnl-setup-items";
import { PnlSetupParameters } from "./pnl-setup-parameters";
import { SETUP_TABS as TABS, setupTabOf } from "./pnl-cost-shared";

/**
 * "Thiết lập P&L": the Admin workspace exposes only the two settings needed by operators:
 * Khoản mục and Tham số. The legacy route remains available for compatibility, but legacy tabs resolve to Khoản mục.
 */
export function PnlSetupPage({ embedded = false }: Readonly<{ embedded?: boolean }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [embeddedTab, setEmbeddedTab] = useState<"items" | "parameters">("items");
  const tab = embedded ? embeddedTab : setupTabOf(requestedTab);
  // Where the Khoản mục tab puts "Áp dụng bản nháp ▾": on the tab row, as drawn.
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);

  function update(next: Record<string, string>) {
    if (embedded) {
      if (next.tab) setEmbeddedTab(setupTabOf(next.tab));
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) { if (value) params.set(key, value); else params.delete(key); }
    const query = params.toString();
    router.replace(query ? `/pnl/costs?${query}` : "/pnl/costs", { scroll: false });
  }
  // An old or unknown tab value is rewritten to the tab actually shown.
  useEffect(() => {
    if (embedded) return;
    if (requestedTab && requestedTab !== tab) update({ tab, projectId: "", periodKey: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, requestedTab, tab]);

  const content = <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 max-w-full overflow-x-auto">
        <WorkspaceTabBar items={TABS} value={tab} onChange={(next) => update({ tab: next })} ariaLabel="Thiết lập P&L" idPrefix="pnl-setup" className="[&>button]:!min-w-0 [&>button]:!flex-none [&_.truncate]:!overflow-visible" />
      </div>
      <div ref={setActionSlot} className="relative shrink-0" />
    </div>
    <div role="tabpanel" aria-labelledby={`pnl-setup-tab-${tab}`} className="space-y-4">
      {tab === "items" ? <PnlSetupItems actionSlot={actionSlot} /> : null}
      {tab === "parameters" ? <PnlSetupParameters /> : null}
    </div>
  </>;

  if (embedded) {
    return <section aria-labelledby="admin-pnl-config-title" className="grid gap-4">
      <header className="rounded-3xl border border-border bg-card px-5 py-5 shadow-sm sm:px-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">P&amp;L GOVERNANCE</p>
        <h2 id="admin-pnl-config-title" className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">Thiết lập P&amp;L</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">Chỉ cấu hình cây khoản mục và tham số tính P&amp;L. Các mục còn lại được hệ thống xử lý theo nghiệp vụ.</p>
      </header>
      {content}
    </section>;
  }

  return (
    <AppShell activeRoute="/admin" title="Thiết lập P&L">
      <main className={pageMainClassName}>
        <PageHeader back={{ href: "/admin", label: "Admin" }} title="Thiết lập P&L" subtitle="Khoản mục và tham số dùng để tính P&L." />
        {content}
      </main>
    </AppShell>
  );
}
