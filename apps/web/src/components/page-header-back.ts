// Kept out of page-header.tsx so the vitest spec (node, no JSX transform) can import it.

/** Where "Quay lại" goes: the `returnTo` query value when it is a same-origin path, otherwise `fallback`. */
export function resolveBackHref(fallback: string, returnTo?: string | null): string {
  return returnTo && /^\/(?![/\\])/.test(returnTo) ? returnTo : fallback;
}
