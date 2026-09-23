export const PROJECTS_STORAGE_KEY = "all_projects";
export const CLIENTS_STORAGE_KEY = "all_clients";
export const PUSHED_PROJECTS_STORAGE_KEY = "pushed_projects";
export const FRONTEND_STORE_EVENT = "constructor_x_frontend_store_changed";
export const LEGACY_PROJECTS_EVENT = "pushed_projects_changed";

type StoreEntity = "projects" | "clients" | "users" | "tasks" | "pushed-projects";

interface ReadStoredArrayOptions {
  seed?: boolean;
}

export function readStoredArray<T>(key: string, fallback: T[], options: ReadStoredArrayOptions = {}): T[] {
  const { seed = true } = options;
  if (typeof window === "undefined") return fallback;

  const stored = window.localStorage.getItem(key);
  if (!stored) {
    if (seed) {
      window.localStorage.setItem(key, JSON.stringify(fallback));
    }
    return fallback;
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredArray<T>(key: string, value: T[], entity: StoreEntity) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  notifyFrontendStoreChanged(entity);
}

interface PushedProjectsOwner {
  id?: string | null;
  email?: string | null;
}

export function getPushedProjectsOwnerKey(owner?: PushedProjectsOwner | null) {
  return owner?.id?.trim() || owner?.email?.trim().toLowerCase() || "anonymous";
}

export function getPushedProjectsStorageKey(ownerKey?: string | null) {
  const normalized = (ownerKey?.trim() || "anonymous").toLowerCase();
  return `${PUSHED_PROJECTS_STORAGE_KEY}:${encodeURIComponent(normalized)}`;
}

function normalizePushedProjectIds(value: string[]) {
  return Array.from(new Set(value.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())));
}

export function readPushedProjectIds(ownerKey?: string | null) {
  return normalizePushedProjectIds(
    readStoredArray<string>(getPushedProjectsStorageKey(ownerKey), [], { seed: false })
  );
}

export function writePushedProjectIds(value: string[], ownerKey?: string | null) {
  writeStoredArray(getPushedProjectsStorageKey(ownerKey), normalizePushedProjectIds(value), "pushed-projects");
}

export function notifyFrontendStoreChanged(entity: StoreEntity) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FRONTEND_STORE_EVENT, { detail: { entity } }));

  if (entity === "projects" || entity === "pushed-projects") {
    window.dispatchEvent(new Event(LEGACY_PROJECTS_EVENT));
  }
}
