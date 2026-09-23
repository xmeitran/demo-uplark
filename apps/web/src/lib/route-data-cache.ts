type RouteDataEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const routeDataCache = new Map<string, RouteDataEntry<unknown>>();

export function prefetchRouteDataJson(url: string, ttlMs = 10000) {
  void loadRouteDataJson(url, ttlMs).catch(() => {
    routeDataCache.delete(url);
  });
}

export async function loadRouteDataJson<T>(url: string, ttlMs = 10000): Promise<T> {
  const now = Date.now();
  const existing = routeDataCache.get(url);
  if (existing && existing.expiresAt > now) {
    return existing.promise as Promise<T>;
  }

  const promise = fetch(url, { cache: "default", credentials: "same-origin" }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Route data request failed (${response.status})`);
    }
    return (await response.json()) as T;
  });

  routeDataCache.set(url, {
    expiresAt: now + ttlMs,
    promise
  });

  promise
    .catch(() => {
      routeDataCache.delete(url);
    })
    .finally(() => {
      if (typeof window === "undefined") {
        return;
      }
      window.setTimeout(() => {
        const current = routeDataCache.get(url);
        if (current?.promise === promise) {
          routeDataCache.delete(url);
        }
      }, ttlMs);
    });

  return promise;
}
