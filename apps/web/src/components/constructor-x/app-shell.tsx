"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { APP_NAME, AppBrandLogo } from "@/components/app-brand";
import { Header } from "@/components/constructor-x/header";
import { Sidebar } from "@/components/constructor-x/sidebar";

type AppShellProps = Readonly<{
  activeRoute?: string;
  children: React.ReactNode;
  desktopSidebarTestId?: string;
  mobileHeaderTestId?: string;
  onCreateProjectClick?: () => void;
  shellTestId?: string;
  title?: string;
}>;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function AppShell({
  activeRoute = "/",
  children,
  desktopSidebarTestId = "constructor-desktop-sidebar",
  mobileHeaderTestId,
  onCreateProjectClick,
  shellTestId = "constructor-shell",
  title
}: AppShellProps) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeNavigation = useCallback((restoreFocus = true) => {
    setNavigationOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    setNavigationOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navigationOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNavigation();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
        .filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeNavigation, navigationOpen]);

  return (
    <div className="flex h-dvh min-w-0 overflow-hidden bg-background text-foreground" data-testid={shellTestId}>
      <div className="hidden h-full shrink-0 lg:flex" data-testid={desktopSidebarTestId}>
        <Sidebar activeRoute={activeRoute} onCreateProjectClick={onCreateProjectClick} variant="desktop" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="hidden lg:block">
          <Header title={title} />
        </div>

        <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-4 lg:hidden" data-testid={mobileHeaderTestId}>
          <button
            aria-controls="constructor-navigation-dialog"
            aria-expanded={navigationOpen}
            aria-label="Open navigation"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => setNavigationOpen(true)}
            ref={triggerRef}
            type="button"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          <AppBrandLogo compact className="h-8 w-8 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{title ?? APP_NAME}</p>
            <p className="truncate text-[11px] text-muted-foreground">{APP_NAME}</p>
          </div>
        </header>

        {children}
      </div>

      {navigationOpen ? (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
            onMouseDown={() => closeNavigation()}
          />
          <div
            aria-label="Navigation"
            aria-modal="true"
            className="absolute inset-y-0 left-0 flex w-[min(326px,calc(100vw-24px))] flex-col overflow-hidden rounded-r-2xl border-r border-border bg-sidebar shadow-2xl"
            id="constructor-navigation-dialog"
            onClickCapture={(event) => {
              if ((event.target as Element).closest("a[href]")) closeNavigation(false);
            }}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <button
              aria-label="Close navigation"
              className="absolute right-3 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => closeNavigation()}
              type="button"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
            <Sidebar activeRoute={activeRoute} onCreateProjectClick={onCreateProjectClick} variant="drawer" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
