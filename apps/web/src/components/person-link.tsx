"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { isAdminView } from "@/lib/auth-role";
import { UserAvatar } from "@/components/user-avatar";

/**
 * Links a person's name to their profile. The profile API is admin-only, so
 * every other viewer gets the plain name instead of a link to a 403 page.
 * `avatar` puts their face before the name (for spots that do not draw one beside it already).
 */
export function PersonLink({ userId, className, title, children, avatar, avatarUrl }: Readonly<{ userId?: string | null; className?: string; title?: string; children: ReactNode; avatar?: boolean; avatarUrl?: string | null }>) {
  const { user } = useAuth();
  const canOpen = Boolean(userId) && isAdminView(user);
  const content = avatar ? <><UserAvatar id={userId} name={typeof children === "string" ? children : title} avatarUrl={avatarUrl} size="xs" className="mr-1.5 align-middle" />{children}</> : children;
  if (!canOpen || !userId) return <span className={className} title={title}>{content}</span>;
  return <Link href={`/users/${encodeURIComponent(userId)}`} className={className} title={title}>{content}</Link>;
}
