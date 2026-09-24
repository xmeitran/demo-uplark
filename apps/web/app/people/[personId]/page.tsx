"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Check, CircleDollarSign, Clock3, History, Save, UserRound } from "lucide-react";
import type { AdminAccessMemberSummary } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { useAuth } from "@/lib/auth";
import { PEOPLE_PROFILES, type PeopleProfile, formatHours, formatVnd, statusClass } from "@/features/people/people-data";

type LiveTimeEntry = { userId?: string; minutes?: number };

function initialsForName(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

function colorForId(id: string) {
  const palette = ["#2563eb", "#7c3aed", "#059669", "#db2777", "#d97706", "#0891b2"];
  return palette[Math.abs(Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0)) % palette.length];
}

function roleLabel(member: AdminAccessMemberSummary) {
  if (member.resourceDisplayRole) return member.resourceDisplayRole;
  if (member.roleCodes.includes("FOUNDER_GM")) return "Founder / GM";
  if (member.roleCodes.includes("WORKSPACE_ADMIN")) return "Workspace Admin";
  if (member.roleCodes.includes("WORKSPACE_USER")) return "Workspace User";
  return member.roleCodes[0]?.replaceAll("_", " ") || "Workspace User";
}

function mapLiveProfile(member: AdminAccessMemberSummary, minutesByUser: Map<string, number>): PeopleProfile {
  const name = member.displayName || member.email || member.id;
  return {
    id: member.id,
    name,
    initials: initialsForName(name),
    color: colorForId(member.id),
    role: roleLabel(member),
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
    actualHours: (minutesByUser.get(member.id) ?? 0) / 60,
    pnlHours: 0,
    rateHistory: []
  };
}

function Avatar({ person }: { person: PeopleProfile }) {
  return <span style={{ backgroundColor: person.color }} className="inline-flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-bold text-white">{person.initials}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}

const fieldClass = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

