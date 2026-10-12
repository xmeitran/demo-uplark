/**
 * 7.6 configuration parameters — the one reader for the API.
 *
 *   getParameter("standardDayHours")                 -> the document's default, synchronously
 *   getParameter("standardDayHours", values)         -> the value out of a loaded set
 *   await loadParameters(client, workspaceId)        -> every parameter as stored for the workspace (defaults filled in)
 *   await getStoredParameter(client, workspaceId, k) -> one stored parameter
 *
 * Storage is append-only (SystemParameter): the newest row of a key is its value, older rows are its history;
 * a row whose value is JSON null means "reset to default".
 */
import {
  SYSTEM_PARAMETERS,
  SYSTEM_PARAMETER_KEYS,
  isSystemParameterKey,
  systemParameterDefaults,
  validateSystemParameter,
  type SystemParameterKey,
  type SystemParameterValues
} from "@b2b-crm/contracts";

export { SYSTEM_PARAMETERS, SYSTEM_PARAMETER_KEYS, isSystemParameterKey, systemParameterDefaults, validateSystemParameter };
export type { SystemParameterKey, SystemParameterValues };

/** Synchronous: the default, or the entry of an already loaded set. */
export function getParameter<K extends SystemParameterKey>(key: K, values?: Partial<SystemParameterValues>): SystemParameterValues[K] {
  const loaded = values?.[key];
  return (loaded !== undefined ? loaded : structuredClone(SYSTEM_PARAMETERS[key].defaultValue)) as SystemParameterValues[K];
}

/** "Giờ chuẩn một ngày" in minutes. */
export function standardDayMinutes(values?: Partial<SystemParameterValues>): number {
  return Math.round(getParameter("standardDayHours", values) * 60);
}

// Unit specs mock only the Prisma models they exercise; without the model every parameter is its default.
function hasParameterModel(client: any) {
  return typeof client?.systemParameter?.findMany === "function";
}

export interface StoredParameterRow {
  key: string;
  value: unknown;
  updatedByUserId: string | null;
  updatedByName: string | null;
  createdAt: Date;
}

/** Newest row per key (parameters and other keys such as the trigger overrides). */
export async function loadLatestParameterRows(client: any, workspaceId: string, keys?: readonly string[]): Promise<Map<string, StoredParameterRow>> {
  if (!hasParameterModel(client)) return new Map();
  const rows: StoredParameterRow[] = await client.systemParameter.findMany({
    where: { workspaceId, ...(keys ? { key: { in: [...keys] } } : {}) },
    orderBy: [{ key: "asc" }, { createdAt: "desc" }],
    distinct: ["key"]
  });
  return new Map(rows.map((row) => [row.key, row]));
}

/** A stored value that no longer validates (the catalogue changed) falls back to the default instead of breaking readers. */
function storedValue<K extends SystemParameterKey>(key: K, row: StoredParameterRow | undefined): SystemParameterValues[K] {
  if (!row || row.value === null || row.value === undefined) return getParameter(key);
  try {
    return validateSystemParameter(key, row.value);
  } catch {
    return getParameter(key);
  }
}

export async function loadParameters(client: any, workspaceId: string): Promise<SystemParameterValues> {
  const rows = await loadLatestParameterRows(client, workspaceId, SYSTEM_PARAMETER_KEYS);
  return Object.fromEntries(SYSTEM_PARAMETER_KEYS.map((key) => [key, storedValue(key, rows.get(key))])) as SystemParameterValues;
}

export async function getStoredParameter<K extends SystemParameterKey>(client: any, workspaceId: string, key: K): Promise<SystemParameterValues[K]> {
  return storedValue(key, (await loadLatestParameterRows(client, workspaceId, [key])).get(key));
}

/** The three parameters P&L reads, in the shape `readPnlParameters(overrides)` of resource-controls/pnl-rules.ts takes. */
export async function loadPnlParameterOverrides(client: any, workspaceId: string) {
  const rows = await loadLatestParameterRows(client, workspaceId, ["standardDayHours", "pnlCloseGate", "pendingHoursWorkingDays"]);
  return {
    standardDayMinutes: Math.round(storedValue("standardDayHours", rows.get("standardDayHours")) * 60),
    pnlCloseGate: storedValue("pnlCloseGate", rows.get("pnlCloseGate")),
    pendingDeadlineWorkingDays: storedValue("pendingHoursWorkingDays", rows.get("pendingHoursWorkingDays"))
  };
}
