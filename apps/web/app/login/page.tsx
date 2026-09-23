"use client";
import { MoneyAmount } from "@/components/money-amount";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, TrendingUp, TrendingDown,
  CheckCircle2, BarChart2, Users, Briefcase, Shield, Sparkles,
  Globe, GitBranch, Workflow,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { authRequest } from "@/lib/native-auth-client";
import { safeAuthReturnTo } from "@/lib/auth-bff-security";
import Link from "next/link";
import { APP_NAME, AppBrandLogo } from "@/components/app-brand";
import { LocalDemoSessionButton } from "./local-demo-session-button";

// ─── Animated Counter ─────────────────────────────────────────────────────────

function AnimatedNumber({ value }: { value: string }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 300 }}
      className="font-mono tabular-nums"
    >
      {value}
    </motion.span>
  );
}

// ─── Preview Cards ────────────────────────────────────────────────────────────

const PREVIEW_CARDS = [
  {
    title: "Total Deals",
    value: <MoneyAmount value={4_200_000} />,
    change: "+18.4%",
    positive: true,
    color: "#60a5fa",
    mini: [28, 42, 35, 55, 48, 70, 65],
  },
  {
    title: "Active Clients",
    value: "2,847",
    change: "+12.1%",
    positive: true,
    color: "#a78bfa",
    mini: [40, 38, 55, 50, 62, 58, 75],
  },
  {
    title: "Tasks Done",
    value: "94.6%",
    change: "+5.3%",
    positive: true,
    color: "#34d399",
    mini: [60, 65, 70, 68, 75, 80, 85],
  },
  {
    title: "Churn Rate",
    value: "2.1%",
    change: "-0.8%",
    positive: false,
    color: "#f87171",
    mini: [15, 12, 18, 10, 14, 9, 8],
  },
];

const AUTH_INPUT_CLASS =
  "flex-1 appearance-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0";
const AUTH_INPUT_STYLE: React.CSSProperties = {
  boxShadow: "none",
  outline: "none",
  outlineOffset: 0,
  outlineWidth: 0,
};

function SparkLine({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const W = 64, H = 28;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / (max - min + 1)) * H;
    return `${x},${y}`;
  });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <polyline points={pts.join(" ")} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
    </svg>
  );
}

function PreviewCard({ card, delay }: { card: typeof PREVIEW_CARDS[0]; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", damping: 22, stiffness: 280 }}
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ backgroundColor: "rgba(255,255,255,0.08)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.12)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.6)" }}>
          {card.title}
        </p>
        <SparkLine data={card.mini} color={card.color} />
      </div>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-bold" style={{ color: "#ffffff" }}>
          {typeof card.value === "string" ? <AnimatedNumber value={card.value} /> : card.value}
        </p>
        <span
          className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: card.positive ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)",
            color: card.positive ? "#6ee7b7" : "#fca5a5",
          }}
        >
          {card.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {card.change}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Feature List ─────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: BarChart2, label: "Real-time CRM analytics" },
  { icon: Users,     label: "Multi-team collaboration" },
  { icon: Briefcase, label: "Pipeline & deal tracking" },
  { icon: Shield,    label: "Enterprise-grade security" },
];

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  lark_access_denied: "Bạn đã hủy cấp quyền Lark. Hãy thử lại khi sẵn sàng.",
  lark_state_mismatch: "Phiên đăng nhập Lark đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.",
  lark_callback_failed: "Chưa thể xác thực tài khoản Lark này trong CRM workspace.",
  invitation_review_required: "Tài khoản Lark cần được admin duyệt trước khi truy cập.",
  logout_cleanup_failed: "Đã xóa phiên khỏi trình duyệt nhưng chưa xác nhận được thu hồi phiên trên máy chủ. Hãy đăng nhập lại và báo quản trị nếu cảnh báo này lặp lại.",
  session_required: "Vui lòng đăng nhập để tiếp tục."
};

// ─── Main Login Page ──────────────────────────────────────────────────────────