export default function PeopleProfilePage() {
  const { user } = useAuth();
  const canViewFinancials = Boolean(user?.roleCodes?.some((role) => ["FOUNDER_GM", "WORKSPACE_ADMIN", "FINANCE_ADMIN", "DX_DIRECTOR", "PM", "BD_LEAD"].includes(role)));
  const params = useParams<{ personId: string }>();
  const personId = Array.isArray(params.personId) ? params.personId[0] : params.personId;
  const source = PEOPLE_PROFILES.find((person) => person.id === personId);
  const [profile, setProfile] = useState<PeopleProfile | null>(source ?? null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    const now = new Date();
    const startAt = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    setProfile(source ?? null);
    setSaved(false);
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetch("/api/admin/users?includeSuspended=true", { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải dữ liệu nhân sự.");
        return response.json() as Promise<{ data?: AdminAccessMemberSummary[] }>;
      }),
      fetch(`/api/tasks/time-entries?limit=500&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`, { credentials: "same-origin", cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<{ data?: LiveTimeEntry[] }> : { data: [] })
    ])
      .then(([membersPayload, entriesPayload]) => {
        if (!active) return;
        const member = (membersPayload.data ?? []).find((item) => item.id === personId || item.larkOpenId === personId);
        if (!member) throw new Error("Không tìm thấy user trong workspace.");
        const minutesByUser = new Map<string, number>();
        for (const entry of entriesPayload.data ?? []) if (entry.userId) minutesByUser.set(entry.userId, (minutesByUser.get(entry.userId) ?? 0) + (entry.minutes ?? 0));
        setProfile(mapLiveProfile(member, minutesByUser));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Không thể tải hồ sơ nhân sự.");
        if (!source) setProfile(null);
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [personId, source]);

  if (loading && !profile) {
    return <AppShell activeRoute="/people" title="Hồ sơ nhân sự"><main className="flex min-h-0 flex-1 items-center justify-center bg-[#f7f9fd] p-6"><div className="rounded-2xl border border-border bg-card px-8 py-7 text-center shadow-sm"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" /><p className="mt-3 text-sm text-muted-foreground">Đang tải hồ sơ nhân sự…</p></div></main></AppShell>;
  }

  if (!profile) {
    return <AppShell activeRoute="/people" title="Hồ sơ nhân sự"><main className="flex min-h-0 flex-1 items-center justify-center bg-[#f7f9fd] p-6"><div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm"><h1 className="text-xl font-semibold">Không tìm thấy hồ sơ nhân sự</h1><p className="mt-2 text-sm text-muted-foreground">{loadError ?? "User này không còn thuộc workspace hiện tại."}</p><Link href="/people" className="mt-4 inline-flex text-sm font-semibold text-blue-600 hover:underline">Quay lại danh sách nhân sự</Link></div></main></AppShell>;
  }

  const update = <K extends keyof PeopleProfile>(key: K, value: PeopleProfile[K]) => setProfile((current) => current ? { ...current, [key]: value } : current);
  const save = () => { setSaved(true); window.setTimeout(() => setSaved(false), 2800); };

  return (
    <AppShell activeRoute="/people" title="Hồ sơ nhân sự">
      <main data-testid="people-profile-detail" className="min-h-0 flex-1 overflow-y-auto bg-[#f7f9fd] p-4 sm:p-6">
        <div className="mx-auto max-w-[1280px] space-y-5">
          {loadError && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Đang hiển thị dữ liệu hồ sơ đã lưu cục bộ. {loadError}</div>}
          <div className="rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 via-blue-50 to-violet-50 px-4 py-3 text-xs text-slate-600"><strong className="font-semibold text-slate-700">Hồ sơ nhân sự / Chi tiết thông tin</strong> · Thông tin nhân sự, Rate Category, Cost Rate, OT và ngày hiệu lực</div>
          <Link href="/people" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-blue-600"><ArrowLeft className="h-4 w-4" /> Quay lại danh sách nhân sự</Link>

          <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4"><Avatar person={profile} /><div><p className="text-xs font-semibold tracking-[0.15em] text-blue-600">HỒ SƠ NHÂN SỰ</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{profile.name}</h1><p className="mt-1 text-sm text-muted-foreground">{profile.role} · {profile.department} · Level {profile.level}</p><div className="mt-2 flex flex-wrap gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(profile.status)}`}>{profile.status}</span><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{profile.userId}</span></div></div></div>
            <button type="button" onClick={save} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors ${saved ? "bg-emerald-600" : "bg-blue-600 hover:bg-blue-700"}`}><Save className="h-4 w-4" />{saved ? "Đã lưu trong phiên" : "Lưu thay đổi"}</button>
          </header>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="mb-5"><h2 className="font-semibold text-slate-900">Thông tin định danh &amp; tổ chức</h2><p className="mt-1 text-sm text-muted-foreground">Định danh nguồn và cấu hình tổ chức cho nhân sự.</p></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Họ và tên"><input value={profile.name} onChange={(event) => update("name", event.target.value)} className={fieldClass} /></Field><Field label="User ID"><input value={profile.userId} onChange={(event) => update("userId", event.target.value)} className={fieldClass} /></Field><Field label="Vai trò"><input value={profile.role} onChange={(event) => update("role", event.target.value)} className={fieldClass} /></Field><Field label="Phòng ban"><input value={profile.department} onChange={(event) => update("department", event.target.value)} className={fieldClass} /></Field><Field label="Level"><select value={profile.level} onChange={(event) => update("level", event.target.value as PeopleProfile["level"])} className={fieldClass}>{["L1", "L2", "L3", "L4", "L5"].map((level) => <option key={level}>{level}</option>)}</select></Field><Field label="Loại nhân sự"><select value={profile.employmentType} onChange={(event) => update("employmentType", event.target.value as PeopleProfile["employmentType"])} className={fieldClass}>{["Full-time", "Part-time", "Freelance", "Intern"].map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Quản lý trực tiếp"><input value={profile.manager} onChange={(event) => update("manager", event.target.value)} className={fieldClass} /></Field><Field label="Trạng thái"><select value={profile.status} onChange={(event) => update("status", event.target.value as PeopleProfile["status"])} className={fieldClass}>{["Active", "On leave", "On Hold", "Inactive"].map((item) => <option key={item}>{item}</option>)}</select></Field></div></section>
              {canViewFinancials && <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="mb-5"><h2 className="font-semibold text-slate-900">Cấu hình chi phí &amp; giờ làm</h2><p className="mt-1 text-sm text-muted-foreground">Dữ liệu làm nguồn cho Timesheet và báo cáo P&amp;L.</p></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Rate Category"><input value={profile.rateCategory} onChange={(event) => update("rateCategory", event.target.value)} className={fieldClass} /></Field><Field label="Cost Rate (₫ / giờ)"><input type="number" min="0" value={profile.hourlyCostRate} onChange={(event) => update("hourlyCostRate", Number(event.target.value) || 0)} className={fieldClass} /></Field><Field label="Giờ OT trong kỳ"><input type="number" min="0" value={profile.overtimeHours} onChange={(event) => update("overtimeHours", Number(event.target.value) || 0)} className={fieldClass} /></Field><Field label="Ngày hiệu lực"><div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={profile.effectiveFrom} onChange={(event) => update("effectiveFrom", event.target.value)} className={`${fieldClass} pl-9`} /></div></Field></div><div className="mt-5 flex gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><p>Giờ chuẩn được tính theo 8 giờ/ngày. Giờ OT được theo dõi riêng để đối chiếu nhân sự và chi phí.</p></div></section>}
            </div>

            <aside className="space-y-5 lg:sticky lg:top-4 lg:h-fit"><section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><h2 className="font-semibold text-slate-900">Tóm tắt kỳ hiện tại</h2><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Plan</p><p className="mt-1 text-lg font-semibold">{formatHours(profile.planHours)}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Actual</p><p className="mt-1 text-lg font-semibold">{formatHours(profile.actualHours)}</p></div>{canViewFinancials && <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">P&amp;L Hour</p><p className="mt-1 text-lg font-semibold">{formatHours(profile.pnlHours)}</p></div>}<div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-700">OT</p><p className="mt-1 text-lg font-semibold text-amber-900">{formatHours(profile.overtimeHours)}</p></div></div>{canViewFinancials && <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3"><div className="flex items-center gap-2 text-blue-700"><CircleDollarSign className="h-4 w-4" /><p className="text-xs font-semibold">Cost Rate hiện tại</p></div><p className="mt-1 text-xl font-semibold text-slate-900">{formatVnd(profile.hourlyCostRate)} <span className="text-sm font-normal text-slate-500">/ giờ</span></p><p className="mt-1 text-xs text-muted-foreground">Hiệu lực từ {profile.effectiveFrom}</p></div>}</section>{canViewFinancials && <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><History className="h-4 w-4 text-blue-600" /><h2 className="font-semibold text-slate-900">Lịch sử Cost Rate</h2></div><div className="mt-5 space-y-0">{profile.rateHistory.map((item, index) => <div key={`${item.effectiveFrom}-${item.hourlyCostRate}`} className="relative flex gap-3 pb-5 last:pb-0"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.active ? "bg-emerald-500 ring-4 ring-emerald-50" : "bg-slate-300"}`} />{index < profile.rateHistory.length - 1 && <span className="absolute left-[4px] top-5 h-[calc(100%-16px)] w-px bg-slate-200" />}<div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="font-semibold text-slate-800">{formatVnd(item.hourlyCostRate)} / giờ</p>{item.active && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"><Check className="h-3 w-3" /> Đang áp dụng</span>}</div><p className="mt-0.5 text-xs text-muted-foreground">Hiệu lực từ {item.effectiveFrom}</p></div></div>)}</div></section>}</aside>
          </div>
          <p className="text-center text-xs text-muted-foreground">Định danh, quyền workspace và Actual Hour được tải từ dữ liệu workspace hiện tại. Các trường chỉnh sửa hồ sơ đang được giữ trong phiên làm việc này.</p>
        </div>
      </main>
    </AppShell>
  );
}
