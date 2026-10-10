"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { authRequest } from "@/lib/native-auth-client";
import { CustomDropdown } from "@/components/crm-workspace/tasks-workbench";
import { UserPlus, X } from "lucide-react";
import { ModalLayer } from "@/components/modal-layer";
import { CrmMultiSelect } from "@/components/crm-workspace/crm-select";
import { BUSINESS_ROLE_OPTIONS, MANUAL_WORKSPACE_ROLE_OPTIONS } from "@/lib/people-roles";
import { AuthField, authButton, authInput } from "./account-form";
import type { EmploymentStatus } from "@b2b-crm/contracts";
const invitationRoles = MANUAL_WORKSPACE_ROLE_OPTIONS;
const workspaceRoles = MANUAL_WORKSPACE_ROLE_OPTIONS;
type Invitation = {id:string;email:string;displayName?:string;roleCode:string;status:string;expiresAt:string};
export function AdminInvitations() {
  const {user} = useAuth(); const [open,setOpen] = useState(false); const [rows,setRows] = useState<Invitation[]>([]);
  const [email,setEmail] = useState(""); const [displayName,setName] = useState(""); const [roleCode,setRole] = useState("WORKSPACE_USER");
  const [busy,setBusy] = useState(false); const [error,setError] = useState(""); const [message,setMessage] = useState("");
  const allowed = user?.role === "FOUNDER_GM";
  async function load(){ const r = await authRequest<{data:Invitation[]}>("admin/invitations"); setRows(r.data); }
  useEffect(() => {if(open && allowed) void load().catch(e=>setError(e.message));},[open,allowed]);
  async function create(e:FormEvent){e.preventDefault();setBusy(true);setError("");setMessage("");try{await authRequest("admin/invitations",{email,displayName,roleCode});setEmail("");setName("");setMessage("Invitation created. Delivery is handled by your workspace email service.");await load();}catch(e){setError(e instanceof Error?e.message:"Unable to invite.");}finally{setBusy(false);}}
  async function revoke(id:string){setBusy(true);setError("");try{await authRequest(`admin/invitations/${encodeURIComponent(id)}/revoke`,{});await load();setMessage("Invitation revoked. Its link can no longer be used.");}catch(e){setError(e instanceof Error?e.message:"Unable to revoke.");}finally{setBusy(false);}}
  if(!allowed) return null;
  return <>
    <button type="button" className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90" onClick={()=>setOpen(true)}><UserPlus className="h-4 w-4" /> Invite member</button>
    {open && <ModalLayer initialFocusSelector='input[type="email"]' onClose={()=>setOpen(false)}><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={()=>setOpen(false)}>
    <div role="dialog" aria-modal="true" aria-labelledby="invite-member-title" className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-visible rounded-2xl border border-border bg-card shadow-2xl" onClick={e=>e.stopPropagation()}>
    <div className="flex items-center justify-between border-b border-border bg-muted/20 px-6 py-4"><h2 id="invite-member-title" className="text-base font-bold text-foreground">Invite member</h2><button type="button" aria-label="Close" className="min-h-11 min-w-11 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={()=>setOpen(false)}><X className="mx-auto h-4 w-4" /></button></div>
    <div className="space-y-4 p-6">
      <p className="text-xs text-muted-foreground">Invite a colleague with the least access they need. To resend, revoke the old invitation and create a new one.</p>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={create}>
        <AuthField label="Email"><input type="email" required className={authInput} value={email} onChange={e=>setEmail(e.target.value)}/></AuthField>
        <AuthField label="Full name"><input className={authInput} value={displayName} maxLength={120} onChange={e=>setName(e.target.value)}/></AuthField>
        <CustomDropdown label="Workspace role" value={roleCode} options={invitationRoles} onChange={setRole}/>
        <button disabled={busy} className={`${authButton} self-end`}>Create invitation</button>
      </form>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{message&&<p role="status" className="text-sm text-success">{message}</p>}
      <div className="max-h-56 space-y-2 overflow-y-auto">{rows.length===0?<p className="text-xs text-muted-foreground">No invitations yet.</p>:rows.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="text-sm font-medium">{r.email}</p><p className="text-xs text-muted-foreground">{r.roleCode} · {r.status} · Expires {new Date(r.expiresAt).toLocaleDateString()}</p></div>{r.status.toLowerCase()==="pending"&&<button disabled={busy} className="min-h-11 text-sm text-destructive" onClick={()=>void revoke(r.id)}>Revoke invitation</button>}</div>)}</div>
    </div></div></div></ModalLayer>}
  </>;
}
const employmentStatusOptions = [
  { value: "ACTIVE", label: "Đang làm việc", subtext: "Được phép truy cập workspace" },
  { value: "ON_LEAVE", label: "Tạm nghỉ", subtext: "Tạm dừng truy cập nhưng giữ hồ sơ" },
  { value: "INACTIVE", label: "Đã nghỉ việc", subtext: "Ngừng truy cập workspace" },
];

