"use client";

import { formatVnd } from "@/lib/currency";

/** Presentation only: show the exact VND amount wherever the shared money component is used. */
export function MoneyAmount({ value, className }: { value: number | null | undefined; className?: string }) {
  const exact = formatVnd(value);
  return <span className={className} title={exact}>{exact}</span>;
}
