"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { primaryAuthRole } from "./auth-role";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id?: string;
  name: string;
  email: string;
  initials: string;
  avatarColor: string; // hex
  avatarUrl?: string;
  role: string;
  roleCodes?: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue>({ user: null, isLoading: true, refresh: async () => {}, logout: async () => {} });
const PUBLIC_AUTH_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"]);

interface SessionPrincipal {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  roleCodes?: string[];
  subjectId?: string;
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "B2B";
}

function authUserFromPrincipal(principal: SessionPrincipal): AuthUser {
  const name = principal.displayName?.trim() || "Workspace User";
  return {
    name,
    id: principal.subjectId,
    email: principal.email ?? principal.subjectId ?? "",
    initials: initialsFromName(name),
    avatarColor: "#059669",
    avatarUrl: principal.avatarUrl,
    role: primaryAuthRole(principal.roleCodes),
    roleCodes: principal.roleCodes ?? []
  };
}

const LOCAL_AUTO_AUTH_ENABLED = (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_LOCAL_AUTO_AUTH === "true") || process.env.NEXT_PUBLIC_STAGING_BYPASS_AUTH === "true";
const LOCAL_FOUNDER_USER = authUserFromPrincipal({
  subjectId: "local-founder",
  displayName: "Founder Local",
  email: "local-founder@localhost",
  roleCodes: ["FOUNDER_GM"]
});

async function fetchSessionUser() {
  const response = await fetch("/api/auth/me", {
    cache: "no-store",
    credentials: "same-origin"
  });

  if (!response.ok) {
    if ((process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_LOCAL_AUTO_AUTH === "true") || process.env.NEXT_PUBLIC_STAGING_BYPASS_AUTH === "true") {
      return authUserFromPrincipal({
        subjectId: "local-founder",
        displayName: "Founder Local",
        email: "local-founder@localhost",
        roleCodes: ["FOUNDER_GM"]
      });
    }
    return null;
  }

  return authUserFromPrincipal((await response.json()) as SessionPrincipal);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]           = useState<AuthUser | null>(() => LOCAL_AUTO_AUTH_ENABLED ? LOCAL_FOUNDER_USER : null);
  const [isLoading, setIsLoading] = useState(!LOCAL_AUTO_AUTH_ENABLED);
  const router   = useRouter();
  const pathname = usePathname();
  const logoutInFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => { setUser(await fetchSessionUser()); }, []);

  useEffect(() => {
    if (LOCAL_AUTO_AUTH_ENABLED) {
      let mounted = true;
      // Local mode bypasses the login wall, but still resolves the real
      // founder principal so header, settings, audit and API data use one
      // identity instead of mixing a fake display profile with live data.
      fetchSessionUser().then(value => { if (mounted) setUser(value); })
        .catch(() => { if (mounted) setUser(LOCAL_FOUNDER_USER); })
        .finally(() => { if (mounted) setIsLoading(false); });
      setIsLoading(false);
      return;
    }
    let mounted = true;
    // Remove the former UI-only identity cache. It is never an authentication source.
    localStorage.removeItem("crm_auth_user");
    fetchSessionUser().then(value => { if (mounted) setUser(value); })
      .catch(() => { if (mounted) setUser(null); })
      .finally(() => { if (mounted) setIsLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!isLoading && !user && !PUBLIC_AUTH_PATHS.has(pathname) && !LOCAL_AUTO_AUTH_ENABLED) {
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
    }
  }, [user, isLoading, pathname, router]);

  const logout = useCallback(() => {
    if (logoutInFlight.current) return logoutInFlight.current;

    const operation = (async () => {
      localStorage.removeItem("crm_auth_user");
      setIsLoading(true);

      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/auth/session/logout";
      form.hidden = true;
      document.body.appendChild(form);
      form.submit();
    })();

    logoutInFlight.current = operation;
    return operation;
  }, []);

  // ── Loading screen ─────────────────────────────────────────────────────────
  // Block rendering the entire app until we know auth state.
  // This eliminates the race condition where Effect 2 fires before Effect 1
  // has finished reading localStorage and setting the user.
  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--color-background, #0f172a)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: "3px solid rgba(37,99,235,0.2)",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
              margin: "0 auto 12px",
            }}
          />
          <p style={{ fontSize: 12, color: "#64748b", fontFamily: "var(--font-sans)" }}>
            Loading workspace...
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  return useContext(AuthContext);
}
