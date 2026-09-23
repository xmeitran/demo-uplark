"use client";

import React from "react";
import { SecuritySettings, WorkspaceSwitcher } from "@/components/auth/security-settings";
import { CheckCircle2, LogOut, Palette, Shield, User } from "lucide-react";
import { AppShell } from "@/components/constructor-x/app-shell";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  const theme = useTheme();
  const { user, logout } = useAuth();
  const isLocalSession = process.env.NEXT_PUBLIC_LOCAL_AUTO_AUTH === "true";

  return (
    <AppShell activeRoute="/settings" title="Settings">
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="mb-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">WORKSPACE SETTINGS</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Cấu hình workspace</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Xem chính sách workspace, quyền truy cập và phiên làm việc. Các thao tác điều hành tập trung ở tab Admin.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">Profile</h2>
                  <p className="text-xs text-muted-foreground">Đồng bộ từ phiên workspace hiện tại.</p>
                </div>
              </div>

              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div
                  className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-xl font-black text-white shadow-sm"
                  style={{ backgroundColor: user?.avatarColor ?? "#059669" }}
                >
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    user?.initials ?? "B2B"
                  )}
                </div>
                <div className="grid flex-1 gap-3 sm:grid-cols-2">
                  <ReadOnlyField label="Full name" value={user?.name} />
                  <ReadOnlyField label="Email" value={user?.email} />
                  <ReadOnlyField label="Role" value={user?.role} />
                  <ReadOnlyField label="User ID" value={user?.id} />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">Session</h2>
                  <p className="text-xs text-muted-foreground">Current browser session status.</p>
                </div>
              </div>

              <div className={`mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isLocalSession ? "border-amber-200 bg-amber-50 text-amber-700" : "border-success/20 bg-success/5 text-success"}`}>
                <CheckCircle2 className="h-4 w-4" />
                {isLocalSession ? "Local development session" : "Authenticated"}
              </div>
              {isLocalSession && (
                <p className="mb-4 text-xs leading-5 text-muted-foreground">
                  Local founder mode đang bật để kiểm tra dữ liệu workspace. Khi deploy production, màn hình này chỉ hiển thị phiên xác thực thật.
                </p>
              )}

              <button
                onClick={logout}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 px-4 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </section>

            <WorkspaceSwitcher />
            <SecuritySettings />
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Palette className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">Appearance</h2>
                    <p className="text-xs text-muted-foreground">Local display preference for this browser.</p>
                  </div>
                </div>
                <button
                  onClick={theme.toggle}
                  className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  {theme.isDark ? "Use light mode" : "Use dark mode"}
                </button>
              </div>
            </section>
          </div>
        </main>
    </AppShell>
  );
}

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="min-h-11 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium text-foreground">
        {value || "Not available"}
      </div>
    </div>
  );
}
