"use client";

import { useState } from "react";
import { avatarColorFor, avatarInitialsFor, useWorkspaceAvatars } from "@/lib/workspace-users";

const SIZES = { xs: "h-5 w-5 text-[8px]", sm: "h-6 w-6 text-[9px]", md: "h-8 w-8 text-[10px]", lg: "h-10 w-10 text-xs" } as const;

/**
 * A person's face: their photo when the row carries one or the workspace directory knows it (by id, email or name),
 * initials on their colour otherwise, or when the photo fails to load.
 */
export function UserAvatar({ id, email, name, avatarUrl, initials, size = "sm", className = "" }: Readonly<{ id?: string | null; email?: string | null; name?: string | null; avatarUrl?: string | null; initials?: string; size?: keyof typeof SIZES; className?: string }>) {
  const lookup = useWorkspaceAvatars();
  const [failed, setFailed] = useState<string>();
  const label = name || email || "";
  const src = avatarUrl || lookup({ id: id ?? undefined, email: email ?? undefined, name: name ?? undefined });
  return (
    <span
      className={`${SIZES[size]} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${className}`}
      style={{ backgroundColor: avatarColorFor(id || email || label) }}
      title={label || undefined}
      aria-hidden
    >
      {src && failed !== src ? <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setFailed(src)} /> : initials || avatarInitialsFor(label)}
    </span>
  );
}
