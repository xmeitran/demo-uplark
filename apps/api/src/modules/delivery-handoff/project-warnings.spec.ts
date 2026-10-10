import { describe, expect, it, vi } from "vitest";
import { isSuppressedByManualClose, MANUAL_CLOSE_ACTION, openOrRefreshProjectWarning, REARM_ACTION } from "./project-warnings";

describe("manual warning closure", () => {
  it("keeps a manually closed warning closed until its cause has cleared once", () => {
    expect(isSuppressedByManualClose({ status: "closed", events: [{ action: "opened" }, { action: MANUAL_CLOSE_ACTION }] })).toBe(true);
    expect(isSuppressedByManualClose({ status: "closed", events: [{ action: "opened" }, { action: MANUAL_CLOSE_ACTION }, { action: REARM_ACTION }] })).toBe(false);
  });

  it("does not suppress after an automatic closure, for an open warning, or without history", () => {
    expect(isSuppressedByManualClose({ status: "closed", events: [{ action: "opened" }, { action: "closed" }] })).toBe(false);
    expect(isSuppressedByManualClose({ status: "open", events: [{ action: MANUAL_CLOSE_ACTION }] })).toBe(false);
    expect(isSuppressedByManualClose(null)).toBe(false);
  });
});

describe("openOrRefreshProjectWarning under concurrency", () => {
  const input = { workspaceId: "twk-1", projectId: "prj-1", dedupeKey: "NL-03:task:t1", typeCode: "NL-03", title: "Task chưa có người phụ trách" };

  it("takes the per-key lock before looking for an open warning", async () => {
    const calls: string[] = [];
    const client = {
      $queryRaw: vi.fn(async () => { calls.push("lock"); return []; }),
      projectWarning: { findFirst: vi.fn(async () => { calls.push("find"); return null; }), create: vi.fn(async () => ({ id: "w1" })) }
    };
    await expect(openOrRefreshProjectWarning(client, input)).resolves.toEqual({ id: "w1" });
    expect(calls).toEqual(["lock", "find"]);
  });

  it("treats a unique violation on the open-warning index as already open", async () => {
    const client = { projectWarning: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockRejectedValue({ code: "P2002" }) } };
    await expect(openOrRefreshProjectWarning(client, input)).resolves.toBeNull();
    client.projectWarning.create.mockRejectedValue(new Error("boom"));
    await expect(openOrRefreshProjectWarning(client, input)).rejects.toThrow("boom");
  });
});
