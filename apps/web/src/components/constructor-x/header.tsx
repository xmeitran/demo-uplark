"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, ChevronDown, ExternalLink, Loader2, Moon, Search, Settings, Sun } from "lucide-react";
import type { AppNotificationSummary, AppNotificationsResponse } from "@b2b-crm/contracts";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getShellRoutes, matchProductRoute } from "@/lib/production-route-readiness";
import { useTheme } from "@/lib/theme";

interface HeaderProps {
  title?: string;
}

function notificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function notificationApiError(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const message = (body as { message?: unknown }).message;
  if (typeof message === "string") return message;
  if (message && typeof message === "object" && "message" in message && typeof (message as { message?: unknown }).message === "string") {
    return (message as { message: string }).message;
  }
  return fallback;
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
  const [notifications, setNotifications] = useState<AppNotificationSummary[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationActionId, setNotificationActionId] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
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

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    setNotificationLoading(true);
    try {
      const response = await fetch("/api/notifications", { cache: "no-store", credentials: "same-origin" });
      const body = await response.json().catch(() => null) as AppNotificationsResponse | { message?: string } | null;
      if (!response.ok) throw new Error((body as { message?: string } | null)?.message || "Không tải được thông báo.");
      const payload = body as AppNotificationsResponse;
      setNotifications(payload.data ?? []);
      setNotificationUnreadCount(payload.meta?.unreadCount ?? 0);
      setNotificationError(null);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "Không tải được thông báo.");
    } finally {
      setNotificationLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 30000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  async function markNotificationRead(notification: AppNotificationSummary) {
    if (notification.readAt || notification.status === "resolved") return;
    await fetch(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: "PATCH", credentials: "same-origin" }).catch(() => undefined);
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString(), status: "read" } : item));
    setNotificationUnreadCount((current) => Math.max(0, current - 1));
  }

  async function approveFromNotification(notification: AppNotificationSummary) {
    const projectId = notification.data?.projectId;
    const milestoneId = notification.data?.milestoneId;
    if (!projectId || !milestoneId) return;
    setNotificationActionId(notification.id);
    setNotificationError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}/approve`, { method: "POST", credentials: "same-origin", cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(notificationApiError(body, "Không thể duyệt milestone."));
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, status: "resolved", readAt: new Date().toISOString() } : item));
      setNotificationUnreadCount((current) => Math.max(0, current - (notification.readAt ? 0 : 1)));
      window.dispatchEvent(new CustomEvent("crm:milestone-approved", { detail: { projectId, milestoneId } }));
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "Không thể duyệt milestone.");
    } finally {
      setNotificationActionId(null);
    }
  }

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
          <button ref={notificationTriggerRef} aria-controls="notification-popover" aria-expanded={notifOpen} aria-label="Notifications" onClick={() => notifOpen ? closeNotifications(false) : (setNotifOpen(true), void loadNotifications())} className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted text-muted-foreground transition-colors" type="button"><Bell className="w-4 h-4" />{notificationUnreadCount > 0 ? <span aria-label={`${notificationUnreadCount} unread notifications`} className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-4 text-white">{notificationUnreadCount > 9 ? "9+" : notificationUnreadCount}</span> : null}</button>
          {notifOpen && (
            <section aria-label="Notifications" className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-popover shadow-lg" id="notification-popover">
              <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="text-sm font-semibold text-foreground">Notifications</h2><p className="mt-0.5 text-[11px] text-muted-foreground">Yêu cầu duyệt và cập nhật project</p></div><button aria-label="Close notifications" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={() => closeNotifications()} type="button">Close</button></div>
              {notificationError ? <p role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">{notificationError}</p> : null}
              <div className="max-h-[min(32rem,calc(100vh-10rem))] overflow-y-auto p-2">
                {notificationLoading && !notifications.length ? <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải…</div> : null}
                {!notificationLoading && !notifications.length ? <p className="rounded-xl bg-muted px-3 py-8 text-center text-xs text-muted-foreground">No notifications yet.</p> : null}
                {notifications.map((notification) => {
                  const approval = notification.kind === "milestone_approval" && notification.status !== "resolved";
                  const projectId = notification.data?.projectId;
                  const milestoneId = notification.data?.milestoneId;
                  return <article key={notification.id} className={`rounded-xl border p-3 ${notification.status === "resolved" ? "border-border bg-background opacity-70" : notification.readAt ? "border-border bg-background" : "border-blue-100 bg-blue-50/50"}`}>
                    <div className="flex items-start gap-2"><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${notification.status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>{notification.status === "resolved" ? <Check className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}</span><div className="min-w-0 flex-1"><p className="text-xs font-bold text-foreground">{notification.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{notification.body}</p><p className="mt-1 text-[10px] text-muted-foreground">{notificationTime(notification.createdAt)}{notification.status === "resolved" ? " · Đã xử lý" : ""}</p></div></div>
                    <div className="mt-2 flex items-center justify-end gap-2"><Link href={notification.href} onClick={() => void markNotificationRead(notification)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10"><ExternalLink className="h-3 w-3" /> Mở project</Link>{approval && projectId && milestoneId ? <button type="button" disabled={notificationActionId === notification.id} onClick={() => void approveFromNotification(notification)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60">{notificationActionId === notification.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Duyệt</button> : null}</div>
                  </article>;
                })}
              </div>
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
