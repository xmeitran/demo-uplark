import { expect, test } from "@playwright/test";

test("business BFF routes reject no-cookie access even when principal fallback is supplied", async ({ request }) => {
  const protectedReads = [
    "/api/accounts?limit=1&principal=founder",
    "/api/projects?limit=1&principal=founder",
    "/api/tasks?limit=1&principal=founder",
    "/api/capacity/summary?principal=founder",
    "/api/project-controls/pl-summary?principal=finance-admin",
    "/api/analytics/workforce-projects/summary?principal=founder",
    "/api/analytics/workforce-projects/breakdown?by=project&principal=founder",
    "/api/analytics/workforce-projects/export?principal=founder",
    "/api/delivery/overview?principal=founder",
    "/api/finance/overview?principal=founder",
    "/api/proposals/overview?principal=founder"
  ];

  for (const path of protectedReads) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    await expect(response.json(), path).resolves.toEqual({ message: "Bearer session is required" });
  }
});

test("business BFF writes reject no-cookie access", async ({ request }) => {
  const response = await request.post("/api/tasks?principal=founder", {
    data: { title: "No-cookie task should not be accepted" }
  });

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ message: "Bearer session is required" });
});

test("planning and actual-work BFF routes reject every no-cookie read and mutation", async ({ request }) => {
  const range = "startAt=2026-07-15T00%3A00%3A00.000Z&endAt=2026-07-16T00%3A00%3A00.000Z&principal=founder";
  const requests = [
    {
      label: "planning list",
      run: () => request.get(`/api/tasks/planning-blocks?${range}`)
    },
    {
      label: "actual-work list",
      run: () => request.get(`/api/tasks/time-entries?${range}`)
    },
    {
      label: "planning create",
      run: () => request.post("/api/tasks/task-no-cookie/planning-blocks?principal=founder", {
        data: {
          userId: "usr-no-cookie",
          title: "No-cookie planning must fail",
          startAt: "2026-07-15T02:00:00.000Z",
          endAt: "2026-07-15T03:00:00.000Z",
          plannedMinutes: 60,
          status: "planned"
        }
      })
    },
    {
      label: "actual-work create",
      run: () => request.post("/api/tasks/task-no-cookie/time-entries?principal=founder", {
        data: {
          userId: "usr-no-cookie",
          workDate: "2026-07-15T02:00:00.000Z",
          startAt: "2026-07-15T02:00:00.000Z",
          endAt: "2026-07-15T03:00:00.000Z",
          timeZone: "Asia/Ho_Chi_Minh",
          minutes: 60
        }
      })
    },
    {
      label: "planning transition",
      run: () => request.post("/api/tasks/planning-blocks/plan-no-cookie/transitions?principal=founder", {
        data: {
          status: "completed",
          expectedUpdatedAt: "2026-07-15T00:00:00.000Z"
        }
      })
    },
    {
      label: "planning delete",
      run: () => request.delete("/api/tasks/planning-blocks/plan-no-cookie?principal=founder")
    },
    {
      label: "actual-work review",
      run: () => request.patch("/api/tasks/time-entries/time-no-cookie?principal=founder", {
        data: {
          status: "approved",
          expectedUpdatedAt: "2026-07-15T00:00:00.000Z"
        }
      })
    },
    {
      label: "actual-work delete",
      run: () => request.delete("/api/tasks/time-entries/time-no-cookie?principal=founder")
    }
  ];

  for (const protectedRequest of requests) {
    const response = await protectedRequest.run();
    expect(response.status(), protectedRequest.label).toBe(401);
    await expect(response.json(), protectedRequest.label).resolves.toEqual({ message: "Bearer session is required" });
  }
});
