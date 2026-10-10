"use client";

import React from "react";
import Link from "next/link";
import { SecuritySettings, WorkspaceSwitcher } from "@/components/auth/security-settings";
import { CheckCircle2, LogOut, Palette, Shield, User } from "lucide-react";
import { AppShell } from "@/components/constructor-x/app-shell";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { systemRoleFromCodes, systemRoleLabel } from "@/lib/people-roles";

const SETTINGS_SECTIONS = [
  { id: "ho-so", label: "Hồ sơ" },
  { id: "bao-mat", label: "Bảo mật" },
  { id: "phien-dang-nhap", label: "Phiên đăng nhập" },
  { id: "workspace", label: "Workspace" },
  { id: "giao-dien", label: "Giao diện" }
];

export default function SettingsPage() {
  const theme = useTheme();
  const { user, logout } = useAuth();
  const isWorkspaceAdmin = Boolean(user?.roleCodes?.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN"));
  const isLocalSession = process.env.NEXT_PUBLIC_LOCAL_AUTO_AUTH === "true";

  return (
    <AppShell activeRoute="/settings" title="Settings">
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="!text-xl font-bold text-foreground">Cấu hình workspace</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Hồ sơ, bảo mật, phiên đăng nhập, workspace và giao diện của tài khoản bạn.
              </p>
            </div>
            {isWorkspaceAdmin && (
              <Link
                href="/admin"
                className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                <Shield className="h-4 w-4" />
                Admin
              </Link>
            )}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
            <nav aria-label="Mục cài đặt" className="flex gap-1 overflow-x-auto lg:sticky lg:top-0 lg:flex-col lg:overflow-visible">
              {SETTINGS_SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="shrink-0 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {section.label}
                </a>
              ))}
            </nav>

            <div className="min-w-0 space-y-4">
            <section id="ho-so" className="scroll-mt-4 rounded-xl border border-border bg-card p-5 shadow-sm">
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
                  <ReadOnlyField label="System role" value={user?.roleCodes ? systemRoleLabel(systemRoleFromCodes(user.roleCodes)) : undefined} />
                  <ReadOnlyField label="User ID" value={user?.id} />
                </div>
              </div>
            </section>

            <div id="bao-mat" className="scroll-mt-4">
              <SecuritySettings
                sessionSlot={
                  <div className="space-y-3 border-t border-border pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isLocalSession ? "border-amber-200 bg-amber-50 text-amber-700" : "border-success/20 bg-success/5 text-success"}`}>
                        <CheckCircle2 className="h-4 w-4" />
                        {isLocalSession ? "Local development session" : "Authenticated"}
                      </div>
                      <button
                        onClick={logout}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-destructive/30 px-4 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                    {isLocalSession && (
                      <p className="text-xs leading-5 text-muted-foreground">
                        Local founder mode đang bật để kiểm tra dữ liệu workspace. Khi deploy production, màn hình này chỉ hiển thị phiên xác thực thật.
                      </p>
                    )}
                  </div>
                }
              />
            </div>

            <div id="workspace" className="scroll-mt-4">
              <WorkspaceSwitcher />
            </div>

            <section id="giao-dien" className="scroll-mt-4 rounded-xl border border-border bg-card p-5 shadow-sm">
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
