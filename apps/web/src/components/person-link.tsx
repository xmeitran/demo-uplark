"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Links a person's name to their profile. The profile API is admin-only, so
 * every other viewer gets the plain name instead of a link to a 403 page.
 */
export function PersonLink({ userId, className, title, children }: Readonly<{ userId?: string | null; className?: string; title?: string; children: ReactNode }>) {
  const { user } = useAuth();
  const canOpen = Boolean(userId && user?.roleCodes?.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN"));
  if (!canOpen || !userId) return <span className={className} title={title}>{children}</span>;
  return <Link href={`/users/${encodeURIComponent(userId)}`} className={className} title={title}>{children}</Link>;
}
