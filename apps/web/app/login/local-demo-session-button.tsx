"use client";

import { useState } from "react";

export function LocalDemoSessionButton({ returnTo }: Readonly<{ returnTo: string }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDemoSession() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/demo/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "usr-kha-founder", tenantKey: "pilot" })
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "Chưa tạo được phiên founder local.");
      }
      window.location.assign(returnTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chưa tạo được phiên founder local.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-dev-access">
      <button className="login-secondary-action" disabled={busy} type="button" onClick={createDemoSession}>
        {busy ? "Đang tạo phiên..." : "Dùng phiên founder local"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
