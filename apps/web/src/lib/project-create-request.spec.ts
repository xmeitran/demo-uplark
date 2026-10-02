import { describe, expect, it, vi } from "vitest";
import { postProject, type ProjectCreateAttempt } from "./project-create-request";
import { fetchProjectPeople } from "./project-people";
describe("project mutation receipts and canonical people", () => {
  it("reuses receipt after a lost response and rotates only for a different payload", async () => {
    const attempt: ProjectCreateAttempt = {};
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValue(new Response("{}"));
    await expect(postProject(attempt, { name: "Project" }, fetcher)).rejects.toThrow("lost response");
    const first = attempt.key;
    await postProject(attempt, { name: "Project" }, fetcher);
    expect(attempt.key).toBe(first);
    expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).toBe(first);
    await postProject(attempt, { name: "Changed" }, fetcher);
    expect(attempt.key).not.toBe(first);
  });
  it("loads every member page and retains distinct IDs with identical names", async () => {
    const page = (userId: string, offset: number, hasNextPage: boolean) => new Response(JSON.stringify({ data: [{ userId, displayName: "Same name", email: `${userId}@example.com`, roleCodes: [], status: "active" }], meta: { principalUserId: "one", permissions: { canManage: true, canLogForOthers: false }, pagination: { offset, returned: 1, hasNextPage } } }));
    const fetcher = vi.fn().mockResolvedValueOnce(page("one", 0, true)).mockResolvedValueOnce(page("two", 1, false));
    const result = await fetchProjectPeople("project", undefined, fetcher);
    expect(result.members.map(member => member.id)).toEqual(["one", "two"]);
    expect(fetcher.mock.calls[1][0]).toContain("offset=1");
    expect(result.permissions.canLogForOthers).toBe(false);
  });
  it("rejects failed member pages rather than exposing a partial picker", async () => {
    await expect(fetchProjectPeople("p", undefined, vi.fn().mockResolvedValue(new Response("{}", { status: 503 })))).rejects.toThrow("503");
  });
  it("keeps safe permission defaults when a legacy member response omits permissions", async () => {
    const response = new Response(JSON.stringify({
      data: [],
      meta: {
        principalUserId: "one",
        pagination: { offset: 0, returned: 0, hasNextPage: false }
      }
    }));
    await expect(fetchProjectPeople("project", undefined, vi.fn().mockResolvedValue(response))).resolves.toMatchObject({
      principalUserId: "one",
      permissions: { canManage: false, canLogForOthers: false }
    });
  });
  it("fails closed when a paginated member response cannot advance", async () => {
    const response = new Response(JSON.stringify({
      data: [],
      meta: {
        pagination: { offset: 0, returned: 0, hasNextPage: true }
      }
    }));
    await expect(fetchProjectPeople("project", undefined, vi.fn().mockResolvedValue(response))).rejects.toThrow("pagination did not advance");
  });
  it("treats a null member payload as an empty, safe response", async () => {
    await expect(fetchProjectPeople("project", undefined, vi.fn().mockResolvedValue(new Response("null")))).resolves.toEqual({
      members: [],
      principalUserId: "",
      permissions: { canManage: false, canLogForOthers: false }
    });
  });
});
