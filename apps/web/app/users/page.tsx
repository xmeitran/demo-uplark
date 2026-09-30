"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown,
  UserPlus, Download,
  ArrowRight, Shield, Code, Palette, BarChart2, Globe,
  CheckCircle2, XCircle, Mail, Phone, ShieldCheck, ShieldOff, Loader2,
} from "lucide-react";
import Link from "next/link";
import { AdminInvitations } from "@/components/auth/admin-access-controls";
import { AppShell } from "@/components/constructor-x/app-shell";
import { formatDepartmentLabel } from "@/lib/department-labels";
import { CustomDropdown } from "@/components/crm-workspace/tasks-workbench";
import { downloadCsv } from "@/lib/csv-export";
import { useAuth } from "@/lib/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc" | null;
type SortKey = "name" | "role" | "department" | "status";

interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  larkOpenId?: string;
  roleCodes: string[];
  role: string;
  roleColor: string;
  department: string;
  status: "active" | "offline";
  tasks: number;
  avatarColor: string;
  initials: string;
  location: string;
  costPermissionGroup: string;
  costPermissionCodes: string[];
}

interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  departmentCode?: string;
  larkOpenId?: string;
  roleCodes: string[];
  projectIds: string[];
  status: "active" | "suspended";
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

const STATUS_CONFIG = {
  active:  { label: "Online",  color: "#16a34a", bg: "#dcfce7", icon: CheckCircle2 },
  offline: { label: "Offline", color: "#64748b", bg: "#f1f5f9", icon: XCircle },
};

const ROLE_ICONS: Record<string, typeof Shield> = {
  FOUNDER_GM:    Shield,
  SALES_OWNER:   BarChart2,
  DELIVERY_LEAD: Code,
  FINANCE_ADMIN: Globe,
  Admin:         Shield,
  Developer:     Code,
  Designer:      Palette,
  PM:            BarChart2,
  Analyst:       BarChart2,
  DevOps:        Globe,
};

const ROLE_COLORS: Record<string, string> = {
  FOUNDER_GM: "#2563eb",
  WORKSPACE_ADMIN: "#4f46e5",
  WORKSPACE_USER: "#64748b",
  SALES_OWNER: "#16a34a",
  DELIVERY_LEAD: "#7c3aed",
  FINANCE_ADMIN: "#d97706"
};

