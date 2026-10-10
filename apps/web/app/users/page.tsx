"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown,
  Download,
  Shield, Code, Palette, BarChart2, Globe,
} from "lucide-react";
import Link from "next/link";
import { AdminInvitations } from "@/components/auth/admin-access-controls";
import { AppShell } from "@/components/constructor-x/app-shell";
import { CustomDropdown } from "@/components/crm-workspace/tasks-workbench";
import { downloadCsv } from "@/lib/csv-export";
import { useAuth } from "@/lib/auth";
import type { EmploymentStatus, WorkspaceSystemRole } from "@b2b-crm/contracts";
import { BUSINESS_ROLE_OPTIONS, businessRoleFromMember, systemRoleFromCodes, SYSTEM_ROLE_LABELS, SYSTEM_ROLE_OPTIONS } from "@/lib/people-roles";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc" | null;
type SortKey = "name" | "role" | "status";
type UserStatus = "active" | "on_leave" | "inactive" | "suspended";

interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  larkOpenId?: string;
  roleCodes: string[];
  role: string;
  systemRole: WorkspaceSystemRole;
  roleColor: string;
  status: UserStatus;
  avatarColor: string;
  initials: string;
  costPermissionGroup: string;
  /** Hours logged in the current month. */
  loggedHours: number;
}

interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  departmentCode?: string;
  larkOpenId?: string;
  roleCodes: string[];
  systemRole?: WorkspaceSystemRole;
  resourceDisplayRole?: string;
  projectIds: string[];
  status: "active" | "suspended";
  employmentStatus?: EmploymentStatus;
  createdAt: string;
  costPermissionCodes?: string[];
}

interface UsersResponse {
  data: ApiUser[];
  meta: {
    total: number;
  };
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<UserStatus, { label: string; className: string }> = {
  active:    { label: "Active",    className: "bg-emerald-50 text-emerald-700" },
  on_leave:  { label: "On leave",  className: "bg-amber-50 text-amber-700" },
  inactive:  { label: "Inactive",  className: "bg-slate-100 text-slate-600" },
  suspended: { label: "Suspended", className: "bg-slate-100 text-slate-600" },
};

function statusFromApi(user: ApiUser): UserStatus {
  if (user.status !== "active") return "suspended";
  if (user.employmentStatus === "ON_LEAVE") return "on_leave";
  return user.employmentStatus === "INACTIVE" ? "inactive" : "active";
}

const hoursFormat = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const ROLE_ICONS: Record<string, typeof Shield> = {
  "Customer success": Shield,
  "Project Manager": BarChart2,
  "DX enabler": Code,
  "Business development": Globe,
  "Marketing B2B": Palette,
  "Chưa gán": Shield,
};

const ROLE_COLORS: Record<string, string> = {
  "Customer success": "#0891b2",
  "Project Manager": "#7c3aed",
  "DX enabler": "#2563eb",
  "Business development": "#16a34a",
  "Marketing B2B": "#db2777",
  "Chưa gán": "#64748b",
};

const AVATAR_COLORS = ["#2563eb", "#16a34a", "#7c3aed", "#d97706", "#db2777", "#0891b2", "#475569", "#0f766e"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const lastTwo = parts.length > 1 ? parts.slice(-2) : parts;
  return lastTwo.map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function mapApiUser(user: ApiUser, index: number, loggedMinutes: number): User {
  const systemRole = user.systemRole ?? systemRoleFromCodes(user.roleCodes);
  const primaryRole = businessRoleFromMember(user);
  const displayName = user.displayName || user.email;
  return {
    id: user.id,
    name: displayName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    larkOpenId: user.larkOpenId,
    roleCodes: user.roleCodes,
    role: primaryRole,
    systemRole,
    roleColor: ROLE_COLORS[primaryRole] ?? "#64748b",
    status: statusFromApi(user),
    avatarColor: AVATAR_COLORS[index % AVATAR_COLORS.length],
    initials: initials(displayName),
    costPermissionGroup: user.roleCodes.includes("FOUNDER_GM") ? "Toàn quyền" : (user.costPermissionCodes?.length ? user.costPermissionCodes.map((code) => code.replace("COST_", "")).join(" / ") : "Chưa cấp"),
    loggedHours: loggedMinutes / 60
  };
}

type MonthTimeEntry = { userId?: string; minutes?: number };

// The API caps a page at 100 rows, so read every page or the monthly totals undercount.
async function loadMonthTimeEntries(startAt: string, endAt: string) {
  const rows: MonthTimeEntry[] = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`/api/tasks/time-entries?limit=100&offset=${offset}&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Time entries API returned ${response.status}`);
    const payload = (await response.json()) as { data?: MonthTimeEntry[]; meta?: { pagination?: { hasNextPage?: boolean } } };
    rows.push(...(payload.data ?? []));
    if (!payload.meta?.pagination?.hasNextPage || !payload.data?.length) return rows;
  }
}

