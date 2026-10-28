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
import { matchesSearch } from "@/components/crm-workspace/crm-select-search";
import { DateRangeFilter, FilterBar, FilterField, MultiSelectFilter, SearchFilter, datePresets, formatDay, matchesAny, standardDatePresets, type DateRange } from "@/components/filters";
import { HeaderButton, HeaderLinkButton, PageHeader, pageMainClassName } from "@/components/page-header";
import { fetchAllPages } from "@/lib/api-pages";
import { splitDateRangeIntoChunks } from "@/lib/calendar-event-layout";
import { vietnamDayEndIso, vietnamDayStartIso } from "@/lib/vietnam-time";
import { downloadCsv } from "@/lib/csv-export";
import { useAuth } from "@/lib/auth";
import { isAdminView } from "@/lib/auth-role";
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
  departmentCode?: string;
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

function mapApiUser(user: ApiUser, index: number): User {
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
    departmentCode: user.departmentCode || undefined
  };
}

type PeriodTimeEntry = { id: string; userId?: string; minutes?: number };

// The hours column needs a bounded period (the API takes at most 90 days per request), so "all time" is not offered.
const PERIOD_PRESETS = standardDatePresets().filter((preset) => preset.from && preset.to);
const THIS_MONTH: DateRange = (({ from, to }) => ({ from, to }))(datePresets(["this-month"])[0]);

function logworkPeriodLabel(range: DateRange) {
  if (!range.from || !range.to) return "Tất cả thời gian";
  const monthKey = range.from.slice(0, 7);
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const isWholeMonth = range.from === `${monthKey}-01` && range.to === lastDay;
  const periodName = isWholeMonth ? `Tháng ${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}` : `${formatDay(range.from)} – ${formatDay(range.to)}`;
  return `${periodName} (${formatDay(range.from)} – ${formatDay(range.to)})`;
}

/** Minutes logged per user between two Vietnam days: every page of every ≤90-day chunk, each entry counted once. */
async function loadLoggedMinutes(range: DateRange, signal: AbortSignal) {
  const chunks = splitDateRangeIntoChunks(vietnamDayStartIso(range.from), vietnamDayEndIso(range.to));
  const pages = await Promise.all(chunks.map((chunk) => fetchAllPages<PeriodTimeEntry>(`/api/tasks/time-entries?startAt=${encodeURIComponent(chunk.startAt)}&endAt=${encodeURIComponent(chunk.endAt)}`, { signal })));
  const entries = new Map(pages.flat().map((entry) => [entry.id, entry]));
  const minutesByUser = new Map<string, number>();
  for (const entry of entries.values()) if (entry.userId) minutesByUser.set(entry.userId, (minutesByUser.get(entry.userId) ?? 0) + (entry.minutes ?? 0));
  return minutesByUser;
}

