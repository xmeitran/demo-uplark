import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_PROJECT_SNAPSHOT_TTL_MS,
  clearLiveProjectSnapshotCache,
  fetchAccountOptions,
  fetchLiveProjectById,
  fetchLiveProjects,
  mapProjectSummaryToUiProject
} from "../../app/projects/live-projects";

const cachedProjectSummary = {
  id: "proj-cache",
  accountId: "acc-cache",
  accountName: "Cache Account",
  code: "PRJ-CACHE",
  name: "Cached Project",
  status: "in_progress",
  progressPercent: 40,
  taskCount: 5,
  completedTaskCount: 2,
  stageCount: 2
};

describe("live project query params", () => {
  afterEach(() => {
    clearLiveProjectSnapshotCache();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces same-scope project detail requests and serves the short-lived snapshot", async () => {
    let releaseRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      releaseRequest = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-cache" });
    const second = fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-cache" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseRequest?.(new Response(JSON.stringify(cachedProjectSummary), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ id: cachedProjectSummary.id }),
      expect.objectContaining({ id: cachedProjectSummary.id })
    ]);
    await expect(fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-cache" }))
      .resolves.toEqual(expect.objectContaining({ name: "Cached Project" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cancel the shared request when one caller aborts", async () => {
    let releaseRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      releaseRequest = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const abortedCaller = fetchLiveProjectById(cachedProjectSummary.id, {
      cacheScope: "usr-cache",
      signal: controller.signal
    });
    const activeCaller = fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-cache" });
    const abortedExpectation = expect(abortedCaller).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    releaseRequest?.(new Response(JSON.stringify(cachedProjectSummary), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));

    await abortedExpectation;
    await expect(activeCaller).resolves.toEqual(expect.objectContaining({ id: cachedProjectSummary.id }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expires project snapshots after the short document-local TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(cachedProjectSummary), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-cache" });
    await fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-cache" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(LIVE_PROJECT_SNAPSHOT_TTL_MS + 1);
    await fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-cache" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not share project snapshots across user scopes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(cachedProjectSummary), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-a" });
    await fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-b" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("primes project detail snapshots from list results in the same user scope", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [cachedProjectSummary],
      meta: {
        pagination: {
          limit: 10,
          offset: 0,
          returned: 1,
          total: 1,
          hasNextPage: false,
          hasPreviousPage: false
        }
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveProjects({ limit: 10, cacheScope: "usr-cache" });
    await expect(fetchLiveProjectById(cachedProjectSummary.id, { cacheScope: "usr-cache" }))
      .resolves.toEqual(expect.objectContaining({ id: cachedProjectSummary.id }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pushes search, status, and category filters into the API query before pagination", async () => {
    let requestedUrl = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            pagination: {
              limit: 10,
              offset: 10,
              returned: 0,
              total: 0,
              hasNextPage: false,
              hasPreviousPage: true
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveProjects({
      limit: 10,
      offset: 10,
      q: "AMOBEAR",
      status: "Active",
      category: "Implementation"
    });

    expect(requestedUrl).toBe("/api/projects?limit=10&offset=10&q=AMOBEAR&status=in_progress&category=Implementation");
  });

  it("keeps the On Hold UI filter on the canonical project status query param", async () => {
    let requestedUrl = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            pagination: {
              limit: 10,
              offset: 0,
              returned: 0,
              total: 0,
              hasNextPage: false,
              hasPreviousPage: false
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveProjects({
      limit: 10,
      offset: 0,
      status: "On Hold"
    });

    expect(requestedUrl).toBe("/api/projects?limit=10&offset=0&status=on_hold");
  });

  it("loads client options from the CRM account list instead of project rows", async () => {
    let requestedUrl = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [
            { id: "acc-2", code: "A2", name: "Zeta Client", stage: "active", ownerTeam: "Delivery", health: "green" },
            { id: "acc-1", code: "A1", name: "Alpha Client", stage: "active", ownerTeam: "Delivery", health: "green" }
          ],
          meta: { principal: "founder", rowScope: "workspace", hiddenFields: [] }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAccountOptions()).resolves.toEqual([
      { value: "Alpha Client", label: "Alpha Client", accountId: "acc-1" },
      { value: "Zeta Client", label: "Zeta Client", accountId: "acc-2" }
    ]);
    expect(requestedUrl).toBe("/api/accounts?limit=100");
  });

  it("formats backend project statuses before exposing them as UI tags", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "proj-status-label",
              accountId: "acc-status-label",
              accountName: "Status Label Account",
              code: "PRJ-RAW",
              name: "Status Label Project",
              status: "in_progress",
              progressPercent: 20,
              taskCount: 0,
              completedTaskCount: 0,
              stageCount: 0
            }
          ],
          meta: {
            pagination: {
              limit: 10,
              offset: 0,
              returned: 1,
              total: 1,
              hasNextPage: false,
              hasPreviousPage: false
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLiveProjects({ limit: 10, offset: 0 });

    expect(result.projects[0]?.tags).toEqual(["PRJ-RAW", "In progress"]);
    expect(result.projects[0]?.tags).not.toContain("in_progress");
  });

  it("dedupes live project members by user identity while preserving real avatars", () => {
    const project = mapProjectSummaryToUiProject({
      id: "proj-dedupe-member",
      accountId: "acc-dedupe",
      accountName: "Dedupe Account",
      code: "PRJ-DEDUP",
      hierarchyOrderVersion: 0,
      name: "Dedupe Project",
      status: "in_progress",
      progressPercent: 10,
      taskCount: 0,
      completedTaskCount: 0,
      stageCount: 0,
      memberUserIds: ["usr-1", "usr-1"],
      members: [
        {
          userId: "usr-1",
          displayName: "Nguyễn Hùng Việt Kha",
          email: "khanhv@upbase.asia",
          avatarUrl: "https://example.com/avatar-kha.png",
          relation: "member",
          assignedTaskCount: 7,
          doneTaskCount: 3,
          doneTaskPercent: 43
        },
        {
          userId: "usr-1",
          displayName: "Nguyễn Hùng Việt Kha",
          email: "khanhv@upbase.asia",
          relation: "delivery_lead"
        }
      ]
    });

    expect(project.memberUserIds).toEqual(["usr-1"]);
    expect(project.members).toHaveLength(1);
    expect(project.members[0]).toMatchObject({
      id: "usr-1",
      name: "Nguyễn Hùng Việt Kha",
      email: "khanhv@upbase.asia",
      avatarUrl: "https://example.com/avatar-kha.png",
      assignedTaskCount: 7,
      doneTaskCount: 3,
      doneTaskPercent: 43
    });
  });

  it("maps project-sheet time totals from minutes to decimal hours", () => {
    const project = mapProjectSummaryToUiProject({
      ...cachedProjectSummary,
      hierarchyOrderVersion: 0,
      plannedMinutes: 615,
      loggedMinutes: 255,
      approvedMinutes: 225
    });

    expect(project).toMatchObject({
      plannedHours: 10.3,
      loggedHours: 4.3,
      pnlHours: 3.8
    });
  });
});

it("loads clients beyond the first page without conflating duplicate labels", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "a", name: "Same client" }], meta: { pagination: { offset: 0, returned: 1, hasNextPage: true } } }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "b", name: "Same client" }], meta: { pagination: { offset: 1, returned: 1, hasNextPage: false } } })));
  vi.stubGlobal("fetch", fetcher);
  try {
    expect((await fetchAccountOptions()).map(option => option.accountId)).toEqual(["a", "b"]);
    expect(fetcher.mock.calls[1][0]).toContain("offset=1");
  } finally { vi.unstubAllGlobals(); }
});

it("does not fabricate a team member for an empty project", () => {
  expect(mapProjectSummaryToUiProject({ ...cachedProjectSummary, members: [], ownerUserId: "owner", ownerDisplayName: "Owner" } as any).members).toEqual([]);
});
