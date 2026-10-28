"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { filterQuery, filterStorageKey, readStoredFilter, withKeptFilters, writeStoredFilter } from "@/lib/filter-storage";

/**
 * useState for a filter the signed-in person finds again on their next visit (same browser).
 * `scope` names the page, the project or person when the page shows one, and the filter: `project:${id}:tasks`.
 */
export function usePersistedFilter<T>(scope: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const { user } = useAuth();
  const key = filterStorageKey(user, scope);
  // AuthProvider renders pages only once the session is known, so the first render may read storage (no server markup to match).
  const [state, setState] = useState(() => ({ key, initial, value: readStoredFilter(key, initial) }));
  // Another project or person on the same mounted page: show what was kept for it.
  const current = state.key === key ? state : { key, initial, value: readStoredFilter(key, initial) };
  if (current !== state) setState(current);
  useEffect(() => writeStoredFilter(state.key, state.value, state.initial), [state]);
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => setState((previous) => ({
    ...previous,
    value: typeof next === "function" ? (next as (value: T) => T)(previous.value) : next
  })), []);
  return [current.value, set];
}

/**
 * For a page whose filters live in its URL: keeps them for the signed-in person and, when the page is opened
 * without any (menu, "Quay lại"), puts the kept ones back. `except` lists the parameters that are not filters.
 */
export function useRememberedQuery(scope: string, except: readonly string[] = ["returnTo"]) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = filterStorageKey(user, scope);
  const exceptList = except.join(",");
  const checkedKey = useRef<string | null>(null);
  useEffect(() => {
    const names = exceptList.split(",");
    if (checkedKey.current !== key) {
      checkedKey.current = key;
      const restored = withKeptFilters(search, readStoredFilter(key, ""), names);
      if (restored !== null) {
        router.replace(`${pathname}?${restored}`, { scroll: false });
        return;
      }
    }
    writeStoredFilter(key, filterQuery(search, names), "");
  }, [exceptList, key, pathname, router, search]);
}
