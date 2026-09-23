import { expect, test } from "@playwright/test";
import { installPublicAuthSessionFixture, shouldRequirePublicAuthSmoke } from "./fixtures/public-auth-session";

test.describe("public authenticated session smoke", () => {
  test("opens BFF-backed workspaces with a real session cookie", async ({ context, page, baseURL }) => {
    const fixture = await installPublicAuthSessionFixture(context, baseURL);
    if (!fixture.available) {
      if (shouldRequirePublicAuthSmoke()) {
        throw new Error(fixture.reason);
      }
      test.skip(true, fixture.reason);
    }

    const bffEndpoints = [
      "/api/auth/me",
      "/api/accounts?limit=1",
      "/api/projects?limit=1",
      "/api/tasks?limit=1",
      "/api/capacity/summary",
      "/api/project-controls/pl-summary"
    ];

    for (const endpoint of bffEndpoints) {
      const response = await context.request.get(new URL(endpoint, baseURL).toString());
      expect(response.ok(), `${endpoint} should accept the demo session cookie`).toBe(true);
    }

    const routes = [
      { path: "/pipeline", heading: "Cơ hội" },
      { path: "/accounts", heading: "Khách hàng" },
      { path: "/delivery", heading: "Dự án triển khai" },
      { path: "/finance", heading: "Tài chính & Công nợ" },
      { path: "/proposals", heading: "Đề xuất & phê duyệt" }
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { level: 1, name: route.heading, exact: true })).toBeVisible();
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    }
  });

  test("archives an operational task through the authenticated BFF lifecycle", async ({ context, baseURL }) => {
    const fixture = await installPublicAuthSessionFixture(context, baseURL);
    if (!fixture.available) {
      if (shouldRequirePublicAuthSmoke()) {
        throw new Error(fixture.reason);
      }
      test.skip(true, fixture.reason);
    }

    const unique = Date.now().toString(36);
    const meResponse = await context.request.get(new URL("/api/auth/me", baseURL).toString());
    expect(meResponse.ok()).toBe(true);
    const me = await meResponse.json() as { subjectId?: string };

    const accountResponse = await context.request.post(new URL("/api/accounts", baseURL).toString(), {
      data: {
        code: `E2EARCH${unique}`.slice(0, 20),
        name: `E2E Archive Account ${unique}`,
        stage: "active"
      }
    });
    expect(accountResponse.ok()).toBe(true);
    const account = await accountResponse.json() as { id: string };

    const projectResponse = await context.request.post(new URL("/api/projects", baseURL).toString(), {
      data: {
        accountId: account.id,
        code: `E2E-ARCH-${unique}`.slice(0, 40),
        name: `E2E Archive Project ${unique}`,
        status: "active",
        projectType: "delivery",
        createStageTemplate: false
      }
    });
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json() as { id: string };

    const taskResponse = await context.request.post(new URL("/api/tasks", baseURL).toString(), {
      data: {
        accountId: account.id,
        projectId: project.id,
        title: `E2E operational archive task ${unique}`,
        status: "todo",
        priority: "medium",
        estimateMinutes: 60
      }
    });
    expect(taskResponse.ok()).toBe(true);
    const task = await taskResponse.json() as { id: string };

    const startAt = "2026-07-07T02:00:00.000Z";
    const planningResponse = await context.request.post(new URL(`/api/tasks/${task.id}/planning-blocks`, baseURL).toString(), {
      data: {
        userId: me.subjectId,
        title: "Archive lifecycle proof",
        startAt,
        endAt: "2026-07-07T03:00:00.000Z",
        plannedMinutes: 60,
        status: "planned"
      }
    });
    expect(planningResponse.ok()).toBe(true);

    const deleteResponse = await context.request.delete(new URL(`/api/tasks/${task.id}`, baseURL).toString());
    expect(deleteResponse.ok()).toBe(true);
    const deletePayload = await deleteResponse.json() as { deleted?: boolean; archived?: boolean; id?: string; archivedAt?: string };
    expect(deletePayload).toMatchObject({
      deleted: false,
      archived: true,
      id: task.id
    });
    expect(deletePayload.archivedAt).toBeTruthy();

    const activeTasksResponse = await context.request.get(new URL(`/api/tasks?projectId=${project.id}&limit=50`, baseURL).toString());
    expect(activeTasksResponse.ok()).toBe(true);
    const activeTasks = await activeTasksResponse.json() as { data: Array<{ id: string }> };
    expect(activeTasks.data.some((item) => item.id === task.id)).toBe(false);

    const archivedTasksResponse = await context.request.get(new URL(`/api/tasks?projectId=${project.id}&includeArchived=1&limit=50`, baseURL).toString());
    expect(archivedTasksResponse.ok()).toBe(true);
    const archivedTasks = await archivedTasksResponse.json() as { data: Array<{ id: string; status?: string; archivedAt?: string; archiveReason?: string }> };
    const archivedTask = archivedTasks.data.find((item) => item.id === task.id);
    expect(archivedTask).toMatchObject({
      id: task.id,
      status: "archived"
    });
    expect(archivedTask?.archivedAt).toBeTruthy();
    expect(archivedTask?.archiveReason).toContain("preserved");
  });
});
