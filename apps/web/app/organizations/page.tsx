"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Crown, Plus, ShieldAlert, Trash2, UserPlus, X } from "lucide-react";
import { BUSINESS_ROLE_CATALOGUE, SYSTEM_FOUNDER_ROLE_CODE } from "@b2b-crm/contracts";
import { AppShell } from "@/components/constructor-x/app-shell";
import { HeaderButton, PageHeader, pageMainClassName } from "@/components/page-header";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { TABLE_HEAD_CLASS } from "@/components/ui/kpi-tile";
import { useAuth } from "@/lib/auth";
import { hasAnyAuthRole } from "@/lib/auth-role";
import { SYSTEM_ROLE_OPTIONS } from "@/lib/people-roles";

type Organization = { id: string; name: string; status: string; current: boolean; memberCount: number; projectCount: number; clientCount: number };
type Founder = { id: string; displayName: string; email: string };
type Member = { id: string; email: string; displayName: string; status: string; larkUserId?: string; roleCodes: string[] };

const SYSTEM_CODES = SYSTEM_ROLE_OPTIONS.map((option) => option.value as string);
type BusinessRole = { code: string; label: string; hidden: boolean };
// Until the organization's own list (its Admin › Setting) has loaded.
const BUILT_IN_BUSINESS_ROLES: BusinessRole[] = BUSINESS_ROLE_CATALOGUE.map((entry) => ({ code: entry.code, label: entry.label, hidden: false }));
const inputClass = "h-10 w-full rounded-[10px] border border-border bg-background px-3 text-sm outline-none ring-primary/30 focus:ring-2";
const cardClass = "rounded-3xl border border-border bg-card shadow-sm";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Không thực hiện được. Thử lại.");
  return payload as T;
}

