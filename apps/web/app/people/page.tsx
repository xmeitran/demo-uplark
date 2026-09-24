"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  Search,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  ShieldCheck,
  ShieldOff,
  Loader2,
} from "lucide-react";
import type { AdminAccessMemberSummary } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { useAuth } from "@/lib/auth";
import { downloadCsv } from "@/lib/csv-export";
import {
  type PeopleProfile,
  formatHours,
  formatVnd,
  statusClass,
} from "@/features/people/people-data";

type LiveTimeEntry = { userId?: string; minutes?: number };

function initialsForName(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function colorForId(id: string) {
  const palette = ["#2563eb", "#7c3aed", "#059669", "#db2777", "#d97706", "#0891b2"];
  return palette[Math.abs(Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0)) % palette.length];
}

function mapLiveProfile(member: AdminAccessMemberSummary, minutesByUser: Map<string, number>): PeopleProfile {
  const name = member.displayName || member.email || member.id;
  const role = member.resourceDisplayRole || (member.roleCodes.includes("FOUNDER_GM") ? "Founder / GM" : member.roleCodes.includes("WORKSPACE_ADMIN") ? "Workspace Admin" : "Workspace User");
  const actualHours = (minutesByUser.get(member.id) ?? 0) / 60;
  return {
    id: member.id,
    name,
    initials: initialsForName(name),
    color: colorForId(member.id),
    role,
    department: member.departmentCode || "Chưa phân loại",
    level: "L3",
    employmentType: "Full-time",
    manager: "—",
    status: member.status === "active" ? "Active" : "Inactive",
    userId: member.larkOpenId || member.id,
    rateCategory: member.hasResourceProfile ? "Resource profile" : "Chưa cấu hình",
    hourlyCostRate: 0,
    effectiveFrom: "Chưa cấu hình",
    overtimeHours: 0,
    planHours: 0,
    actualHours,
    pnlHours: 0,
    rateHistory: []
  };
}

function Avatar({ initials, color, small = false }: { initials: string; color: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${small ? "h-8 w-8 text-[10px]" : "h-11 w-11 text-sm"}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, note, tone = "blue" }: {
  icon: typeof UsersRound;
  label: string;
  value: string;
  note: string;
  tone?: "blue" | "emerald" | "violet" | "amber";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-4.5 w-4.5" /></span>
      <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
    </section>
  );
}

