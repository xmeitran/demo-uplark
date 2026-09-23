"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { authRequest } from "@/lib/native-auth-client";
import { useAuth } from "@/lib/auth";
import { AuthField, authButton, authInput } from "./account-form";
type Account = { email: string; displayName: string; avatarUrl?: string; emailVerified: boolean; passwordEnabled: boolean; mfaEnabled: boolean; identities: { provider: string }[] };
type Session = { id: string; current: boolean; createdAt: string; lastSeenAt: string; expiresAt: string; userAgent?: string; authMethod?: string };
export function SecuritySettings() {
  const { refresh, logout } = useAuth();
  const [account, setAccount] = useState<Account | null>(null); const [sessions, setSessions] = useState<Session[]>([]);
  const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [nextPassword, setNextPassword] = useState(""); const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUrl: string } | null>(null); const [recovery, setRecovery] = useState<string[]>([]);
  const [signInRequired, setSignInRequired] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function load() { const [a, s] = await Promise.all([authRequest<Account>("account"), authRequest<{data:Session[]}>("sessions")]); setAccount(a); setName(a.displayName); setSessions(s.data); }
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  async function run(action: () => Promise<void>, success: string, reload = true) { setBusy(true); setError(""); setMessage(""); try { await action(); setMessage(success); if (reload) await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete request."); } finally { setBusy(false); } }
  const submit = (event: FormEvent, action: () => Promise<void>, success: string, reload = true) => { event.preventDefault(); void run(action, success, reload); };
  return <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
    <div><h2 className="text-base font-bold text-foreground">Account & security</h2><p className="mt-1 text-xs text-muted-foreground">Manage your profile, password, two-step verification and signed-in devices.</p></div>
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">{message}</p>}
    {signInRequired && <div role="status" className="space-y-3 rounded-xl border border-primary/30 p-4"><p className="text-sm">Your security settings changed. All sessions were signed out. Save any recovery codes below before continuing.</p>{recovery.length > 0 && <pre className="whitespace-pre-wrap select-all text-sm">{recovery.join("\n")}</pre>}<Link href="/login?returnTo=/settings" className="block text-sm font-semibold text-primary">Sign in again</Link></div>}
    <fieldset disabled={busy || signInRequired} className="space-y-6 disabled:opacity-60">
    {!account ? <p className="text-sm text-muted-foreground">Loading account security…</p> : <>
      <form className="grid max-w-xl gap-3" onSubmit={e => submit(e, async () => { await authRequest("account", {displayName:name}, "PATCH"); await refresh(); }, "Profile updated.")}>
        <AuthField label="Full name"><input className={authInput} required maxLength={120} value={name} onChange={e => setName(e.target.value)}/></AuthField>
        <p className="text-xs text-muted-foreground">{account.email} · {account.emailVerified ? "Email verified" : "Email not verified"} · Connected: {account.identities.map(i => i.provider).join(", ") || "Password"}</p>
        <button disabled={busy} className={`${authButton} justify-self-start`}>Save profile</button>
      </form>
      <div className="grid max-w-xl gap-3 border-t border-border pt-5"><h3 className="font-semibold">Email address</h3>
        {!account.emailVerified && <button className={`${authButton} justify-self-start`} onClick={() => void run(async () => { await authRequest("email/verification-request", {}); }, "Verification instructions requested.")}>Send verification email</button>}
        <AuthField label="New email address"><input type="email" className={authInput} value={newEmail} onChange={e => setNewEmail(e.target.value)}/></AuthField>
        <p className="text-xs text-muted-foreground">Confirm your password and authenticator code below if enabled. Your email changes only after verification.</p>
        <button disabled={!newEmail} className={`${authButton} justify-self-start`} onClick={() => void run(async () => { await authRequest("email/change-request", {email:newEmail,password:password || undefined,code:code || undefined}); setNewEmail(""); }, "Verification requested for the new email address.")}>Request email change</button>
      </div>
      <div className="border-t border-border pt-5"><h3 className="mb-3 font-semibold">{account.passwordEnabled ? "Change password" : "Set a password"}</h3>
        <form className="grid max-w-xl gap-3" onSubmit={e => submit(e, async () => { await authRequest("password/change", {currentPassword:password || undefined,newPassword:nextPassword,code:code || undefined}); setPassword(""); setNextPassword(""); setCode(""); setSignInRequired(true); }, "Password updated. Sign in again.", false)}>
          {account.passwordEnabled && <AuthField label="Current password"><input className={authInput} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></AuthField>}
          <AuthField label="New password (at least 12 characters)"><input className={authInput} type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={nextPassword} onChange={e => setNextPassword(e.target.value)}/></AuthField>
          {account.mfaEnabled && <AuthField label="Authenticator code"><input className={authInput} autoComplete="one-time-code" value={code} required onChange={e => setCode(e.target.value)}/></AuthField>}
          <button disabled={busy} className={`${authButton} justify-self-start`}>Update password</button>
        </form>
      </div>
      <div className="space-y-3 border-t border-border pt-5"><h3 className="font-semibold">Two-step verification · {account.mfaEnabled ? "Enabled" : "Not enabled"}</h3>
        <p className="text-xs text-muted-foreground">Use an authenticator app to protect password and Lark sign-ins. Save recovery codes somewhere private.</p>
        <div className="grid max-w-xl gap-3">
          {account.passwordEnabled && <AuthField label="Confirm password for security changes"><input className={authInput} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></AuthField>}
          {(account.mfaEnabled || enrollment) && <AuthField label="Authenticator code for security change"><input className={authInput} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)}/></AuthField>}
          {enrollment && <div className="space-y-2 rounded-xl border border-border bg-background p-3"><p className="text-sm">In your authenticator, add a time-based account with this setup key:</p><code className="block break-all select-all text-sm">{enrollment.secret}</code><p className="text-xs text-muted-foreground">After adding it, enter the six-digit code above to finish setup.</p><button disabled={busy || !code} className={authButton} onClick={() => void run(async () => { const r = await authRequest<{recoveryCodes:string[]}>("mfa/confirm", {code}); setRecovery(r.recoveryCodes); setEnrollment(null); setPassword(""); setCode(""); setSignInRequired(true); }, "Two-step verification enabled. Save your recovery codes now.", false)}>Finish setup</button></div>}
          {!account.mfaEnabled && !enrollment && <button disabled={busy} className={`${authButton} justify-self-start`} onClick={() => void run(async () => { setEnrollment(await authRequest("mfa/enroll", {password:password || undefined})); }, "Enter the setup key in your authenticator.")}>Set up authenticator</button>}
          {account.mfaEnabled && <button disabled={busy || !code} className="min-h-11 justify-self-start rounded-xl border border-destructive/30 px-4 text-sm text-destructive" onClick={() => void run(async () => { await authRequest("mfa/disable", {password:password || undefined,code}); setCode(""); setPassword(""); setRecovery([]); setSignInRequired(true); }, "Two-step verification disabled. Sign in again.", false)}>Disable two-step verification</button>}
          {recovery.length > 0 && <div className="space-y-2 rounded-xl border border-border p-4"><p className="text-sm font-semibold">Recovery codes — shown once</p><pre className="whitespace-pre-wrap select-all text-sm">{recovery.join("\n")}</pre><button className="text-sm text-primary" onClick={() => setRecovery([])}>I saved these codes</button></div>}
        </div>
      </div>
      <div className="space-y-3 border-t border-border pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Active sessions</h3><button disabled={busy} className="min-h-11 rounded-xl border border-border px-3 text-sm" onClick={() => void run(async () => { await authRequest("sessions/revoke-others", {}); }, "Other sessions signed out.")}>Sign out other devices</button></div>
        {sessions.map(s => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"><div className="min-w-0"><p className="text-sm font-medium">{s.current ? "This browser" : "Another device"} · {s.authMethod || "Session"}</p><p className="max-w-xl break-all text-xs text-muted-foreground">{s.userAgent || "Browser details unavailable"}</p><p className="text-xs text-muted-foreground">Last active {new Date(s.lastSeenAt || s.createdAt).toLocaleString()} · Expires {new Date(s.expiresAt).toLocaleString()}</p></div><button disabled={busy} className="min-h-11 text-sm text-destructive" onClick={() => s.current ? void logout() : void run(async () => { await authRequest(`sessions/${encodeURIComponent(s.id)}/revoke`, {}); }, "Session signed out.")}>Sign out</button></div>)}
      </div>
    </>}
    </fieldset>
  </section>;
}

export function WorkspaceSwitcher() {
  const [workspaces,setWorkspaces] = useState<{id:string;name:string;current:boolean}[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{authRequest<{data:{id:string;name:string;current:boolean}[]}>("workspaces").then(r=>setWorkspaces(r.data)).catch(e=>setError(e.message));},[]);
  async function change(workspaceId:string){setBusy(true);setError("");try{await authRequest("workspaces/switch",{workspaceId});window.location.assign("/");}catch(e){setError(e instanceof Error?e.message:"Unable to switch workspace.");setBusy(false);}}
  return <section className="space-y-3 rounded-xl border border-border bg-card p-5 lg:col-span-2"><h2 className="font-semibold">Your workspaces</h2><p className="text-xs text-muted-foreground">Switch to an existing membership. Access comes from the role assigned in that workspace.</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex flex-wrap gap-3">{workspaces.map(w=><button key={w.id} disabled={busy||w.current} onClick={()=>void change(w.id)} className="min-h-11 rounded-xl border border-border px-4 text-sm disabled:opacity-60">{w.name}{w.current?" · Current":""}</button>)}</div></section>;
}