const AVATAR_COLORS = ["#2563eb", "#16a34a", "#7c3aed", "#d97706", "#db2777", "#0891b2", "#475569", "#0f766e"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const lastTwo = parts.length > 1 ? parts.slice(-2) : parts;
  return lastTwo.map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function mapApiUser(user: ApiUser, index: number): User {
  const primaryRole = user.roleCodes[0] ?? "DELIVERY_LEAD";
  const displayName = user.displayName || user.email;
  return {
    id: user.id,
    name: displayName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    larkOpenId: user.larkOpenId,
    roleCodes: user.roleCodes,
    role: primaryRole,
    roleColor: ROLE_COLORS[primaryRole] ?? "#64748b",
    department: formatDepartmentLabel(user.departmentCode, "Chưa có phòng ban"),
    status: user.status === "active" ? "active" : "offline",
    tasks: 0,
    avatarColor: AVATAR_COLORS[index % AVATAR_COLORS.length],
    initials: initials(displayName),
    location: user.larkOpenId ? "Lark" : "Internal",
    costPermissionCodes: user.roleCodes.includes("FOUNDER_GM") ? ["COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"] : (user.costPermissionCodes ?? []),
    costPermissionGroup: user.roleCodes.includes("FOUNDER_GM") ? "Toàn quyền chi phí" : (user.costPermissionCodes?.length ? user.costPermissionCodes.map((code) => code.replace("COST_", "")).join(" / ") : "Chưa cấp")
  };
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
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [costSavingId, setCostSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setIsLoading(true);
      setError(null);
      try {
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

  async function changeWorkspaceRole(target: User, roleCode: "WORKSPACE_ADMIN" | "WORKSPACE_USER") {
    setRoleSavingId(target.id);
    setRoleMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}/role`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleCode })
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Không thể cập nhật quyền workspace.");
      setUsers((current) => current.map((item) => {
        if (item.id !== target.id) return item;
        return { ...item, role: roleCode, roleCodes: [roleCode], roleColor: ROLE_COLORS[roleCode] ?? "#64748b" };
      }));
      setRoleMessage(`Đã cập nhật ${target.name} (${target.larkOpenId ?? target.id}) thành ${roleCode === "WORKSPACE_ADMIN" ? "Workspace Admin" : "Workspace User"}.`);
    } catch (err) {
      setRoleMessage(err instanceof Error ? err.message : "Không thể cập nhật quyền workspace.");
    } finally {
      setRoleSavingId(null);
    }
  }

  async function changeCostPermissions(target: User, preset: string) {
    const permissionCodes = preset === "ALL" ? ["COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"] : preset === "NONE" ? [] : [preset];
    setCostSavingId(target.id); setRoleMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}/cost-permissions`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ permissionCodes }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? "Không thể cập nhật nhóm quyền chi phí.");
      setUsers((current) => current.map((item) => item.id === target.id ? { ...item, costPermissionCodes: payload.costPermissionCodes ?? permissionCodes, costPermissionGroup: permissionCodes.length ? permissionCodes.map((code) => code.replace("COST_", "")).join(" / ") : "Chưa cấp" } : item));
      setRoleMessage(`Đã cập nhật nhóm quyền chi phí cho ${target.name}.`);
    } catch (err) { setRoleMessage(err instanceof Error ? err.message : "Không thể cập nhật nhóm quyền chi phí."); }
    finally { setCostSavingId(null); }
  }

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
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q) && !u.role.toLowerCase().includes(q) && !u.larkOpenId?.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (roleFilter   !== "all" && u.role   !== roleFilter)   return false;
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
  }, [query, sortKey, sortDir, statusFilter, roleFilter, users]);

  const uniqueRoles = useMemo(() => [...new Set(users.map(u => u.role))], [users]);
  const workspaceAdminCount = useMemo(
    () => users.filter((user) => user.roleCodes.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN")).length,
    [users]
  );
  const workspaceUserCount = useMemo(
    () => users.filter((user) => user.roleCodes.includes("WORKSPACE_USER")).length,
    [users]
  );

  const statusOptions = useMemo(() => [
    { value: "all", label: "Tất cả trạng thái" },
    { value: "active", label: "Online" },
    { value: "offline", label: "Offline" }
  ], []);

  const roleOptions = useMemo(() => [
    { value: "all", label: "Tất cả quyền hệ thống" },
    ...uniqueRoles.map(r => ({ value: r, label: r }))
  ], [uniqueRoles]);

  const COLS: { key: SortKey; label: string }[] = [
    { key: "name",       label: "User" },
    { key: "role",       label: "Role" },
    { key: "department", label: "Department" },
    { key: "status",     label: "Status" },
  ];

  return (
    <AppShell activeRoute="/users" title="Users">
        <main className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6">
          <div className="mx-auto max-w-[1600px] space-y-5">
          {/* Page header */}
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] text-primary">USERS · WORKSPACE ACCESS</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Team Members</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Quản lý thành viên workspace, vai trò hệ thống và quyền P&amp;L theo từng User ID.</p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => downloadCsv("uplark-users-filtered.csv", ["Name", "Email", "Role", "Department", "Status"], filtered.map((user) => [user.name, user.email, user.role, user.department, user.status]))}
                aria-label={`Export ${filtered.length} filtered users as CSV`}
                title="Export the currently loaded and filtered users"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted">
                <Download className="w-4 h-4" /> Export filtered CSV
              </motion.button>

            </div>
          </header>

          <AdminInvitations />

          <section className="mb-6 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-indigo-600" /><h2 className="text-sm font-semibold text-foreground">Workspace access theo Lark User ID</h2></div>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Quyền hệ thống và nhóm quyền chi phí là hai lớp độc lập. Chỉ Founder/GM mới mặc định có toàn quyền chi phí; tài khoản khác chỉ thấy dữ liệu khi được cấp nhóm quyền.</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm">{canManageRoles ? "Bạn có quyền quản trị" : "Chỉ Admin mới được chỉnh"}</span>
            </div>
            {roleMessage && <p role="status" className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">{roleMessage}</p>}
          </section>
          {/* Stats bar */}
          <section aria-label="Workspace member metrics" className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
            {[
              { label: "Total users",    value: users.length,                                      tone: "text-primary" },
              { label: "Total admins",   value: workspaceAdminCount,                              tone: "text-indigo-600" },
              { label: "Workspace users", value: workspaceUserCount,                              tone: "text-sky-600" },
              { label: "Online",         value: users.filter(u => u.status === "active").length,  tone: "text-emerald-600" },
              { label: "Offline",        value: users.filter(u => u.status === "offline").length, tone: "text-slate-500" },
            ].map(s => (
              <motion.div key={s.label} whileHover={{ y: -2 }} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <p className={`font-mono text-2xl font-bold tabular-nums ${s.tone}`}>{s.value}</p>
              </motion.div>
            ))}
          </section>

          {/* Filters */}
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="flex flex-col items-stretch gap-3 border-b border-border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4 xl:flex-nowrap">
              {/* Search */}
              <div className="flex min-w-0 items-center gap-2.5 flex-1 bg-background border border-input rounded-xl px-3.5 py-2">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by name, email, Lark ID or role..."
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

            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
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
                    <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
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
                          className="border-b border-border/50 hover:bg-muted/30 transition-colors group cursor-pointer"
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
                                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card" style={{ backgroundColor: st.color }} />
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

                          {/* Department */}
                          <td className="py-3.5 px-4">
                            <span className="text-sm text-foreground">{user.department}</span>
                          </td>

                          {/* Status */}
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ backgroundColor: st.bg, color: st.color }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                              {st.label}
                            </span>
                          </td>

                          {/* System role */}
                          <td className="py-3.5 px-4" onClick={(event) => event.stopPropagation()}>
                            {user.id === currentUser?.id ? (
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700"><ShieldCheck className="h-3.5 w-3.5" /> {user.roleCodes.includes("FOUNDER_GM") ? "Founder/GM" : "Tài khoản hiện tại"}</span>
                            ) : canManageRoles ? (
                              <select
                                value={user.roleCodes.includes("WORKSPACE_ADMIN") ? "WORKSPACE_ADMIN" : "WORKSPACE_USER"}
                                disabled={roleSavingId === user.id}
                                onChange={(event) => void changeWorkspaceRole(user, event.target.value as "WORKSPACE_ADMIN" | "WORKSPACE_USER")}
                                aria-label={`Workspace access for ${user.name}`}
                                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                              >
                                <option value="WORKSPACE_ADMIN">Workspace Admin</option>
                                <option value="WORKSPACE_USER">Workspace User</option>
                              </select>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600"><ShieldOff className="h-3.5 w-3.5" /> Workspace User</span>
                            )}
                            {roleSavingId === user.id && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-indigo-600" />}
                          </td>

                          {/* P&L permission */}
                          <td className="py-3.5 px-4" onClick={(event) => event.stopPropagation()}>
                            {canManageRoles && user.id !== currentUser?.id ? (
                              <select id={`pnl-permission-${user.id}`} value={user.costPermissionCodes.length === 4 ? "ALL" : user.costPermissionCodes[0] ?? "NONE"} disabled={costSavingId === user.id} onChange={(event) => void changeCostPermissions(user, event.target.value)} aria-label={`Quyền P&L của ${user.name}`} className="max-w-[170px] rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
                                  <option value="NONE">Chưa cấp</option>
                                  <option value="COST_VIEW">Xem</option>
                                  <option value="COST_EDIT">Sửa</option>
                                  <option value="COST_APPROVE">Duyệt</option>
                                  <option value="COST_EXPORT">Xuất</option>
                                  <option value="ALL">Toàn quyền</option>
                              </select>
                            ) : <span className="text-xs text-muted-foreground">{user.costPermissionGroup}</span>}
                            {costSavingId === user.id && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-indigo-600" />}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1">
                              <Link aria-label={`Open ${user.name}`} href={`/users/${user.id}`} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                                  <ArrowRight className="w-4 h-4" />
                              </Link>
                              <a aria-label={`Email ${user.name}`} href={`mailto:${user.email}`} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                                <Mail className="w-4 h-4" />
                              </a>
                            </div>
                          </td>
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
          </div>
        </main>

        <footer className="h-11 border-t border-border bg-card flex items-center justify-between px-5 shrink-0">
          <span className="text-[11px] text-muted-foreground">UpLark Partner CRM</span>
          <span className="text-[11px] text-muted-foreground">Legal pages are not published yet.</span>
        </footer>
    </AppShell>
  );
}
