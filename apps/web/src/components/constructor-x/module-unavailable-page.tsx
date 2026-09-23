"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Lock, type LucideIcon } from "lucide-react";
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
        <main className="flex flex-1 items-center justify-center overflow-auto p-4 sm:p-6">
          <section className="w-full max-w-xl rounded-xl border border-border bg-card p-5 text-center shadow-sm sm:p-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Icon className="h-5 w-5" />
            </div>
            <div className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              <Lock className="h-3 w-3" />
              Not active in production
            </div>
            <h1 className="text-lg font-bold text-foreground">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            <div className="mt-6 flex justify-center">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to dashboard
              </Link>
            </div>
          </section>
        </main>
    </AppShell>
  );
}
