"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { resolveBackHref } from "./page-header-back";

export { resolveBackHref };

/** Standard padding and scrolling of a page's <main>. */
export const pageMainClassName = "min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4 xl:p-6";

/**
 * The header every page opens with: optional "Quay lại …" link, title, subtitle, and on the right
 * `meta` (small muted text) and `actions` (HeaderButton / HeaderLinkButton).
 */
export function PageHeader({ title, subtitle, back, meta, actions, className = "" }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  // Read after mount: useSearchParams would force a Suspense boundary onto every page.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => setReturnTo(new URLSearchParams(window.location.search).get("returnTo")), []);
  const backLabel = back ? `Quay lại ${back.label}` : "";

  return (
    <div className={`flex shrink-0 flex-col items-start justify-between gap-3 sm:flex-row sm:items-center ${className}`}>
      <div className="min-w-0">
        {back ? (
          <Link href={resolveBackHref(back.href, returnTo)} aria-label={backLabel} className="!mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold !text-muted-foreground transition-colors hover:!text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />{backLabel}
          </Link>
        ) : null}
        {/* No size utility: the global h1 rule sets the size the Projects header is liked for. */}
        <h1 className="font-bold text-foreground">{title}</h1>
        {subtitle ? <p className="!mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {meta || actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** The header's "Quay lại …" link on its own, for a detail page that keeps its own title card. `href` is used as given. */
export function PageBackLink({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  const backLabel = `Quay lại ${label}`;
  return (
    <Link href={href} aria-label={backLabel} className={`inline-flex items-center gap-1.5 text-xs font-semibold !text-muted-foreground transition-colors hover:!text-foreground ${className}`}>
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />{backLabel}
    </Link>
  );
}

// `!` on size and weight: the global `button { font: inherit }` rule would otherwise make a <button> lighter than the same <a>.
const BUTTON_CLASS = {
  primary: "flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 !text-sm !font-semibold !text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50",
  secondary: "flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 !text-sm !font-medium !text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
};
type HeaderButtonLook = { variant?: "primary" | "secondary"; icon?: React.ReactNode };

export function HeaderButton({ variant = "secondary", icon, children, className = "", type = "button", ...props }: HeaderButtonLook & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`${BUTTON_CLASS[variant]} ${className}`} {...props}>{icon}{children}</button>;
}

export function HeaderLinkButton({ variant = "secondary", icon, children, className = "", ...props }: HeaderButtonLook & React.ComponentProps<typeof Link>) {
  return <Link className={`${BUTTON_CLASS[variant]} ${className}`} {...props}>{icon}{children}</Link>;
}