export default function OrganizationsPage() {
  const { user, isLoading } = useAuth();
  const allowed = hasAnyAuthRole(user, [SYSTEM_FOUNDER_ROLE_CODE]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [founders, setFounders] = useState<Founder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [businessRoles, setBusinessRoles] = useState<BusinessRole[]>(BUILT_IN_BUSINESS_ROLES);
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState("");
  const [invite, setInvite] = useState({ user: "", displayName: "", systemRole: "WORKSPACE_USER", businessRole: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Pinned over the table while scrolling, so a success note goes away by itself; an error stays until closed.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const selected = organizations.find((organization) => organization.id === selectedId);
  const businessCodes = businessRoles.map((role) => role.code);
  const businessOf = (member: Member) => member.roleCodes.find((code) => businessCodes.includes(code) && !BUILT_IN_BUSINESS_ROLES.some((role) => role.code === code))
    ?? member.roleCodes.find((code) => businessCodes.includes(code)) ?? "";
  const businessOptions = (current = "") => [{ value: "", label: "Không có" }, ...businessRoles.filter((role) => !role.hidden || role.code === current).map((role) => ({ value: role.code, label: role.label }))];

  const loadOrganizations = useCallback(async () => {
    const body = await call<{ data: Organization[]; systemFounders: Founder[] }>("/api/organizations");
    setOrganizations(body.data);
    setFounders(body.systemFounders);
    setSelectedId((current) => current || body.data.find((organization) => organization.current)?.id || body.data[0]?.id || "");
  }, []);
  const loadMembers = useCallback(async (id: string) => {
    const body = await call<{ data: Member[]; businessRoles: BusinessRole[] }>(`/api/organizations/${encodeURIComponent(id)}/members`);
    setMembers(body.data);
    setBusinessRoles(body.businessRoles);
  }, []);

  useEffect(() => { if (allowed) loadOrganizations().catch((reason: Error) => setError(reason.message)); }, [allowed, loadOrganizations]);
  useEffect(() => {
    setRename(selected?.name ?? "");
    if (selectedId) loadMembers(selectedId).catch((reason: Error) => setError(reason.message));
  }, [selectedId, selected?.name, loadMembers]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const message = await action();
      await loadOrganizations();
      if (selectedId) await loadMembers(selectedId);
      setNotice(typeof message === "string" ? message : done);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thực hiện được. Thử lại.");
    } finally {
      setBusy(false);
    }
  };
  const base = `/api/organizations/${encodeURIComponent(selectedId)}`;
  const createOrganization = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => { const created = await call<{ id: string }>("/api/organizations", "POST", { name: newName }); setNewName(""); setSelectedId(created.id); }, "Đã tạo tổ chức. Thêm thành viên để họ bắt đầu dùng.");
  };
  const addMember = (event: FormEvent) => {
    event.preventDefault();
    // The form's defaults (Workspace User, no business role) would quietly replace an existing member's roles.
    const ref = invite.user.trim().toLowerCase();
    const existing = members.find((member) => [member.id, member.email, member.larkUserId].some((value) => value?.toLowerCase() === ref));
    if (existing) {
      setNotice("");
      setError(`${existing.displayName} đã ở trong ${selected?.name}. Đổi quyền của họ ở bảng bên dưới.`);
      return;
    }
    const done = `Đã thêm ${invite.user.trim()} vào ${selected?.name}.`;
    void run(async () => {
      const added = await call<{ verifiedOnLark?: boolean }>(`${base}/members`, "PUT", invite);
      setInvite({ user: "", displayName: "", systemRole: "WORKSPACE_USER", businessRole: "" });
      if (added?.verifiedOnLark === false) return `${done} Lark chưa cho CRM xem hồ sơ của mã này nên hãy chắc mã đúng; tên thật sẽ hiện khi họ đăng nhập Lark lần đầu.`;
    }, done);
  };
  const setRole = (member: Member, change: { systemRole?: string; businessRole?: string }) =>
    void run(() => call(`${base}/members`, "PUT", { user: member.id, ...change }), `Đã đổi quyền của ${member.displayName}.`);
  const removeMember = (member: Member) => {
    if (!window.confirm(`Gỡ ${member.displayName} khỏi ${selected?.name}? Người này mất quyền vào tổ chức ngay.`)) return;
    void run(() => call(`${base}/members/${encodeURIComponent(member.id)}`, "DELETE"), `Đã gỡ ${member.displayName} khỏi ${selected?.name}.`);
  };

  if (isLoading) return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Đang kiểm tra quyền truy cập…</div>;

  return (
    <AppShell activeRoute="/organizations" title="Tổ chức">
      <main className={pageMainClassName}>
        <PageHeader title="Tổ chức" subtitle="Mỗi tổ chức có dữ liệu riêng: dự án, khách hàng và nhân sự của tổ chức này không hiện ở tổ chức khác." />
        {!allowed ? (
          <section className={`${cardClass} mx-auto mt-10 w-full max-w-lg p-8 text-center`}>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600"><ShieldAlert className="h-7 w-7" /></div>
            <p className="mt-5 text-base font-bold text-foreground">Chỉ System Founder</p>
            <p className="mt-2 text-sm text-muted-foreground">Tạo tổ chức và phân quyền giữa các tổ chức dành cho System Founder.</p>
          </section>
        ) : (
          <>
            {/* Sticky: a change made far down the members table must still show its result or error. */}
            {error ? <div role="alert" className="sticky top-3 z-30 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{error}</span><button type="button" aria-label="Đóng thông báo lỗi" onClick={() => setError("")} className="-m-1 rounded-md p-1 hover:bg-rose-100"><X className="h-4 w-4" /></button></div> : null}
            {notice ? <div role="status" className="sticky top-3 z-30 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm"><Check className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div> : null}
            <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="space-y-4">
                <section className={`${cardClass} p-4`}>
                  <form onSubmit={createOrganization} className="flex gap-2">
                    <input aria-label="Tên tổ chức mới" placeholder="Tên tổ chức mới" value={newName} onChange={(event) => setNewName(event.target.value)} className={inputClass} />
                    <HeaderButton type="submit" variant="primary" disabled={busy || !newName.trim()} icon={<Plus className="h-4 w-4" />}>Tạo</HeaderButton>
                  </form>
                  <ul className="mt-4 space-y-2">
                    {organizations.map((organization) => (
                      <li key={organization.id}>
                        <button type="button" onClick={() => { setSelectedId(organization.id); setNotice(""); setError(""); }} aria-current={organization.id === selectedId}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition ${organization.id === selectedId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"}`}>
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-foreground">{organization.name}</span>
                            {organization.status !== "active" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Ngừng</span>
                              : organization.current ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Đang làm việc</span> : null}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">{organization.memberCount} thành viên · {organization.projectCount} dự án · {organization.clientCount} khách hàng</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className={`${cardClass} p-4`}>
                  <h2 className="flex items-center gap-2 !text-sm !font-bold text-foreground"><Crown className="h-4 w-4 text-amber-500" />System Founder</h2>
                  <ul className="mt-3 space-y-2">
                    {founders.map((founder) => <li key={founder.id} className="text-sm"><span className="font-semibold text-foreground">{founder.displayName}</span><span className="block text-xs text-muted-foreground">{founder.email}</span></li>)}
                  </ul>
                </section>
              </aside>

              {selected ? (
                <section className={`${cardClass} min-w-0`}>
                  <div className="flex flex-wrap items-end gap-2 border-b border-border p-4 sm:p-5">
                    <label className="min-w-[200px] flex-1 text-xs font-semibold text-muted-foreground">Tên tổ chức
                      <input value={rename} onChange={(event) => setRename(event.target.value)} className={`${inputClass} mt-1`} />
                    </label>
                    <HeaderButton disabled={busy || !rename.trim() || rename.trim() === selected.name} onClick={() => void run(() => call(base, "PATCH", { name: rename }), "Đã đổi tên tổ chức.")}>Lưu tên</HeaderButton>
                    <HeaderButton disabled={busy || (selected.current && selected.status === "active")} title={selected.current ? "Không ngừng được tổ chức bạn đang làm việc" : undefined}
                      onClick={() => {
                        const stopping = selected.status === "active";
                        if (stopping && !window.confirm(`Ngừng ${selected.name}? Thành viên sẽ không vào được tổ chức này cho đến khi mở lại.`)) return;
                        void run(() => call(base, "PATCH", { status: stopping ? "inactive" : "active" }), stopping ? "Đã ngừng tổ chức." : "Đã mở lại tổ chức.");
                      }}>{selected.status === "active" ? "Ngừng hoạt động" : "Mở lại"}</HeaderButton>
                  </div>

                  <form onSubmit={addMember} className="grid gap-2 border-b border-border p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_180px_160px_auto] xl:items-end">
                    <label className="text-xs font-semibold text-muted-foreground">User ID
                      <input required placeholder="VD: HN454" value={invite.user} onChange={(event) => setInvite({ ...invite, user: event.target.value })} className={`${inputClass} mt-1`} />
                    </label>
                    <label className="text-xs font-semibold text-muted-foreground">Tên (không bắt buộc)
                      <input value={invite.displayName} onChange={(event) => setInvite({ ...invite, displayName: event.target.value })} className={`${inputClass} mt-1`} />
                    </label>
                    <div className="text-xs font-semibold text-muted-foreground">Quyền hệ thống
                      <CrmSelect className="mt-1" ariaLabel="Quyền hệ thống" value={invite.systemRole} options={SYSTEM_ROLE_OPTIONS} onChange={(systemRole) => setInvite({ ...invite, systemRole })} />
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground">Vai trò nghiệp vụ
                      <CrmSelect className="mt-1" ariaLabel="Vai trò nghiệp vụ" value={invite.businessRole} options={businessOptions()} onChange={(businessRole) => setInvite({ ...invite, businessRole })} />
                    </div>
                    <HeaderButton type="submit" variant="primary" disabled={busy || !invite.user.trim()} icon={<UserPlus className="h-4 w-4" />}>Thêm</HeaderButton>
                  </form>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className={`bg-slate-50 ${TABLE_HEAD_CLASS}`}><tr><th className="px-5 py-3">Thành viên</th><th className="px-4 py-3">Quyền hệ thống</th><th className="px-4 py-3">Vai trò nghiệp vụ</th><th className="px-4 py-3">Quyền khác</th><th className="sticky right-0 bg-slate-50 px-4 py-3" /></tr></thead>
                      <tbody className="divide-y divide-border">
                        {members.map((member) => {
                          const other = member.roleCodes.filter((code) => !SYSTEM_CODES.includes(code) && !businessCodes.includes(code));
                          return (
                            <tr key={member.id} className="align-middle">
                              <td className="px-5 py-3"><span className="font-semibold text-foreground">{member.displayName}</span><span className="block text-xs text-muted-foreground">{member.larkUserId ? `ID ${member.larkUserId} · ` : ""}{member.email}</span></td>
                              <td className="w-[190px] px-4 py-3"><CrmSelect menuPortal ariaLabel={`Quyền hệ thống của ${member.displayName}`} placeholder="Chưa gán" disabled={busy}
                                value={member.roleCodes.find((code) => SYSTEM_CODES.includes(code)) ?? ""} options={SYSTEM_ROLE_OPTIONS} onChange={(systemRole) => setRole(member, { systemRole })} /></td>
                              <td className="w-[170px] px-4 py-3"><CrmSelect menuPortal ariaLabel={`Vai trò nghiệp vụ của ${member.displayName}`} disabled={busy}
                                value={businessOf(member)} options={businessOptions(businessOf(member))} onChange={(businessRole) => setRole(member, { businessRole })} /></td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">{other.join(", ") || "—"}</td>
                              {/* Pinned to the right edge: on a narrow window the table scrolls sideways and the button would go out of sight. */}
                              <td className="sticky right-0 bg-card px-4 py-3 text-right">
                                <button type="button" disabled={busy} onClick={() => removeMember(member)} aria-label={`Gỡ ${member.displayName} khỏi tổ chức`} title="Gỡ khỏi tổ chức"
                                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-semibold text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"><Trash2 className="h-4 w-4" />Gỡ</button>
                              </td>
                            </tr>
                          );
                        })}
                        {!members.length ? <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">Chưa có thành viên. Thêm bằng user ID ở trên.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">User ID là mã Lark (VD HN454). Người team khác chưa có trong CRM cũng thêm bằng user ID: họ đăng nhập Lark là vào thẳng tổ chức, CRM nhận họ theo mã này. Không nên thêm bằng email, vì Lark thường không cho CRM biết email của team khác nên họ sẽ không đăng nhập được. Ai thuộc nhiều tổ chức thì đổi tổ chức ở Settings › Your workspaces.</p>
                </section>
              ) : null}
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}
