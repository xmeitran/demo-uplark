import { getPushedProjectsOwnerKey } from "@/lib/frontend-data-store";

/**
 * Filters kept between visits, per signed-in person and per page, in this browser's localStorage.
 * Blocked or full storage and unreadable values never break a page: the filter's default is used instead.
 */
const FILTER_STORAGE_PREFIX = "crm_filters";

export function filterStorageKey(owner: { id?: string | null; email?: string | null } | null | undefined, scope: string) {
  return `${FILTER_STORAGE_PREFIX}:${encodeURIComponent(getPushedProjectsOwnerKey(owner).toLowerCase())}:${scope}`;
}

/** `stored` when it has the shape of `fallback` (objects field by field, lists of strings or numbers), else `fallback`. */
export function sanitizeStoredFilter<T>(stored: unknown, fallback: T): T {
  if (Array.isArray(fallback)) {
    return (Array.isArray(stored) && stored.every((item) => typeof item === "string" || typeof item === "number") ? stored : fallback) as T;
  }
  if (fallback !== null && typeof fallback === "object") {
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return fallback;
    const record = stored as Record<string, unknown>;
    return Object.fromEntries(Object.entries(fallback).map(([name, value]) => [name, sanitizeStoredFilter(record[name], value)])) as T;
  }
  return (typeof stored === typeof fallback ? stored : fallback) as T;
}

export function readStoredFilter<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : sanitizeStoredFilter(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

/** The default is never stored, so setting a filter back to it ("Đặt lại") removes what was kept. */
export function writeStoredFilter<T>(key: string, value: T, fallback: T) {
  try {
    const json = JSON.stringify(value);
    if (json === JSON.stringify(fallback)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, json);
  } catch {
    // Private window, blocked or full storage: the filter still works until the page is left.
  }
}

/** The filter part of a URL query: every parameter except those in `except` (returnTo, dialogs…). */
export function filterQuery(search: string, except: readonly string[]) {
  return new URLSearchParams([...new URLSearchParams(search)].filter(([name]) => !except.includes(name))).toString();
}

/** The query to reopen a page with: null when its URL already filters or nothing was kept, else the URL plus the kept filters. */
export function withKeptFilters(search: string, kept: string, except: readonly string[]) {
  if (!kept || filterQuery(search, except)) return null;
  const params = new URLSearchParams(search);
  for (const [name, value] of new URLSearchParams(kept)) {
    if (!except.includes(name)) params.append(name, value);
  }
  return params.toString();
}