const DETAIL_QUERY = `?returnTo=${encodeURIComponent("/users")}`;

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
  const canManageRoles = isAdminView(currentUser);
  const [users, setUsers]       = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [query, setQuery]       = useState("");
  const [sortKey, setSortKey]   = useState<SortKey>("name");
  const [sortDir, setSortDir]   = useState<SortDir>("asc");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [roleFilter, setRoleFilter]     = useState<string[]>([]);
  const [systemRoleFilter, setSystemRoleFilter] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [period, setPeriod] = useState<DateRange>(THIS_MONTH);
  const [minutesByUser, setMinutesByUser] = useState<Map<string, number> | null>(null);

  // Logwork is a secondary column: a failed time-entry request must not hide the directory.
  useEffect(() => {
    const controller = new AbortController();
    setMinutesByUser(null);
    loadLoggedMinutes(period, controller.signal)
      .then((minutes) => { if (!controller.signal.aborted) setMinutesByUser(minutes); })
      .catch(() => { if (!controller.signal.aborted) setMinutesByUser(new Map()); });
    return () => controller.abort();
  }, [period]);

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setIsLoading(true);
      setError(null);
      try {
        // The BFF route already asks the API for suspended members; repeating the param here breaks it.
        const response = await fetch("/api/admin/users", { cache: "no-store" });
        if (response.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent("/users")}`;
          return;
        }
        if (!response.ok) {
          throw new Error(`Users API returned ${response.status}`);
        }
        const payload = (await response.json()) as UsersResponse;
        if (!cancelled) {
          setUsers(payload.data.map(mapApiUser));
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
    let list = users.filter(u => matchesSearch(query, u.name, u.email, u.role, SYSTEM_ROLE_LABELS[u.systemRole], u.larkOpenId)
      && matchesAny(statusFilter, u.status)
      && matchesAny(roleFilter, u.role)
      && matchesAny(systemRoleFilter, u.systemRole)
      && matchesAny(departmentFilter, u.departmentCode));

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
  }, [query, sortKey, sortDir, statusFilter, roleFilter, systemRoleFilter, departmentFilter, users]);

  const statusOptions = useMemo(() => Object.entries(STATUS_CONFIG).map(([value, config]) => ({ value, label: config.label })), []);
  const roleOptions = useMemo(() => BUSINESS_ROLE_OPTIONS.map((role) => ({ value: role, label: role })), []);
  const systemRoleFilterOptions = useMemo(() => SYSTEM_ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label })), []);
  const departmentOptions = useMemo(() => [...new Set(users.map((user) => user.departmentCode).filter((code): code is string => Boolean(code)))].sort().map((code) => ({ value: code, label: code })), [users]);
  const periodChanged = period.from !== THIS_MONTH.from || period.to !== THIS_MONTH.to;
  const activeFilterCount = [Boolean(query.trim()), periodChanged, statusFilter.length > 0, roleFilter.length > 0, systemRoleFilter.length > 0, departmentFilter.length > 0].filter(Boolean).length;
  const resetFilters = () => { setQuery(""); setPeriod(THIS_MONTH); setStatusFilter([]); setRoleFilter([]); setSystemRoleFilter([]); setDepartmentFilter([]); };
  const COLS: { key: SortKey; label: string }[] = [
    { key: "name",       label: "User" },
    { key: "role",       label: "Role" },
    { key: "status",     label: "Status" },
  ];

  return (
    <AppShell activeRoute="/users" title="Nhân sự">
        <main className={pageMainClassName}>
          <PageHeader
            title="Nhân sự"
            subtitle={canManageRoles ? "Bạn có quyền quản trị workspace này." : "Chỉ Admin mới được chỉnh quyền."}
            actions={<>
              {/* Mục 6.7: chi phí nhân sự theo tháng của cả công ty; the API lets only the cost permission group in. */}
              <HeaderLinkButton href="/users/costs">Chi phí theo tháng</HeaderLinkButton>
              <HeaderButton
                icon={<Download className="w-4 h-4" />}
                onClick={() => downloadCsv("uplark-users-filtered.csv", ["Name", "Email", "Role", "System role", "Status"], filtered.map((user) => [user.name, user.email, user.role, SYSTEM_ROLE_LABELS[user.systemRole], STATUS_CONFIG[user.status].label]))}
                aria-label={`Xuất ${filtered.length} nhân sự đang lọc ra CSV`}>
                Xuất CSV
              </HeaderButton>
              <AdminInvitations />
            </>}
          />

          {/* Filters */}
          <div className="bg-card border border-border rounded-xl shadow-sm">
            <FilterBar className="border-b border-border px-3 py-3 sm:px-4" onReset={activeFilterCount ? resetFilters : undefined} activeCount={activeFilterCount}>
              <FilterField label="Tìm kiếm" className="min-w-[220px] flex-1"><SearchFilter className="" value={query} onChange={setQuery} placeholder="Tên, email, Lark ID, vai trò..." ariaLabel="Tìm nhân sự" /></FilterField>
              <FilterField label="Kỳ tính giờ"><DateRangeFilter value={period} onChange={(range) => setPeriod(range.from && range.to ? range : THIS_MONTH)} presets={PERIOD_PRESETS} clearable={false} ariaLabel="Kỳ tính giờ logwork" /></FilterField>
              <MultiSelectFilter label="Trạng thái" options={statusOptions} values={statusFilter} onChange={setStatusFilter} allLabel="Tất cả trạng thái" searchable={false} />
              <MultiSelectFilter label="Vai trò" options={roleOptions} values={roleFilter} onChange={setRoleFilter} allLabel="Tất cả vai trò" />
              <MultiSelectFilter label="System role" options={systemRoleFilterOptions} values={systemRoleFilter} onChange={setSystemRoleFilter} allLabel="Tất cả system role" searchable={false} />
              <MultiSelectFilter label="Phòng ban" options={departmentOptions} values={departmentFilter} onChange={setDepartmentFilter} allLabel="Tất cả phòng ban" hideWhenSingle />
            </FilterBar>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/10 px-4 py-2.5 text-xs">
              <p className="text-muted-foreground">
                Giờ đã ghi đang hiển thị cho <span className="font-semibold text-foreground">{logworkPeriodLabel(period)}</span>.
                <span className="ml-1">Đổi “Kỳ tính giờ” để xem tháng hoặc khoảng ngày khác.</span>
              </p>
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
                    <th className="py-3 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" title={`Tổng số giờ đã ghi trong ${logworkPeriodLabel(period)}`}>
                      <span className="block">Logwork</span>
                      <span className="mt-0.5 block normal-case tracking-normal text-[10px] font-medium text-muted-foreground">{logworkPeriodLabel(period)} (h)</span>
                    </th>
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
                            <Link href={`/users/${user.id}${DETAIL_QUERY}`} className="flex items-center gap-3">
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
                                <p className="mt-0.5 font-mono text-[10px] text-slate-500">{user.larkOpenId ?? "Chưa liên kết Lark User ID"}</p>
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
                          <td className="py-3.5 px-4 text-right font-mono text-sm font-semibold tabular-nums text-foreground">{minutesByUser ? hoursFormat.format((minutesByUser.get(user.id) ?? 0) / 60) : "…"}</td>
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
                  <p className="text-sm font-medium text-foreground">{isLoading ? "Đang tải nhân sự…" : error ? "Không tải được danh sách nhân sự" : users.length ? "Không có kết quả phù hợp bộ lọc" : "Chưa có nhân sự nào"}</p>
                  {error ? <p className="text-xs text-muted-foreground mt-1">{error}</p> : null}
                  {!isLoading && !error && activeFilterCount ? <button type="button" onClick={resetFilters} className="mt-3 rounded-lg border border-border px-3 py-1.5 !text-xs !font-semibold text-primary hover:bg-muted">Đặt lại bộ lọc</button> : null}
                </div>
              )}
            </div>

            {/* Table footer */}
          <div className="flex items-center justify-between rounded-b-xl px-4 py-3 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Hiển thị <span className="font-semibold text-foreground">{filtered.length}</span> / <span className="font-semibold text-foreground">{users.length}</span> nhân sự
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