// ─── Sort indicator ───────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="w-3.5 h-3.5 text-primary" />
    : <ChevronDown className="w-3.5 h-3.5 text-primary" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const canManageRoles = Boolean(currentUser?.roleCodes?.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN"));
  const [users, setUsers]       = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [query, setQuery]       = useState("");
  const [sortKey, setSortKey]   = useState<SortKey>("name");
  const [sortDir, setSortDir]   = useState<SortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter]     = useState<string>("all");
  const [systemRoleFilter, setSystemRoleFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setIsLoading(true);
      setError(null);
      try {
        const now = new Date();
        const startAt = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const endAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
        // Logwork is a secondary column: a failed time-entry request must not hide the directory.
        // The BFF route already asks the API for suspended members; repeating the param here breaks it.
        const [response, entries] = await Promise.all([
          fetch("/api/admin/users", { cache: "no-store" }),
          loadMonthTimeEntries(startAt, endAt).catch(() => [])
        ]);
        if (response.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent("/users")}`;
          return;
        }
        if (!response.ok) {
          throw new Error(`Users API returned ${response.status}`);
        }
        const payload = (await response.json()) as UsersResponse;
        const minutesByUser = new Map<string, number>();
        for (const entry of entries) if (entry.userId) minutesByUser.set(entry.userId, (minutesByUser.get(entry.userId) ?? 0) + (entry.minutes ?? 0));
        if (!cancelled) {
          setUsers(payload.data.map((user, index) => mapApiUser(user, index, minutesByUser.get(user.id) ?? 0)));
        }
      } catch (err) {
        if (!cancelled) {
          setUsers([]);
          setError(err instanceof Error ? err.message : "Could not load users");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let list = users.filter(u => {
      const q = query.toLowerCase();
      const systemRole = SYSTEM_ROLE_LABELS[u.systemRole].toLowerCase();
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q) && !u.role.toLowerCase().includes(q) && !systemRole.includes(q) && !u.larkOpenId?.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (roleFilter   !== "all" && u.role   !== roleFilter)   return false;
      if (systemRoleFilter !== "all" && u.systemRole !== systemRoleFilter) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      let va: string | number = a[sortKey];
      let vb: string | number = b[sortKey];
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [query, sortKey, sortDir, statusFilter, roleFilter, systemRoleFilter, users]);

  const statusOptions = useMemo(() => [
    { value: "all", label: "Tất cả trạng thái" },
    ...Object.entries(STATUS_CONFIG).map(([value, config]) => ({ value, label: config.label }))
  ], []);

  const roleOptions = useMemo(() => [
    { value: "all", label: "Tất cả vai trò" },
    ...BUSINESS_ROLE_OPTIONS.map((role) => ({ value: role, label: role })),
  ], []);

  const systemRoleFilterOptions = useMemo(() => [
    { value: "all", label: "Tất cả system role" },
    ...SYSTEM_ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
  ], []);
  const COLS: { key: SortKey; label: string }[] = [
    { key: "name",       label: "User" },
    { key: "role",       label: "Role" },
    { key: "status",     label: "Status" },
  ];

  return (
    <AppShell activeRoute="/users" title="Users">
        <main className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          {/* Page header */}
          <header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="!text-xl font-bold text-foreground">Team Members</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{canManageRoles ? "Bạn có quyền quản trị workspace này." : "Chỉ Admin mới được chỉnh quyền."}</p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <button
                type="button"
                onClick={() => downloadCsv("uplark-users-filtered.csv", ["Name", "Email", "Role", "System role", "Status"], filtered.map((user) => [user.name, user.email, user.role, SYSTEM_ROLE_LABELS[user.systemRole], STATUS_CONFIG[user.status].label]))}
                aria-label={`Export ${filtered.length} filtered users as CSV`}
                className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <AdminInvitations />
            </div>
          </header>

          {/* Filters */}
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="flex flex-col items-stretch gap-3 border-b border-border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4 xl:flex-nowrap">
              {/* Search */}
              <div className="flex min-w-0 items-center gap-2.5 flex-1 bg-background border border-input rounded-xl px-3.5 py-2">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by name, email, Lark ID, role or system role..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                />
              </div>

              {/* Status filter */}
              <div className="w-full shrink-0 sm:w-48">
                <CustomDropdown
                  label=""
                  options={statusOptions}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>

              {/* Role filter */}
              <div className="w-full shrink-0 sm:w-56">
                <CustomDropdown
                  label=""
                  options={roleOptions}
                  value={roleFilter}
                  onChange={setRoleFilter}
                />
              </div>

              {/* System role filter */}
              <div className="w-full shrink-0 sm:w-56">
                <CustomDropdown
                  label=""
                  options={systemRoleFilterOptions}
                  value={systemRoleFilter}
                  onChange={setSystemRoleFilter}
                />
              </div>

            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {COLS.map(col => (
                      <th key={col.key} className="py-3 px-4 text-left">
                        <button
                          onClick={() => handleSort(col.key)}
                          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {col.label}
                          <SortIcon active={sortKey === col.key} dir={sortKey === col.key ? sortDir : null} />
                        </button>
                      </th>
                    ))}
                    <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">System role</th>
                    <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quyền P&amp;L</th>
                    <th className="py-3 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Logwork tháng (h)</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {filtered.map((user, i) => {
                      const st = STATUS_CONFIG[user.status];
                      const RoleIcon = ROLE_ICONS[user.role] ?? Shield;
                      return (
                        <motion.tr
                          key={user.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-border/50 hover:bg-muted/30 transition-colors group"
                        >

                          {/* User */}
                          <td className="py-3.5 px-4">
                            <Link href={`/users/${user.id}`} className="flex items-center gap-3">
                              <div className="relative shrink-0">
                                <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-sm shadow-sm" style={{ backgroundColor: user.avatarColor }}>
                                  {user.avatarUrl ? (
                                    <img src={user.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    user.initials
                                  )}
                                </div>
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{user.name}</p>
                                <p className="text-[11px] text-muted-foreground">{user.email}</p>
                                <p className="mt-0.5 font-mono text-[10px] text-slate-500">{user.larkOpenId ?? "Chưa map Lark User ID"}</p>
                              </div>
                            </Link>
                          </td>

                          {/* Role */}
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ backgroundColor: `${user.roleColor}15`, color: user.roleColor }}>
                              <RoleIcon className="w-3 h-3" />
                              {user.role}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="py-3.5 px-4">
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.className}`}>{st.label}</span>
                          </td>

                          {/* System role */}
                          <td className="py-3.5 px-4 text-sm text-foreground">
                            {SYSTEM_ROLE_LABELS[user.systemRole]}
                            {user.id === currentUser?.id && <span className="ml-1.5 text-xs text-muted-foreground">(bạn)</span>}
                          </td>

                          {/* P&L permission */}
                          <td className="py-3.5 px-4 text-sm text-muted-foreground">{user.costPermissionGroup}</td>

                          {/* Logwork */}
                          <td className="py-3.5 px-4 text-right font-mono text-sm font-semibold tabular-nums text-foreground">{hoursFormat.format(user.loggedHours)}</td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>

              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Search className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{isLoading ? "Loading users" : error ? "Could not load users" : "No users found"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{error ?? (isLoading ? "Please wait while the team directory loads" : "Try adjusting your search or filters")}</p>
                </div>
              )}
            </div>

            {/* Table footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of <span className="font-semibold text-foreground">{users.length}</span> users
              </p>
            </div>
          </div>
        </main>

        <footer className="h-11 border-t border-border bg-card flex items-center justify-between px-5 shrink-0">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>
    </AppShell>
  );
}
