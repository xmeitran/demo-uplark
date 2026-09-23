"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { authRequest } from "@/lib/native-auth-client";
import { CustomDropdown } from "@/components/crm-workspace/tasks-workbench";
import { AuthField, authButton, authInput } from "./account-form";
const invitationRoles = [{value:"DELIVERY_LEAD",label:"Delivery Lead"},{value:"SALES_OWNER",label:"Sales Owner"},{value:"FINANCE_ADMIN",label:"Finance Admin"},{value:"FOUNDER_GM",label:"Founder / General Manager"}];
const workspaceRoles = [{value:"WORKSPACE_ADMIN",label:"Workspace Admin"},{value:"WORKSPACE_USER",label:"Workspace User"}];
type Invitation = {id:string;email:string;displayName?:string;roleCode:string;status:string;expiresAt:string};
export function AdminInvitations() {
  const {user} = useAuth(); const [open,setOpen] = useState(false); const [rows,setRows] = useState<Invitation[]>([]);
  const [email,setEmail] = useState(""); const [displayName,setName] = useState(""); const [roleCode,setRole] = useState("DELIVERY_LEAD");
  const [busy,setBusy] = useState(false); const [error,setError] = useState(""); const [message,setMessage] = useState("");
  const allowed = user?.role === "FOUNDER_GM";
  async function load(){ const r = await authRequest<{data:Invitation[]}>("admin/invitations"); setRows(r.data); }
  useEffect(() => {if(open && allowed) void load().catch(e=>setError(e.message));},[open,allowed]);
  async function create(e:FormEvent){e.preventDefault();setBusy(true);setError("");setMessage("");try{await authRequest("admin/invitations",{email,displayName,roleCode});setEmail("");setName("");setMessage("Invitation created. Delivery is handled by your workspace email service.");await load();}catch(e){setError(e instanceof Error?e.message:"Unable to invite.");}finally{setBusy(false);}}
  async function revoke(id:string){setBusy(true);setError("");try{await authRequest(`admin/invitations/${encodeURIComponent(id)}/revoke`,{});await load();setMessage("Invitation revoked. Its link can no longer be used.");}catch(e){setError(e instanceof Error?e.message:"Unable to revoke.");}finally{setBusy(false);}}
  if(!allowed) return null;
  return <section className="mb-5 rounded-xl border border-border bg-card p-4">
    <button className="min-h-11 text-sm font-semibold text-primary" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?"Close invitations":"Invite team members"}</button>
    {open && <div className="mt-3 space-y-4">
      <p className="text-xs text-muted-foreground">Invite a colleague with the least access they need. To resend, revoke the old invitation and create a new one.</p>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={create}>
        <AuthField label="Email"><input type="email" required className={authInput} value={email} onChange={e=>setEmail(e.target.value)}/></AuthField>
        <AuthField label="Full name"><input className={authInput} value={displayName} maxLength={120} onChange={e=>setName(e.target.value)}/></AuthField>
        <CustomDropdown label="Workspace role" value={roleCode} options={invitationRoles} onChange={setRole}/>
        <button disabled={busy} className={`${authButton} self-end`}>Create invitation</button>
      </form>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{message&&<p role="status" className="text-sm text-success">{message}</p>}
      <div className="space-y-2">{rows.length===0?<p className="text-xs text-muted-foreground">No invitations yet.</p>:rows.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="text-sm font-medium">{r.email}</p><p className="text-xs text-muted-foreground">{r.roleCode} · {r.status} · Expires {new Date(r.expiresAt).toLocaleDateString()}</p></div>{r.status.toLowerCase()==="pending"&&<button disabled={busy} className="min-h-11 text-sm text-destructive" onClick={()=>void revoke(r.id)}>Revoke invitation</button>}</div>)}</div>
    </div>}
  </section>;
}
export function AdminMemberControls({userId,status,currentRole}:{userId:string;status:string;currentRole:string}) {
  const {user}=useAuth();
  const [roleCode,setRole]=useState(currentRole);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [confirm,setConfirm]=useState<"role"|"deactivate"|"reactivate"|"revoke-sessions"|null>(null);
  async function execute(){
    if(!confirm)return;
    setBusy(true);setError("");
    try{
      if(confirm==="role"||confirm==="reactivate") await authRequest(`admin/users/${encodeURIComponent(userId)}/${confirm}`,confirm==="role"?{roleCode}:{},confirm==="role"?"PATCH":"POST");
      else {const r=await fetch(`/api/admin/users/${encodeURIComponent(userId)}/${confirm}`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});if(!r.ok){const b=await r.json();throw new Error(b.message||"Unable to update member.");}}
      window.location.reload();
    }catch(e){setError(e instanceof Error?e.message:"Unable to update member.");}finally{setBusy(false);}
  }
  if(!user?.roleCodes?.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN"))return null;
  return <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">Workspace access</h2><p className="mt-1 text-xs leading-5 text-slate-500">Quản lý quyền truy cập theo workspace. Thay đổi sẽ thu hồi session hiện tại của user.</p></div><span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700">Admin only</span></div>
    <div className="mt-4 space-y-2">
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vai trò trong workspace</label>
      <CustomDropdown label="" value={roleCode} options={workspaceRoles} onChange={setRole}/>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <button className={authButton} disabled={busy||roleCode===currentRole} onClick={()=>setConfirm("role")}>{busy?"Đang lưu…":"Lưu thay đổi"}</button>
      <button disabled={busy} className="min-h-11 rounded-xl border border-border px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={()=>setConfirm(status==="active"?"deactivate":"reactivate")}>{status==="active"?"Tạm khóa truy cập":"Khôi phục truy cập"}</button>
    </div>
    <button disabled={busy} className="mt-2 min-h-10 w-full rounded-xl px-3 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-red-600" onClick={()=>setConfirm("revoke-sessions")}>Thu hồi tất cả session</button>
    <p className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs leading-5 text-blue-800">Hệ thống luôn giữ lại ít nhất một Founder/GM và không cho phép tài khoản đang đăng nhập tự hạ quyền.</p>
    {confirm&&<div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-medium text-amber-900">Xác nhận {confirm==="role"?`đổi thành ${roleCode === "WORKSPACE_ADMIN" ? "Workspace Admin" : "Workspace User"}`:confirm.replaceAll("-"," ")}?</p><div className="mt-3 flex gap-2"><button disabled={busy} className={authButton} onClick={()=>void execute()}>Xác nhận</button><button className="min-h-11 px-3 text-sm font-semibold text-slate-600" onClick={()=>setConfirm(null)}>Hủy</button></div></div>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </section>;
}
