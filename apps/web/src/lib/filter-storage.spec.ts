import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PROJECT_TASK_FILTERS } from "@/features/project-hierarchy/task-filters";
import { filterQuery, filterStorageKey, readStoredFilter, sanitizeStoredFilter, withKeptFilters, writeStoredFilter } from "./filter-storage";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key)
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("filterStorageKey", () => {
  it("keeps one entry per person and per page", () => {
    const kha = filterStorageKey({ id: "usr-kha" }, "project:p1:tasks");
    expect(kha).toBe("crm_filters:usr-kha:project:p1:tasks");
    expect(filterStorageKey({ id: "usr-mai" }, "project:p1:tasks")).not.toBe(kha);
    expect(filterStorageKey({ id: "usr-kha" }, "project:p2:tasks")).not.toBe(kha);
    expect(filterStorageKey({ email: "Mai@UpBase.asia" }, "users:search")).toBe("crm_filters:mai%40upbase.asia:users:search");
    expect(filterStorageKey(null, "users:search")).toBe("crm_filters:anonymous:users:search");
  });
});

describe("sanitizeStoredFilter", () => {
  it("keeps a value with the default's shape", () => {
    const stored = { ...EMPTY_PROJECT_TASK_FILTERS, query: "brief", due: { from: "2026-10-01", to: "2026-10-31" }, assigneeIds: ["u1", "u2"] };
    expect(sanitizeStoredFilter(stored, EMPTY_PROJECT_TASK_FILTERS)).toEqual(stored);
    expect(sanitizeStoredFilter(2025, 2026)).toBe(2025);
    expect(sanitizeStoredFilter(true, false)).toBe(true);
  });

  it("falls back to the default, field by field, for anything else", () => {
    expect(sanitizeStoredFilter("x", [])).toEqual([]);
    expect(sanitizeStoredFilter([{ id: 1 }], [])).toEqual([]);
    expect(sanitizeStoredFilter(["a"], "")).toBe("");
    expect(sanitizeStoredFilter(null, { from: "", to: "" })).toEqual({ from: "", to: "" });
    expect(sanitizeStoredFilter({ query: 5, due: "soon", statuses: ["todo"], extra: 1 }, EMPTY_PROJECT_TASK_FILTERS))
      .toEqual({ ...EMPTY_PROJECT_TASK_FILTERS, statuses: ["todo"] });
  });
});

describe("readStoredFilter / writeStoredFilter", () => {
  it("round-trips a filter and forgets it once it is back to the default", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    writeStoredFilter("k", ["u1"], []);
    expect(storage.items.get("k")).toBe('["u1"]');
    expect(readStoredFilter("k", [])).toEqual(["u1"]);
    writeStoredFilter("k", [], []);
    expect(storage.items.has("k")).toBe(false);
    expect(readStoredFilter("k", ["default"])).toEqual(["default"]);
  });

  it("returns the default for unreadable data or unavailable storage", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.items.set("k", "{not json");
    expect(readStoredFilter("k", "")).toBe("");
    const blocked = () => { throw new Error("SecurityError"); };
    vi.stubGlobal("window", { localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    expect(readStoredFilter("k", [])).toEqual([]);
    expect(() => writeStoredFilter("k", ["u1"], [])).not.toThrow();
    vi.unstubAllGlobals();
    expect(readStoredFilter("k", "fallback")).toBe("fallback");
  });
});

describe("URL filters", () => {
  const except = ["returnTo", "create"];

  it("keeps only the filter parameters", () => {
    expect(filterQuery("q=abc&returnTo=%2Fprojects&status=active", except)).toBe("q=abc&status=active");
    expect(filterQuery("returnTo=%2Fprojects", except)).toBe("");
  });

  it("puts the kept filters back only when the page is opened without any", () => {
    expect(withKeptFilters("", "q=abc&status=active", except)).toBe("q=abc&status=active");
    expect(withKeptFilters("returnTo=%2Fpnl", "fromMonth=2026-01", except)).toBe("returnTo=%2Fpnl&fromMonth=2026-01");
    expect(withKeptFilters("q=new", "q=abc", except)).toBeNull();
    expect(withKeptFilters("", "", except)).toBeNull();
    expect(withKeptFilters("", "create=1&q=abc", except)).toBe("q=abc");
  });
});
