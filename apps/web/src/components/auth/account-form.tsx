"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { APP_NAME, AppBrandLogo } from "@/components/app-brand";
import { authRequest } from "@/lib/native-auth-client";
import { useAuth } from "@/lib/auth";
export const authInput = "w-full min-h-11 rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";
export const authButton = "min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 hover:opacity-90";
export function AuthField({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1.5 text-sm font-medium text-foreground"><span>{label}</span>{children}</label>; }
export function AccountForm({ mode }: { mode: "signup" | "forgot" | "reset" | "verify" }) {
  const { user } = useAuth();
  const [token, setToken] = useState(""); const [email, setEmail] = useState("");
  const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  useEffect(() => { const params = new URLSearchParams(location.search); setToken(params.get("token") || ""); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if ((mode === "reset" || (mode === "signup" && !user)) && password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      if (mode === "forgot") { await authRequest("password/forgot", { email }); setMessage("If this email has an eligible account, password reset instructions will arrive shortly."); }
      else if (mode === "verify") { await authRequest("email/verify", { token }); setMessage("Email verified. You can sign in to your workspace."); }
      else if (mode === "reset") { await authRequest("password/reset", { token, password }); setPassword(""); setConfirm(""); setMessage("Password updated. Sign in with your new password."); }
      else {
        const result = await authRequest("invitations/activate", { token, displayName: name, ...(!user ? { password } : {}) });
        window.location.assign(result.mfaRequired ? "/login?mfa=1" : "/");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to complete request."); }
    finally { setBusy(false); }
  }
  const titles = { signup: "Join your workspace", forgot: "Forgot password", reset: "Reset password", verify: "Verify your email" };
  return <main className="flex min-h-screen items-center justify-center bg-background p-5"><section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-sm">
    <div className="mb-7 flex items-center gap-3"><AppBrandLogo className="h-8 w-auto"/><span className="font-bold">{APP_NAME}</span></div>
    <h1 className="text-2xl font-bold text-foreground">{titles[mode]}</h1>
    <p className="my-3 text-sm text-muted-foreground">{mode === "signup" ? "Workspace access is by invitation. Ask your administrator for an invitation link." : "Keep your workspace account secure."}</p>
    <form onSubmit={submit} className="space-y-4">
      {mode === "forgot" && <AuthField label="Email address"><input className={authInput} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/></AuthField>}
      {mode !== "forgot" && !token && <p role="alert" className="text-sm text-destructive">Open the complete link from your email to continue.</p>}
      {mode === "signup" && token && <>
        {user ? <p className="text-sm">Accepting as {user.email}. Your existing password will remain unchanged.</p> : <>
          <p className="text-xs text-muted-foreground">Already have an account? <Link className="text-primary underline" href={`/login?returnTo=${encodeURIComponent(`/signup?token=${token}`)}`}>Sign in before accepting</Link>.</p>
          <AuthField label="Full name"><input className={authInput} autoComplete="name" required value={name} maxLength={120} onChange={e => setName(e.target.value)}/></AuthField>
        </>}
      </>}
      {(mode === "reset" || (mode === "signup" && !user)) && token && <>
        <AuthField label="New password"><input className={authInput} type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)}/></AuthField>
        <p className="text-xs text-muted-foreground">Use at least 12 characters. A long, unique passphrase works well.</p>
        <AuthField label="Confirm password"><input className={authInput} type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)}/></AuthField>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm text-success">{message}</p>}
      <button className={`${authButton} w-full`} disabled={busy || (mode !== "forgot" && !token)}>{busy ? "Please wait…" : mode === "signup" ? "Accept invitation" : mode === "forgot" ? "Send reset instructions" : mode === "reset" ? "Update password" : "Verify email"}</button>
    </form>
    {mode === "signup" && token && <Link className="mt-4 block text-center text-sm font-semibold text-primary" href={`/api/auth/invitations/activate?token=${encodeURIComponent(token)}`}>Accept with Lark SSO</Link>}
    <Link href="/login" className="mt-6 block text-center text-sm text-primary">Back to sign in</Link>
  </section></main>;
}