const businessRoleOptions = BUSINESS_ROLE_OPTIONS.map((role) => ({ value: role, label: role }));
const costPermissionOptions = [{ value: "COST_VIEW", label: "Xem" }, { value: "COST_EDIT", label: "Sửa" }, { value: "COST_APPROVE", label: "Duyệt" }, { value: "COST_EXPORT", label: "Xuất" }];
const ALL_COST_PERMISSIONS = ["COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"];
const controlLabel = "block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function AdminMemberControls({userId,status,currentRole,employmentStatus="ACTIVE",displayRole,costPermissionCodes=[]}:{userId:string;status:string;currentRole:string;employmentStatus?:EmploymentStatus;displayRole:string;costPermissionCodes?:readonly string[]}) {
  const {user}=useAuth();
  const [roleCode,setRole]=useState(currentRole);
  const [workStatus,setWorkStatus]=useState<EmploymentStatus>(employmentStatus);
  const [businessRole,setBusinessRole]=useState(displayRole);
  // Founder/GM always has full cost access; everyone else needs an explicit COST_* grant.
  const [costCodes,setCostCodes]=useState<string[]>(currentRole==="FOUNDER_GM"?ALL_COST_PERMISSIONS:[...costPermissionCodes]);
  const [costMessage,setCostMessage]=useState("");
  // Saves the whole set: the API replaces every COST_* grant with exactly these codes.
  async function changeCostPermissions(permissionCodes:string[]){
    const previous=costCodes;
    setCostCodes(permissionCodes);setBusy(true);setError("");setCostMessage("");
    try{
      const response=await fetch(`/api/admin/users/${encodeURIComponent(userId)}/cost-permissions`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({permissionCodes})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.message??"Không thể cập nhật nhóm quyền chi phí.");
      setCostMessage("Đã cập nhật quyền P&L.");
    }catch(e){setCostCodes(previous);setError(e instanceof Error?e.message:"Không thể cập nhật nhóm quyền chi phí.");}finally{setBusy(false);}
  }
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [confirm,setConfirm]=useState<"profile"|"deactivate"|"reactivate"|"revoke-sessions"|null>(null);
  async function execute(){
    if(!confirm)return;
    setBusy(true);setError("");
    try{
      if(confirm==="profile") {
        const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/resource-profile`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...(businessRole !== displayRole ? { displayRole: businessRole } : {}), systemRole: roleCode, employmentStatus: workStatus }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không thể lưu thông tin thành viên.");
      } else if(confirm==="reactivate") {
        const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/resource-profile`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ systemRole: roleCode, employmentStatus: "ACTIVE" }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không thể khôi phục thành viên.");
      }
      else {const r=await fetch(`/api/admin/users/${encodeURIComponent(userId)}/${confirm}`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});if(!r.ok){const b=await r.json();throw new Error(b.message||"Unable to update member.");}}
      window.location.reload();
    }catch(e){setError(e instanceof Error?e.message:"Unable to update member.");}finally{setBusy(false);}
  }
  if(!user?.roleCodes?.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN"))return null;
  return <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
    <h2 className="!text-sm font-bold text-foreground">Workspace access</h2>
    <p className="mt-0.5 text-xs text-muted-foreground">Chỉ admin thấy mục này. Đổi vai trò sẽ thu hồi session hiện tại của user.</p>
    <div className="mt-4 space-y-2">
      <label className={controlLabel}>Vai trò nghiệp vụ</label>
      <CustomDropdown label="" value={businessRole} options={businessRoleOptions} onChange={setBusinessRole}/>
    </div>
    <div className="mt-4 space-y-2">
      <label className={controlLabel}>Vai trò trong workspace</label>
      <CustomDropdown label="" value={roleCode} options={workspaceRoles} onChange={setRole}/>
    </div>
    <div className="mt-4 space-y-2">
      <label className={controlLabel}>Trạng thái làm việc</label>
      <CustomDropdown label="" value={workStatus} options={employmentStatusOptions} onChange={(value) => setWorkStatus(value as EmploymentStatus)}/>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <button className={authButton} disabled={busy||(roleCode===currentRole&&workStatus===employmentStatus&&businessRole===displayRole)} onClick={()=>setConfirm("profile")}>{busy?"Đang lưu…":"Lưu thay đổi"}</button>
      <button disabled={busy} className="min-h-11 rounded-xl border border-border px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted" onClick={()=>setConfirm(status==="active"?"deactivate":"reactivate")}>{status==="active"?"Tạm khóa truy cập":"Khôi phục truy cập"}</button>
    </div>
    <button disabled={busy} className="mt-2 min-h-10 w-full rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" onClick={()=>setConfirm("revoke-sessions")}>Thu hồi tất cả session</button>
    <div className="mt-4 space-y-2 border-t border-border pt-4">
      <label className={controlLabel}>Quyền P&amp;L</label>
      <CrmMultiSelect ariaLabel="Quyền P&L" searchable={false} placeholder="Chưa cấp" selectedCountLabel={(count)=>count===4?"Toàn quyền":`${count} quyền`} disabled={busy||currentRole==="FOUNDER_GM"||status!=="active"} options={costPermissionOptions} values={costCodes} onChange={(values)=>void changeCostPermissions(values)}/>
      {currentRole==="FOUNDER_GM"?<p className="text-xs text-muted-foreground">Founder/GM luôn có toàn quyền chi phí.</p>:status!=="active"?<p className="text-xs text-muted-foreground">Khôi phục truy cập trước khi cấp quyền P&amp;L.</p>:null}
      {costMessage&&<p role="status" className="text-xs text-success">{costMessage}</p>}
    </div>
    {confirm&&<div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-medium text-amber-900">Xác nhận {confirm==="profile"?"lưu role và trạng thái làm việc":confirm.replaceAll("-"," ")}?</p><div className="mt-3 flex gap-2"><button disabled={busy} className={authButton} onClick={()=>void execute()}>Xác nhận</button><button className="min-h-11 px-3 text-sm font-semibold text-muted-foreground" onClick={()=>setConfirm(null)}>Hủy</button></div></div>}
    {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </section>;
}
