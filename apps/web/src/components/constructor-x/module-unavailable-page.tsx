"use client";

import React from "react";
import { Lock, type LucideIcon } from "lucide-react";
import { PageHeader, pageMainClassName } from "@/components/page-header";
import { AppShell } from "./app-shell";

interface ModuleUnavailablePageProps {
  activeRoute: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export function ModuleUnavailablePage({
  activeRoute,
  title,
  description,
  icon: Icon
}: ModuleUnavailablePageProps) {
  return (
    <AppShell activeRoute={activeRoute} title={title}>
        <main className={pageMainClassName}>
          <PageHeader back={{ href: "/", label: "Dashboard" }} title={title} subtitle={description} />
          <section className="mx-auto w-full max-w-xl rounded-xl border border-border bg-card p-5 text-center shadow-sm sm:p-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Icon className="h-5 w-5" />
            </div>
            <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              <Lock className="h-3 w-3" />
              Not active in production
            </div>
          </section>
        </main>
    </AppShell>
  );
}
