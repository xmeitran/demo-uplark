"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ChevronDown, Moon, Search, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getShellRoutes, matchProductRoute } from "@/lib/production-route-readiness";
import { useTheme } from "@/lib/theme";

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notificationTriggerRef = useRef<HTMLButtonElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const notificationOpenRef = useRef(false);
  const profileOpenRef = useRef(false);
  // Keep quick navigation in sync with the sidebar.  The review/staging
  // deployment intentionally exposes the beta CRM modules (Timesheet and
  // P&L), while a real production build keeps them gated until promoted.
  const navigationEnvironment = process.env.NEXT_PUBLIC_STAGING_BYPASS_AUTH === "true"
    ? "staging"
    : "production";
  const routes = useMemo(() => getShellRoutes("constructor", navigationEnvironment), [navigationEnvironment]);
  const results = routes.filter((route) => `${route.label} ${route.href}`.toLowerCase().includes(searchValue.trim().toLowerCase()));
  const currentTitle = title || matchProductRoute(pathname)?.label || "Dashboard";

  function closeNotifications(returnFocus = true) {
    setNotifOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => notificationTriggerRef.current?.focus());
  }

  function closeProfile(returnFocus = true) {
    setProfileOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => profileTriggerRef.current?.focus());
  }

  useEffect(() => {
    notificationOpenRef.current = notifOpen;
  }, [notifOpen]);

  useEffect(() => {
    profileOpenRef.current = profileOpen;
  }, [profileOpen]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        if (notificationOpenRef.current) closeNotifications();
        if (profileOpenRef.current) closeProfile();
        setSearchValue("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => setActiveResult(0), [searchValue]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  function navigateResult(index: number) {
    const route = results[index];
    if (!route) return;
    setSearchOpen(false);
    setSearchValue("");
    router.push(route.href);
  }

  const profileInitials = user?.initials ?? "B2B";
  const profileName = user?.name ?? "Workspace User";
  const profileEmail = user?.email ?? "Authenticated session";

  return (
    <header className="h-[60px] shrink-0 flex items-center justify-between gap-4 px-5 border-b border-border bg-card sticky top-0 z-30">
      <div className="flex min-w-0 items-center gap-5">
        <div className="relative w-40 xl:w-60" ref={searchContainerRef}>
          <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            aria-autocomplete="list"
            aria-controls="route-command-results"
            aria-activedescendant={searchOpen && results[activeResult] ? `route-command-${results[activeResult].id}` : undefined}
            aria-expanded={searchOpen}
            aria-label="Quick navigation"
            ref={searchRef}
            role="combobox"
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            onFocus={() => setSearchOpen(true)}
            onClick={() => setSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveResult((value) => Math.min(results.length - 1, value + 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveResult((value) => Math.max(0, value - 1)); }
              if (event.key === "Enter") { event.preventDefault(); navigateResult(activeResult); }
            }}
            placeholder="Navigate to..."
            className="w-full bg-background border border-border rounded-xl py-2 pl-9 pr-14 text-xs focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/50 text-foreground placeholder:text-muted-foreground transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border leading-none">⌘K</kbd>
          {searchOpen && (
            <div id="route-command-results" role="listbox" className="absolute left-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-lg">
              {results.length ? results.map((route, index) => (
                <button
                  aria-selected={activeResult === index}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${activeResult === index ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
                  key={route.id}
                  id={`route-command-${route.id}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => navigateResult(index)}
                  role="option"
                  type="button"
                >
                  <span>{route.label}</span><span className="font-mono text-[10px]">{route.href}</span>
                </button>
              )) : <p className="px-3 py-4 text-center text-xs text-muted-foreground">No matching production route.</p>}
            </div>
          )}
        </div>
        <nav aria-label="Primary" className="hidden 2xl:flex items-center gap-1">
          {routes.filter((route) => ["dashboard", "projects", "clients", "users"].includes(route.id)).map((item) => (
            <Link aria-current={pathname === item.href ? "page" : undefined} key={item.href} href={item.href} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${pathname === item.href ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}>{item.label}</Link>
          ))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2 xl:gap-3">
        <div className="hidden xl:flex items-center gap-1 text-xs text-muted-foreground" aria-label="Current page">{currentTitle}</div>
        <button onClick={theme.toggle} className="inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors" aria-label={theme.isDark ? "Switch to light mode" : "Switch to dark mode"} type="button">
          {theme.isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-500" />}
        </button>
        <div className="relative">
          <button ref={notificationTriggerRef} aria-controls="notification-popover" aria-expanded={notifOpen} aria-label="Notifications" onClick={() => notifOpen ? closeNotifications(false) : setNotifOpen(true)} className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors" type="button"><Bell className="w-4 h-4" /></button>
          {notifOpen && (
            <section aria-label="Notifications" className="absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-4 shadow-lg" id="notification-popover">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-foreground">Notifications</h2><button aria-label="Close notifications" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={() => closeNotifications()} type="button">Close</button></div>
              <p className="mt-3 rounded-lg bg-muted px-3 py-4 text-center text-xs text-muted-foreground">No notifications yet.</p>
            </section>
          )}
        </div>
        <Link aria-label="Settings" href="/settings" className="inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors"><Settings className="w-4 h-4" /></Link>
        <div className="relative">
          <button ref={profileTriggerRef} onClick={() => profileOpen ? closeProfile(false) : setProfileOpen(true)} aria-controls="profile-menu" aria-expanded={profileOpen} aria-haspopup="menu" aria-label="Open user menu" className="flex min-h-11 items-center gap-2 pl-1" type="button">
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs overflow-hidden" style={{ backgroundColor: user?.avatarColor ?? "#059669" }}>
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : profileInitials.slice(0, 3)}
            </div><ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <AnimatePresence>{profileOpen && (
            <motion.div id="profile-menu" role="menu" initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }} transition={{ type: "spring", damping: 25, stiffness: 300 }} className="absolute right-0 top-full mt-2 w-52 bg-popover border border-border rounded-xl shadow-lg overflow-hidden z-50">
              <div className="p-3 border-b border-border"><p className="text-xs font-semibold text-foreground">{profileName}</p><p className="text-[11px] text-muted-foreground">{profileEmail}</p></div>
              <div className="p-2"><Link role="menuitem" href="/settings" className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted">Account settings</Link><div className="border-t border-border mt-1 pt-1"><button role="menuitem" onClick={logout} className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-destructive hover:bg-destructive/8 transition-colors" type="button">Sign Out</button></div></div>
            </motion.div>
          )}</AnimatePresence>
        </div>
      </div>
    </header>
  );
}