export default function PeoplePage() {
  const { user } = useAuth();
  const canViewFinancials = Boolean(user?.roleCodes?.some((role) => ["FOUNDER_GM", "WORKSPACE_ADMIN", "FINANCE_ADMIN", "DX_DIRECTOR", "PM", "BD_LEAD"].includes(role)));
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [adminMembers, setAdminMembers] = useState<AdminAccessMemberSummary[]>([]);
  const [profiles, setProfiles] = useState<PeopleProfile[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);
  const [roleMessage, setRoleMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const now = new Date();
    const startAt = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    Promise.all([
      fetch("/api/admin/users?includeSuspended=true", { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "Bạn không có quyền quản trị user trong workspace này." : "Không thể tải danh sách user.");
        return response.json() as Promise<{ data: AdminAccessMemberSummary[] }>;
      }),
      fetch(`/api/tasks/time-entries?limit=500&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`, { credentials: "same-origin", cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<{ data?: LiveTimeEntry[] }> : { data: [] })
    ])
      .then(([payload, entriesPayload]) => {
        if (!active) return;
        const members = payload.data ?? [];
        const minutesByUser = new Map<string, number>();
        for (const entry of entriesPayload.data ?? []) if (entry.userId) minutesByUser.set(entry.userId, (minutesByUser.get(entry.userId) ?? 0) + (entry.minutes ?? 0));
        setAdminMembers(members);
        setProfiles(members.map((member) => mapLiveProfile(member, minutesByUser)));
        setSelectedId((current) => current || members[0]?.id || "");
      })
      .catch((error: unknown) => { if (active) setRoleMessage(error instanceof Error ? error.message : "Không thể tải phân quyền."); })
      .finally(() => { if (active) setDirectoryLoading(false); });
    return () => { active = false; };
  }, []);

  async function changeWorkspaceRole(member: AdminAccessMemberSummary, roleCode: "WORKSPACE_ADMIN" | "WORKSPACE_USER") {
    setRoleSavingId(member.id);
    setRoleMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(member.id)}/role`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleCode })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? "Không thể cập nhật role.");
      setAdminMembers((current) => current.map((item) => item.id === member.id ? { ...item, roleCodes: [roleCode] } : item));
      setRoleMessage(`Đã cập nhật ${member.displayName} thành ${roleCode === "WORKSPACE_ADMIN" ? "Workspace Admin" : "Workspace User"}.`);
    } catch (error) {
      setRoleMessage(error instanceof Error ? error.message : "Không thể cập nhật role.");
    } finally {
      setRoleSavingId(null);
    }
  }

  const departments = useMemo(() => [...new Set(profiles.map((person) => person.department))], [profiles]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return profiles.filter((person) => {
      const searchable = [person.name, person.userId, person.role, person.department].join(" ").toLocaleLowerCase("vi");
      return (!normalized || searchable.includes(normalized))
        && (department === "all" || person.department === department)
        && (status === "all" || person.status === status);
    });
  }, [department, profiles, query, status]);

  const selected = filtered.find((person) => person.id === selectedId) ?? filtered[0];
  const activeCount = profiles.filter((person) => person.status === "Active").length;
  const mappedCount = profiles.filter((person) => Boolean(person.userId)).length;
  const rateCount = profiles.filter((person) => person.hourlyCostRate > 0).length;
  const hoursThisMonth = profiles.reduce((total, person) => total + person.actualHours, 0);

  return (
    <AppShell activeRoute="/people" title="Hồ sơ nhân sự">
      <main data-testid="people-directory" className="min-h-0 flex-1 overflow-y-auto bg-background p-4 sm:p-6">
        <div className="mx-auto max-w-[1600px] space-y-5">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-primary">PEOPLE · COST CONTROL</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Hồ sơ nhân sự</h1>
              <p className="mt-1 text-xs text-muted-foreground">Nguồn chuẩn cho User ID, Cost Rate, Timesheet và P&amp;L.</p>
            </div>
          </header>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={UsersRound} label="Tổng nhân sự" value={directoryLoading ? "—" : String(profiles.length)} note={directoryLoading ? "Đang đồng bộ" : `${activeCount} Active`} />
            {canViewFinancials && <KpiCard icon={CheckCircle2} label="Cost Rate hợp lệ" value={directoryLoading ? "—" : `${rateCount} / ${profiles.length}`} note={directoryLoading ? "Đang kiểm tra" : `${profiles.length - rateCount} cần cấu hình`} tone="emerald" />}
            <KpiCard icon={UserRound} label="User ID đã map" value={directoryLoading ? "—" : `${mappedCount} / ${profiles.length}`} note="Theo directory Lark" tone="violet" />
            <KpiCard icon={Clock3} label="Time log tháng này" value={formatHours(hoursThisMonth)} note="Từ Timesheet" tone="amber" />
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm xl:flex-row xl:items-center">
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên, User ID, vai trò..." className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Lọc theo phòng ban" className="h-10 min-w-[175px] rounded-xl border border-border bg-background px-3 text-sm text-slate-700 outline-none focus:border-blue-400">
                <option value="all">Tất cả phòng ban</option>
                {departments.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Lọc theo trạng thái" className="h-10 min-w-[145px] rounded-xl border border-border bg-background px-3 text-sm text-slate-700 outline-none focus:border-blue-400">
                <option value="all">Tất cả trạng thái</option>
                <option value="Active">Active</option>
                <option value="On leave">On leave</option>
                <option value="On Hold">On Hold</option>
                <option value="Inactive">Inactive</option>
              </select>
              <button type="button" onClick={() => downloadCsv("uplark-ho-so-nhan-su.csv", canViewFinancials ? ["Họ tên", "User ID", "Vai trò", "Phòng ban", "Level", "Trạng thái", "Cost rate", "Hiệu lực", "Time log"] : ["Họ tên", "User ID", "Vai trò", "Phòng ban", "Level", "Trạng thái", "Time log"], filtered.map((person) => canViewFinancials ? [person.name, person.userId, person.role, person.department, person.level, person.status, person.hourlyCostRate, person.effectiveFrom, person.actualHours] : [person.name, person.userId, person.role, person.department, person.level, person.status, person.actualHours]))} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
                <Download className="h-4 w-4" /> Xuất Excel
              </button>
            </div>
          </section>

          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-sm text-blue-800">
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span>Đang hiển thị <strong>{filtered.length} / {profiles.length}</strong> hồ sơ</span>
            <span className="hidden text-blue-500 sm:inline">· Đồng bộ từ workspace directory</span>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div><h2 className="font-semibold text-foreground">Danh sách nhân sự</h2><p className="mt-0.5 text-xs text-muted-foreground">Chọn một hồ sơ để xem nhanh cấu hình chi phí.</p></div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{filtered.length} hồ sơ</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Nhân sự / User ID</th><th className="px-3 py-3">Vai trò · Phòng ban</th><th className="px-3 py-3">Level</th><th className="px-3 py-3">Trạng thái</th>{canViewFinancials && <><th className="px-3 py-3">Cost Rate</th><th className="px-3 py-3">Hiệu lực</th></>}<th className="px-5 py-3 text-right">Logwork</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((person) => (
                      <tr key={person.id} onClick={() => setSelectedId(person.id)} className={`cursor-pointer transition-colors hover:bg-blue-50/50 ${selected?.id === person.id ? "bg-blue-50/70" : "bg-card"}`}>
                        <td className="px-5 py-3.5"><div className="flex items-center gap-3"><Avatar initials={person.initials} color={person.color} small /><div><Link onClick={(event) => event.stopPropagation()} href={`/people/${person.id}`} className="font-semibold text-slate-900 hover:text-blue-600">{person.name}</Link><p className="mt-0.5 text-xs text-muted-foreground">{person.userId}</p></div></div></td>
                        <td className="px-3 py-3.5"><p className="font-medium text-slate-800">{person.role}</p><p className="mt-0.5 text-xs text-muted-foreground">{person.department}</p></td>
                        <td className="px-3 py-3.5"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{person.level}</span></td>
                        <td className="px-3 py-3.5"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(person.status)}`}>{person.status}</span></td>
                        {canViewFinancials && <><td className="px-3 py-3.5 font-semibold text-slate-800">{person.hourlyCostRate > 0 ? formatVnd(person.hourlyCostRate) : <span className="font-medium text-amber-700">Chưa cấu hình</span>}<span className="block pt-0.5 text-[11px] font-normal text-muted-foreground">{person.hourlyCostRate > 0 ? "/ giờ" : "Cost Rate"}</span></td><td className="px-3 py-3.5 text-slate-600">{person.effectiveFrom}</td></>}
                        <td className="px-5 py-3.5 text-right font-medium text-slate-800">{formatHours(person.actualHours)}</td>
                      </tr>
                    ))}
                    {!filtered.length && <tr><td colSpan={canViewFinancials ? 7 : 5} className="px-5 py-12 text-center text-sm text-muted-foreground">Không tìm thấy hồ sơ phù hợp.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {selected && <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-sm xl:sticky xl:top-4">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-blue-600">HỒ SƠ ĐANG CHỌN</p>
              <div className="mt-4 flex items-center gap-3"><Avatar initials={selected.initials} color={selected.color} /><div><h2 className="font-semibold text-slate-900">{selected.name}</h2><p className="mt-0.5 text-sm text-muted-foreground">{selected.role} · {selected.department}</p></div></div>
              <div className="mt-4 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(selected.status)}`}>{selected.status}</span><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{selected.userId}</span><span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{selected.level}</span></div>
              {canViewFinancials && <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50/70 p-4"><p className="text-xs font-medium text-amber-700">Cost Rate hiện tại</p><p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{selected.hourlyCostRate > 0 ? `${formatVnd(selected.hourlyCostRate)} / giờ` : "Chưa cấu hình"}</p><p className="mt-2 text-xs text-slate-600">{selected.hourlyCostRate > 0 ? `Hiệu lực từ ${selected.effectiveFrom}` : "Không hiển thị chi phí giả định khi chưa có cấu hình"} · {selected.rateCategory}</p></div>}
              <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-2"><p className="text-xs text-muted-foreground">Plan</p><p className="mt-1 text-sm font-semibold">{formatHours(selected.planHours)}</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-xs text-muted-foreground">Actual</p><p className="mt-1 text-sm font-semibold">{formatHours(selected.actualHours)}</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-xs text-muted-foreground">P&amp;L</p><p className="mt-1 text-sm font-semibold">{formatHours(selected.pnlHours)}</p></div></div>
              {canViewFinancials && <div className="mt-5 border-t border-border pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lịch sử Cost Rate</p><div className="mt-3 space-y-3">{selected.rateHistory.length ? selected.rateHistory.slice(0, 2).map((item) => <div key={`${item.effectiveFrom}-${item.hourlyCostRate}`} className="flex items-center justify-between text-sm"><div><p className="font-medium text-slate-800">{formatVnd(item.hourlyCostRate)} / giờ</p><p className="text-xs text-muted-foreground">Từ {item.effectiveFrom}</p></div><span className={`h-2.5 w-2.5 rounded-full ${item.active ? "bg-emerald-500" : "bg-slate-300"}`} /></div>) : <p className="text-sm text-muted-foreground">Chưa có lịch sử Cost Rate.</p>}</div></div>}
              <Link href={`/people/${selected.id}`} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 px-3 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50">Xem hồ sơ chi tiết <ArrowRight className="h-4 w-4" /></Link>
            </aside>}
          </div>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h2 className="text-sm font-bold text-foreground">Phân quyền workspace</h2></div>
                <p className="mt-1 text-xs text-muted-foreground">Chọn theo Lark User ID. User thường không xem được cost rate, P&amp;L và cảnh báo tài chính.</p>
              </div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">Admin/User policy</span>
            </div>
            {roleMessage && <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{roleMessage}</p>}
            {directoryLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải danh sách Lark users…</div>
            ) : adminMembers.length ? (
              <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">User / Lark User ID</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Quyền workspace</th><th className="px-4 py-3 text-right">Hiệu lực</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {adminMembers.map((member) => {
                      const isFounder = member.roleCodes.includes("FOUNDER_GM");
                      const isAdmin = isFounder || member.roleCodes.includes("WORKSPACE_ADMIN");
                      return <tr key={member.id}>
                        <td className="px-4 py-3"><p className="font-semibold text-slate-900">{member.displayName}</p><p className="mt-0.5 font-mono text-xs text-muted-foreground">{member.larkOpenId ?? "Chưa map Lark ID"}</p></td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${member.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{member.status === "active" ? "Active" : "Suspended"}</span></td>
                        <td className="px-4 py-3">{isFounder ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700"><ShieldCheck className="h-3.5 w-3.5" /> Founder/GM</span> : <select value={isAdmin ? "WORKSPACE_ADMIN" : "WORKSPACE_USER"} disabled={roleSavingId === member.id} onChange={(event) => void changeWorkspaceRole(member, event.target.value as "WORKSPACE_ADMIN" | "WORKSPACE_USER")} className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-indigo-400"><option value="WORKSPACE_ADMIN">Workspace Admin</option><option value="WORKSPACE_USER">Workspace User</option></select>}</td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">{isFounder ? "Không thể hạ quyền" : isAdmin ? <span className="inline-flex items-center gap-1 text-indigo-700"><ShieldCheck className="h-3.5 w-3.5" /> Được xem cost/P&amp;L</span> : <span className="inline-flex items-center gap-1 text-slate-500"><ShieldOff className="h-3.5 w-3.5" /> Ẩn cost/P&amp;L</span>}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="mt-4 rounded-xl border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted-foreground">Chưa tải được workspace directory. Hãy đăng nhập bằng Founder/GM hoặc Workspace Admin để quản lý role.</div>}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