export default function LoginPage() {
  const auth = useAuth();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [authError, setAuthError] = useState("");
  const [loggedOut, setLoggedOut] = useState(false);
  const [returnTo, setReturnTo] = useState("/");
  const [focusedField, setFocusedField] = useState<"email"|"password"|null>(null);
  const [larkAvailable, setLarkAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorKey = params.get("auth_error") ?? "";
    setAuthError(AUTH_ERROR_MESSAGES[errorKey] ?? "");
    setLoggedOut(params.get("logged_out") === "1");
    setReturnTo(safeAuthReturnTo(params.get("returnTo")));
    setMfaRequired(params.get("mfa") === "1");
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/native/capabilities", { cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<{ lark?: boolean }> : null)
      .then(capabilities => { if (mounted) setLarkAvailable(capabilities?.lark === true); })
      .catch(() => { if (mounted) setLarkAvailable(false); });
    return () => { mounted = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const result = await authRequest(mfaRequired ? "mfa/challenge" : "password/login", mfaRequired ? { code } : { email, password });
      if (result.mfaRequired) { setMfaRequired(true); setPassword(""); }
      else { await auth.refresh(); window.location.assign(returnTo); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to sign in."); }
    finally { setLoading(false); }
  };

  const handleLarkLogin = () => {
    const url = new URL("/api/auth/lark/start", window.location.origin);
    url.searchParams.set("returnTo", returnTo);
    window.location.assign(url.toString());
  };

  // While auth is rehydrating, show nothing (prevents flash)
  if (auth.isLoading) return null;

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "#0f172a" }}>

      {/* ── Left: Login Form ── */}
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 300 }}
        className="flex flex-col justify-center items-center w-full lg:w-[480px] shrink-0 px-8 py-12"
        style={{ backgroundColor: "var(--color-card)", minHeight: "100vh" }}
      >
        {/* Brand */}
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-10">
            <AppBrandLogo className="h-8 w-auto" />
            <div>
              <p className="text-sm font-bold text-foreground leading-none">{APP_NAME}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Partner CRM Platform</p>
            </div>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-2xl font-bold text-foreground mb-1.5"
            >
              Sign in to Account
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="text-sm text-muted-foreground"
            >
              <span>Sign in with your workspace account or Lark SSO.</span>
            </motion.p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {!mfaRequired && <>
            {/* Email */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                Email Address
              </label>
              <div
                data-testid="login-email-field"
                className="flex items-center gap-3 rounded-xl border transition-all px-3.5 py-2.5"
                style={{
                  borderColor: focusedField === "email" ? "var(--color-primary)" : "var(--color-input)",
                  backgroundColor: "var(--color-background)",
                  boxShadow: focusedField === "email" ? "0 0 0 3px rgba(37,99,235,0.12)" : "none",
                }}
              >
                <Mail className="w-4 h-4 shrink-0 text-muted-foreground" />
                <input
                  aria-label="Email Address"
                  required={!mfaRequired}
                  type="email"
                  placeholder="username@google.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onFocus={() => setFocusedField("email")}
                  onBlur={() => setFocusedField(null)}
                  className={AUTH_INPUT_CLASS}
                  style={AUTH_INPUT_STYLE}
                  autoComplete="email"
                />
                {email.includes("@") && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  </motion.div>
                )}
              </div>
            </motion.div>

            {/* Password */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                Password
              </label>
              <div
                data-testid="login-password-field"
                className="flex items-center gap-3 rounded-xl border transition-all px-3.5 py-2.5"
                style={{
                  borderColor: focusedField === "password" ? "var(--color-primary)" : "var(--color-input)",
                  backgroundColor: "var(--color-background)",
                  boxShadow: focusedField === "password" ? "0 0 0 3px rgba(37,99,235,0.12)" : "none",
                }}
              >
                <Lock className="w-4 h-4 shrink-0 text-muted-foreground" />
                <input
                  aria-label="Password" required={!mfaRequired} type={showPwd ? "text" : "password"}
                  placeholder="••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  className={AUTH_INPUT_CLASS}
                  style={AUTH_INPUT_STYLE}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                  onClick={() => setShowPwd(!showPwd)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </motion.div>

            </>}
            {mfaRequired && <div className="space-y-2">
              <label htmlFor="mfa-code" className="block text-sm font-semibold">Authenticator or recovery code</label>
              <p className="text-xs text-muted-foreground">Enter a code from your authenticator app, or one unused recovery code.</p>
              <input id="mfa-code" autoComplete="one-time-code" autoFocus required value={code} onChange={event => setCode(event.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-3 text-foreground" />
              <button type="button" onClick={() => { setMfaRequired(false); setCode(""); }} className="text-xs text-primary">Use another account</button>
            </div>}
            <div className="flex justify-end"><Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link></div>

            {/* Error */}
            <AnimatePresence>
              {loggedOut && !error && !authError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  role="status"
                  className="rounded-lg border border-success/20 bg-success/8 px-3 py-2 text-xs text-success"
                >
                  Bạn đã đăng xuất. Hãy đăng nhập lại để tải quyền truy cập mới nhất.
                </motion.p>
              )}
              {(error || authError) && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2"
                >
                  {error || authError}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Submit */}
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.97 }}
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white shadow-md transition-all relative overflow-hidden"
              style={{ background: loading ? "rgba(37,99,235,0.7)" : "linear-gradient(135deg, #2563eb, #3b82f6)" }}
            >
              {loading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                  className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white"
                />
              ) : (
                <>
                  {mfaRequired ? "Verify and sign in" : "Sign In"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
              {/* Shimmer effect */}
              <motion.div
                className="absolute inset-0 opacity-0"
                whileHover={{ opacity: 1 }}
                style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)" }}
              />
            </motion.button>
          </form>

          {/* Divider */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex items-center gap-3 my-6"
          >
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-muted-foreground font-medium">OR</span>
            <div className="flex-1 h-px bg-border" />
          </motion.div>

          {/* Social logins */}
          <div className="space-y-3">
            {larkAvailable === true ? <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              whileHover={{ scale: 1.01, backgroundColor: "var(--color-primary)", color: "#ffffff" }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleLarkLogin}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl text-sm font-semibold border border-primary/40 bg-primary/8 text-primary transition-all"
            >
              <Workflow className="w-4 h-4" />
              Login with Lark
            </motion.button> : (
              <p className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-center text-xs text-muted-foreground">
                Lark SSO chưa được cấu hình cho localhost. Hãy dùng phiên founder local bên dưới.
              </p>
            )}

            {process.env.NODE_ENV !== "production" && <LocalDemoSessionButton returnTo={returnTo} />}

          </div>

          {/* Footer */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-center text-xs text-muted-foreground mt-8"
          >
            Have a workspace invitation?{" "}
            <Link href="/signup" className="text-primary font-medium cursor-pointer hover:underline">
              Accept an invitation
            </Link>
          </motion.p>

          <p className="text-center text-[10px] text-muted-foreground/50 mt-4">
            By signing in, you agree to our{" "}
            <span className="hover:text-muted-foreground cursor-pointer">Terms</span>{" "}
            and{" "}
            <span className="hover:text-muted-foreground cursor-pointer">Privacy Policy</span>
          </p>
        </div>
      </motion.div>

      {/* ── Right: Feature Preview ── */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0c1445 100%)" }}>
        {/* Animated blobs */}
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,0.4) 0%, transparent 70%)" }}
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute bottom-[-15%] left-[10%] w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(37,99,235,0.35) 0%, transparent 70%)" }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-16 py-12 w-full">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full mb-6 self-start"
            style={{ backgroundColor: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <Sparkles className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.7)" }}>
              New Features
            </span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-3xl font-bold mb-3 leading-tight"
            style={{ color: "#ffffff" }}
          >
            Your business,<br />fully connected
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.48 }}
            className="text-sm mb-10 leading-relaxed max-w-xs"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            Manage deals, clients, projects and revenue from a single unified platform.
          </motion.p>

          {/* Metric cards grid */}
          <div className="grid grid-cols-2 gap-4 mb-10 max-w-md">
            {PREVIEW_CARDS.map((card, i) => (
              <PreviewCard key={card.title} card={card} delay={0.5 + i * 0.1} />
            ))}
          </div>

          {/* Feature list */}
          <motion.ul
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.9 } } }}
            className="space-y-2.5"
          >
            {FEATURES.map(({ icon: Icon, label }) => (
              <motion.li
                key={label}
                variants={{ hidden: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0 } }}
                className="flex items-center gap-3"
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: "#93c5fd" }} />
                </div>
                <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.75)" }}>{label}</span>
              </motion.li>
            ))}
          </motion.ul>

          {/* Trust indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4 }}
            className="mt-12 flex items-center gap-4"
          >
            <div className="flex -space-x-2">
              {["#f472b6", "#60a5fa", "#34d399", "#fbbf24"].map((bg, i) => (
                <div key={i} className="w-7 h-7 rounded-full border-2 text-[9px] font-bold flex items-center justify-center text-white" style={{ backgroundColor: bg, borderColor: "#0f172a" }}>
                  {["J","K","M","L"][i]}
                </div>
              ))}
            </div>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              Trusted by <span className="font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>2,400+</span> teams worldwide
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
