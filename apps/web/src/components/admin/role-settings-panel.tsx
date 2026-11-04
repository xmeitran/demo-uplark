"use client";

import { useState, type FormEvent } from "react";
import { Check, CircleAlert, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import type { WorkspaceBusinessRoleOption } from "@b2b-crm/contracts";
import { CrmSelect } from "@/components/crm-workspace/crm-select";
import { TABLE_HEAD_CLASS } from "@/components/ui/kpi-tile";
import { useWorkspaceRoles } from "@/lib/business-roles";

const cardClass = "overflow-hidden rounded-3xl border border-border bg-card shadow-sm";
const inputClass = "h-9 w-full rounded-[10px] border border-border bg-white px-2.5 text-sm outline-none ring-primary/30 focus:ring-2";
const iconButton = "inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40";
const pill = (admin: boolean) => `inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${admin ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"}`;

async function send(path: string, method: string, body?: unknown) {
  const response = await fetch(path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Không lưu được. Thử lại.");
}

/** Admin › Setting: the roles this organization uses. Business roles can be renamed, hidden or added; system roles are fixed levels. */
export function RoleSettingsPanel() {
  const { roles, reload } = useWorkspaceRoles();
  const [editing, setEditing] = useState<{ code: string; label: string } | null>(null);
  const [draft, setDraft] = useState({ label: "", baseRoleCode: "DX" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const businessRoles = roles?.businessRoles ?? [];
  const labelOf = (code: string) => businessRoles.find((role) => role.code === code)?.label ?? code;
  const baseOptions = businessRoles.filter((role) => role.builtIn).map((role) => ({ value: role.code, label: `${role.accountType === "ADMIN" ? "Admin" : "User"} - ${role.label}` }));

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await action();
      await reload();
      setNotice(done);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được. Thử lại.");
    } finally {
      setBusy(false);
    }
  };
  const path = (code: string) => `/api/admin/business-roles/${encodeURIComponent(code)}`;
  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => { await send("/api/admin/business-roles", "POST", draft); setDraft({ ...draft, label: "" }); }, `Đã thêm vai trò "${draft.label.trim()}".`);
  };
  const saveName = () => editing && void run(async () => { await send(path(editing.code), "PATCH", { label: editing.label }); setEditing(null); }, "Đã đổi tên vai trò.");
  const toggleHidden = (role: WorkspaceBusinessRoleOption) =>
    void run(() => send(path(role.code), "PATCH", { hidden: !role.hidden }), role.hidden ? `Đã hiện lại "${role.label}".` : `Đã ẩn "${role.label}" khỏi danh sách chọn.`);
  const remove = (role: WorkspaceBusinessRoleOption) => {
    if (!window.confirm(`Xóa vai trò "${role.label}"?`)) return;
    void run(() => send(path(role.code), "DELETE"), `Đã xóa vai trò "${role.label}".`);
  };

  return (
    <section aria-label="Setting vai trò" className="space-y-4">
      {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
      {notice ? <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Check className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div> : null}

      <section className={cardClass}>
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h3 className="text-base font-bold text-slate-950">Vai trò nghiệp vụ</h3>
          <p className="mt-1 text-xs text-slate-500">Danh sách hiện ở ô “Vai trò nghiệp vụ” của từng nhân sự và là “Role” hiển thị của họ. Vai trò tự tạo có quyền giống vai trò gốc đã chọn.</p>
        </div>
        <form onSubmit={add} className="grid gap-2 border-b border-border px-5 py-4 sm:grid-cols-[minmax(0,1fr)_260px_auto] sm:items-end sm:px-6">
          <label className="text-xs font-semibold text-slate-500">Tên vai trò mới
            <input value={draft.label} maxLength={60} placeholder="VD: Business development" onChange={(event) => setDraft({ ...draft, label: event.target.value })} className={`${inputClass} mt-1`} />
          </label>
          <div className="text-xs font-semibold text-slate-500">Quyền giống
            <CrmSelect menuPortal className="mt-1" ariaLabel="Quyền giống vai trò" value={draft.baseRoleCode} options={baseOptions} onChange={(baseRoleCode) => setDraft({ ...draft, baseRoleCode })} />
          </div>
          <button type="submit" disabled={busy || !draft.label.trim()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><Plus className="h-4 w-4" />Thêm</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className={`bg-slate-50 ${TABLE_HEAD_CLASS}`}><tr><th className="px-5 py-3">Tên</th><th className="px-4 py-3">Quyền giống</th><th className="px-4 py-3">Loại tài khoản</th><th className="px-4 py-3">Số người</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-border">
              {businessRoles.map((role) => (
                <tr key={role.code} className={role.hidden ? "bg-slate-50/60 text-slate-400" : ""}>
                  <td className="px-5 py-3">
                    {editing?.code === role.code ? (
                      <span className="flex items-center gap-1.5">
                        <input autoFocus aria-label="Tên vai trò" value={editing.label} maxLength={60} onChange={(event) => setEditing({ ...editing, label: event.target.value })}
                          onKeyDown={(event) => { if (event.key === "Enter") saveName(); if (event.key === "Escape") setEditing(null); }} className={inputClass} />
                        <button type="button" aria-label="Lưu tên" disabled={busy || !editing.label.trim()} onClick={saveName} className={iconButton}><Check className="h-4 w-4" /></button>
                        <button type="button" aria-label="Hủy" onClick={() => setEditing(null)} className={iconButton}><X className="h-4 w-4" /></button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{role.label}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{role.builtIn ? "Có sẵn" : "Tự tạo"}</span>
                        {role.hidden ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Đang ẩn</span> : null}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{role.builtIn ? "—" : labelOf(role.baseRoleCode)}</td>
                  <td className="px-4 py-3"><span className={pill(role.accountType === "ADMIN")}>{role.accountType === "ADMIN" ? "Admin" : "User"}</span></td>
                  <td className="px-4 py-3 text-slate-700">{role.memberCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button type="button" title="Đổi tên" aria-label={`Đổi tên ${role.label}`} disabled={busy} onClick={() => setEditing({ code: role.code, label: role.label })} className={iconButton}><Pencil className="h-4 w-4" /></button>
                    {role.builtIn ? (
                      <button type="button" title={role.hidden ? "Hiện lại trong danh sách chọn" : "Ẩn khỏi danh sách chọn"} aria-label={`${role.hidden ? "Hiện" : "Ẩn"} ${role.label}`} disabled={busy} onClick={() => toggleHidden(role)} className={iconButton}>
                        {role.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                    ) : (
                      <button type="button" title={role.memberCount ? "Còn người giữ vai trò này" : "Xóa"} aria-label={`Xóa ${role.label}`} disabled={busy || role.memberCount > 0} onClick={() => remove(role)} className={`${iconButton} hover:!bg-rose-50 hover:!text-rose-600`}><Trash2 className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {!roles ? <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">Đang tải…</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={cardClass}>
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h3 className="text-base font-bold text-slate-950">Quyền hệ thống</h3>
          <p className="mt-1 text-xs text-slate-500">Các mức quyền cố định của workspace (ô “Vai trò trong workspace”). Muốn thêm tên mới, tạo ở Vai trò nghiệp vụ với quyền giống vai trò phù hợp.</p>
        </div>
        <table className="w-full text-left text-sm">
          <thead className={`bg-slate-50 ${TABLE_HEAD_CLASS}`}><tr><th className="px-5 py-3">Tên</th><th className="px-4 py-3">Loại tài khoản</th><th className="px-4 py-3">Số người</th></tr></thead>
          <tbody className="divide-y divide-border">
            {(roles?.systemRoles ?? []).map((role) => (
              <tr key={role.code}><td className="px-5 py-3 font-semibold text-slate-900">{role.label}</td><td className="px-4 py-3"><span className={pill(role.accountType === "ADMIN")}>{role.accountType === "ADMIN" ? "Admin" : "User"}</span></td><td className="px-4 py-3 text-slate-700">{role.memberCount}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
