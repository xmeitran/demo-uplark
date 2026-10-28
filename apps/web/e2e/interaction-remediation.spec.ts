import { expect, test, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

const authUser = {
  id: "usr-qa",
  name: "Interaction QA",
  email: "interaction-qa@example.com",
  initials: "IQ",
  avatarColor: "#2563eb",
  role: "FOUNDER_GM"
};

const workspaceUser = {
  id: "usr-qa",
  email: authUser.email,
  displayName: authUser.name,
  subjectType: "internal",
  status: "active",
  tenantKey: "qa",
  workspaceId: "twk-qa",
  roleCodes: ["FOUNDER_GM"],
  accountIds: ["acc-qa"],
  accountNames: ["QA Account"],
  projectIds: ["prj-qa"],
  projectNames: ["Interaction QA Project"],
  projectMemberCount: 1,
  assignedTaskCount: 1,
  ownedTaskCount: 0,
  timeEntryCount: 0,
  activeSessionCount: 1,
  createdAt: "2026-07-15T00:00:00.000Z"
};

const account = {
  id: "acc-qa",
  code: "QA-ACCOUNT",
  name: "QA Account",
  stage: "active",
  ownerTeam: "QA",
  health: "green"
};

const project = {
  id: "prj-qa",
  accountId: account.id,
  accountName: account.name,
  code: "QA-PRJ",
  name: "Interaction QA Project",
  status: "in_progress",
  opportunityStage: "delivery",
  projectType: "delivery",
  scopeSummary: "Deterministic interaction fixture",
  priority: "high",
  tags: ["qa", "interaction"],
  color: "#2563eb",
  budgetAmount: 125000,
  spentAmount: 0,
  progressPercent: 25,
  taskCount: 1,
  completedTaskCount: 0,
  stageCount: 1,
  activeStageCount: 1,
  ownerUserId: workspaceUser.id,
  ownerDisplayName: workspaceUser.displayName,
  memberUserIds: [workspaceUser.id],
  members: [{
    userId: workspaceUser.id,
    displayName: workspaceUser.displayName,
    email: workspaceUser.email,
    relation: "member"
  }],
  plannedStartAt: "2026-07-15T00:00:00.000Z",
  plannedEndAt: "2026-10-15T00:00:00.000Z",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z"
};

const task = {
  id: "task-qa",
  accountId: account.id,
  accountName: account.name,
  projectId: project.id,
  projectName: project.name,
  title: "Verify failure semantics",
  description: "A deterministic task for false-success regression coverage.",
  taskType: "delivery",
  taskTypeLayer1: "DELIVERY",
  taskTypeLayer2: "CUSTOMER_PROJECT",
  status: "in_progress",
  priority: "high",
  assigneeUserId: workspaceUser.id,
  assigneeDisplayName: workspaceUser.displayName,
  ownerUserId: workspaceUser.id,
  ownerDisplayName: workspaceUser.displayName,
  plannedStartAt: "2026-07-15T02:00:00.000Z",
  dueAt: "2026-07-16T10:00:00.000Z",
  estimateMinutes: 60,
  loggedMinutes: 0,
  approvedMinutes: 0,
  overdue: false,
  customerVisible: false,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  statusHistory: [],
  planningBlocks: [],
  timeEntries: []
};

const pagination = (returned: number) => ({
  limit: 100,
  offset: 0,
  returned,
  total: returned,
  hasNextPage: false,
  hasPreviousPage: false
});

function listResponse<T>(data: T[]) {
  return {
    data,
    meta: {
      principal: { subjectId: workspaceUser.id, workspaceId: workspaceUser.workspaceId },
      rowScope: "workspace",
      hiddenFields: [],
      pagination: pagination(data.length)
    }
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installAuthenticatedBrowser(context: BrowserContext, page: Page, baseURL?: string) {
  const origin = new URL(baseURL ?? "http://127.0.0.1:3904").origin;
  await context.addCookies([{
    name: "lcrm_session",
    value: "interaction-remediation-session",
    url: origin,
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "Lax"
  }]);
  await page.addInitScript((user) => {
    window.localStorage.setItem("crm_auth_user", JSON.stringify(user));
  }, authUser);
  // Fail closed: nothing in this spec reaches a real API. Shell reads get empty answers; any other unmocked call is a
  // 404 that names its path. Registered first, so every mock below takes precedence.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/navigation") return json({ data: { availableFlaggedRoutes: ["/analytics"] } });
    if (path === "/api/notifications") return json({ data: [], meta: { unreadCount: 0 } });
    return json({ message: `Unmocked API call in e2e: ${route.request().method()} ${path}` }, 404);
  });
  await page.route("**/api/auth/me", route => fulfillJson(route, {
    subjectId: workspaceUser.id,
    displayName: workspaceUser.displayName,
    email: workspaceUser.email,
    tenantKey: workspaceUser.tenantKey,
    workspaceId: workspaceUser.workspaceId,
    roleCodes: workspaceUser.roleCodes
  }));
}

async function installCoreReadMocks(page: Page, options: { usersFail?: boolean } = {}) {
  await page.route("**/api/admin/users**", route => options.usersFail
    ? fulfillJson(route, { message: "Directory unavailable" }, 503)
    : fulfillJson(route, { data: [workspaceUser], meta: { total: 1, tenantKey: "qa" } }));
  await page.route("**/api/accounts**", route => fulfillJson(route, listResponse([account])));
  await page.route("**/api/capacity/summary**", route => fulfillJson(route, {
    data: [],
    summary: { totalUsers: 0, availableUsers: 0, overbookedUsers: 0, allocatedMinutes: 0, capacityMinutes: 0 },
    meta: { principal: workspaceUser.id, rowScope: "workspace" }
  }));
  await page.route("**/api/milestone-templates**", route => fulfillJson(route, listResponse([])));
  await page.route("**/api/workspace/day-offs**", route => fulfillJson(route, listResponse([])));
  // Projects list: workspace-wide open-warning counts ({ projectId: openCount }).
  await page.route("**/api/project-warnings/counts**", route => fulfillJson(route, { data: {} }));
  await page.route("**/api/workspace/users**", route => options.usersFail
    ? fulfillJson(route, { message: "Directory unavailable" }, 503)
    : fulfillJson(route, listResponse([workspaceUser])));
  await page.route("**/api/projects/*/members**", route => fulfillJson(route, {
    data: [{ userId: workspaceUser.id, displayName: workspaceUser.displayName, email: workspaceUser.email, status: "active", roleCodes: workspaceUser.roleCodes }],
    meta: { principalUserId: workspaceUser.id, permissions: { canManage: true, canLogForOthers: true }, pagination: pagination(1) }
  }));
  await page.route("**/api/tasks/planning-blocks**", route => fulfillJson(route, listResponse([])));
  await page.route("**/api/tasks/time-entries**", route => fulfillJson(route, listResponse([])));
  await page.route("**/api/tasks**", route => fulfillJson(route, listResponse([task])));
}

async function installProjectListMocks(page: Page, onCreate?: (body: Record<string, unknown>) => void) {
  await page.route("**/api/projects**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/members")) {
      await fulfillJson(route, {
        data: [{ userId: workspaceUser.id, displayName: workspaceUser.displayName, email: workspaceUser.email, status: "active", roleCodes: workspaceUser.roleCodes }],
        meta: { principalUserId: workspaceUser.id, permissions: { canManage: true, canLogForOthers: true }, pagination: pagination(1) }
      });
      return;
    }
    if (url.pathname === "/api/projects" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      onCreate?.(body);
      await fulfillJson(route, {
        ...project,
        ...body,
        id: "prj-created",
        accountName: account.name,
        taskCount: 0,
        completedTaskCount: 0,
        stageCount: 5,
        activeStageCount: 0,
        members: project.members,
        createdAt: "2026-07-15T01:00:00.000Z",
        updatedAt: "2026-07-15T01:00:00.000Z"
      }, 201);
      return;
    }
    if (url.pathname === `/api/projects/${project.id}`) {
      await fulfillJson(route, project);
      return;
    }
    await fulfillJson(route, listResponse([project]));
  });
}

async function installTaskDetailMocks(page: Page, controls: {
  dailyActualLog?: {
    localDate: string;
    timeZone: "Asia/Ho_Chi_Minh";
    totalMinutes: number;
    targetMinutes: 480;
    state: "below_target" | "target_met" | "over_target";
  };
  failTimeEntry?: boolean;
  failTransition?: boolean;
}) {
  type MutableTaskFixture = Omit<typeof task, "status" | "timeEntries"> & {
    status: string;
    timeEntries: Array<Record<string, any>>;
  };
  let canonicalTask: MutableTaskFixture = {
    ...structuredClone(task),
    status: task.status,
    timeEntries: []
  };
  let transitionCalls = 0;
  let timeEntryCalls = 0;

  await page.route("**/api/tasks**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === `/api/tasks/${task.id}/time-entries` && method === "POST") {
      timeEntryCalls += 1;
      if (controls.failTimeEntry) {
        await fulfillJson(route, { message: "Time entry write failed" }, 500);
        return;
      }
      const input = route.request().postDataJSON();
      const saved = {
        id: "time-entry-qa",
        taskId: task.id,
        accountId: account.id,
        projectId: project.id,
        userId: workspaceUser.id,
        userDisplayName: workspaceUser.displayName,
        ...input,
        approvalStatus: "submitted",
        createdAt: "2026-07-15T02:00:00.000Z",
        updatedAt: "2026-07-15T02:00:00.000Z"
      };
      canonicalTask = { ...canonicalTask, loggedMinutes: saved.minutes, timeEntries: [saved] };
      await fulfillJson(route, {
        ...saved,
        dailyActualLog: controls.dailyActualLog ?? {
          localDate: "2026-07-15",
          timeZone: "Asia/Ho_Chi_Minh",
          totalMinutes: 60,
          targetMinutes: 480,
          state: "below_target"
        }
      }, 201);
      return;
    }
    if (url.pathname === `/api/tasks/${task.id}/transitions` && method === "POST") {
      transitionCalls += 1;
      if (controls.failTransition) {
        await fulfillJson(route, { message: "Transition denied" }, 500);
        return;
      }
      canonicalTask = { ...canonicalTask, status: "completed" };
      await fulfillJson(route, canonicalTask, 200);
      return;
    }
    if (url.pathname === `/api/tasks/${task.id}/attachments`) {
      await fulfillJson(route, listResponse([]));
      return;
    }
    if (url.pathname === `/api/tasks/${task.id}/comments`) {
      await fulfillJson(route, listResponse([]));
      return;
    }
    if (url.pathname === `/api/tasks/${task.id}/history`) {
      await fulfillJson(route, listResponse([]));
      return;
    }
    if (url.pathname === `/api/tasks/${task.id}`) {
      await fulfillJson(route, canonicalTask);
      return;
    }
    if (url.pathname === "/api/tasks") {
      await fulfillJson(route, listResponse([canonicalTask]));
      return;
    }
    await fulfillJson(route, { message: "Not found" }, 404);
  });

  return {
    timeEntryCalls: () => timeEntryCalls,
    transitionCalls: () => transitionCalls,
    canonicalTask: () => canonicalTask
  };
}

async function openActualWorkModal(page: Page, completeTask: boolean) {
  await expect(page.getByRole("heading", { name: task.title })).toBeVisible();
  await page.getByRole("button", { name: "Ghi giờ", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Ghi nhận & Lên kế hoạch" });
  await chooser.getByRole("button", { name: /Ghi giờ thực tế/ }).click();
  if (completeTask) {
    await page.getByLabel("Đánh dấu hoàn thành công việc này").check();
  }
  // Lớp 2 is derived from the task and sent automatically by the logging form.
  await page.getByRole("button", { name: "Ghi thời gian", exact: true }).click();
}

function primaryFontFamily(fontFamily: string) {
  return fontFamily
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

async function expectBodyFontFamily(locator: Locator, bodyFontFamily: string, surface: string) {
  const fontFamily = await locator.evaluate(element => window.getComputedStyle(element).fontFamily);
  expect(fontFamily, `${surface} must resolve to the same generated Be Vietnam Pro family as body`).toBe(bodyFontFamily);
}

test.describe("interaction audit remediation", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await installAuthenticatedBrowser(context, page, baseURL);
  });

  test("production command search, notifications, theme and unavailable policy stay honest", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page);

    const consoleErrors: string[] = [];
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "All Projects" })).toBeVisible();
    await expect(page.getByText("Loading workspace...", { exact: true })).toHaveCount(0);

    await page.keyboard.press("Control+K");
    const command = page.getByRole("combobox", { name: "Quick navigation" });
    await expect(command).toBeFocused();
    await command.fill("pipeline");
    await expect(page.getByText("No matching production route.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(command).toBeFocused();

    await command.fill("clients");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole("heading", { name: "Khách hàng", exact: true })).toBeVisible();

    const notifications = page.getByRole("button", { name: "Notifications" });
    await notifications.click();
    await expect(page.getByRole("region", { name: "Notifications" })).toContainText("No notifications yet.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();

    await page.goto("/unavailable?route=%2Fpipeline");
    await expect(page.getByRole("heading", { name: "Module not available" })).toBeVisible();
    await expect(page.getByText("/pipeline is not classified as production-ready.", { exact: false })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("generated Be Vietnam Pro remains the computed font across Projects and every Task Detail interaction surface", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page);
    await installTaskDetailMocks(page, {});

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", error => pageErrors.push(error.message));

    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "All Projects" })).toBeVisible();

    const fontContract = await page.evaluate(async () => {
      await document.fonts.ready;
      const rootStyles = window.getComputedStyle(document.documentElement);
      const bodyFontFamily = window.getComputedStyle(document.body).fontFamily;
      const primaryFamily = bodyFontFamily
        .split(",")[0]
        .trim()
        .replace(/^['"]|['"]$/g, "");
      return {
        bodyFontFamily,
        primaryFamily,
        beVietnamProVariable: rootStyles.getPropertyValue("--font-be-vietnam-pro").trim(),
        sansVariable: rootStyles.getPropertyValue("--font-sans").trim(),
        generatedBeVietnamProLoaded: document.fonts.check(`16px "${primaryFamily.replace(/"/g, "\\\"")}"`)
      };
    });

    expect(fontContract.beVietnamProVariable, "next/font must expose --font-be-vietnam-pro on the root element").not.toBe("");
    expect(fontContract.sansVariable, "the app-wide --font-sans token must be present").not.toBe("");
    expect(fontContract.beVietnamProVariable).toContain(fontContract.primaryFamily);
    expect(fontContract.generatedBeVietnamProLoaded, "the generated next/font Be Vietnam Pro face must be loaded").toBe(true);
    expect(primaryFontFamily(fontContract.bodyFontFamily)).toBe(fontContract.primaryFamily);
    expect(fontContract.primaryFamily).not.toMatch(/nunito|jetbrains|system-ui|monospace/i);

    await expectBodyFontFamily(page.getByRole("heading", { name: "All Projects" }), fontContract.bodyFontFamily, "Projects heading");
    await expectBodyFontFamily(page.locator("main .font-mono").first(), fontContract.bodyFontFamily, "Projects former font-mono metric");

    await page.goto(`/tasks/${task.id}`);
    const taskHeading = page.getByRole("heading", { name: task.title });
    await expect(taskHeading).toBeVisible();

    await expectBodyFontFamily(taskHeading, fontContract.bodyFontFamily, "Task Detail heading");
    await expectBodyFontFamily(page.getByText(task.description, { exact: true }), fontContract.bodyFontFamily, "Task Detail body copy");
    const editAction = page.getByRole("button", { name: "Chỉnh sửa", exact: true }).first();
    await expectBodyFontFamily(editAction, fontContract.bodyFontFamily, "Task Detail action button");
    await expectBodyFontFamily(page.getByRole("combobox", { name: "Quick navigation" }), fontContract.bodyFontFamily, "Task Detail navigation input");
    await expectBodyFontFamily(page.locator("kbd.font-mono"), fontContract.bodyFontFamily, "Task Detail former font-mono shortcut");

    await editAction.click();
    const editDialog = page.getByRole("dialog", { name: "Xác nhận chỉnh sửa" });
    await expect(editDialog).toBeVisible();
    await expectBodyFontFamily(editDialog, fontContract.bodyFontFamily, "Task Detail confirmation dialog");
    await expectBodyFontFamily(editDialog.getByRole("heading", { name: "Xác nhận chỉnh sửa" }), fontContract.bodyFontFamily, "Task Detail dialog heading");
    await expectBodyFontFamily(editDialog.getByText("Bạn có chắc chắn muốn chỉnh sửa thông tin task này không?"), fontContract.bodyFontFamily, "Task Detail dialog body");
    await expectBodyFontFamily(editDialog.getByRole("button", { name: "Hủy" }), fontContract.bodyFontFamily, "Task Detail dialog cancel button");
    await expectBodyFontFamily(editDialog.getByRole("button", { name: "Xác nhận" }), fontContract.bodyFontFamily, "Task Detail dialog confirm button");

    await editDialog.getByRole("button", { name: "Xác nhận" }).click();
    const titleInput = page.locator("main input[type='text']").first();
    const descriptionInput = page.locator("main textarea").first();
    const estimateInput = page.locator("main input[type='number']").first();
    await expect(titleInput).toBeVisible();
    await expect(descriptionInput).toBeVisible();
    await expect(estimateInput).toBeVisible();
    await expectBodyFontFamily(titleInput, fontContract.bodyFontFamily, "Task Detail title input");
    await expectBodyFontFamily(descriptionInput, fontContract.bodyFontFamily, "Task Detail description textarea");
    await expectBodyFontFamily(estimateInput, fontContract.bodyFontFamily, "Task Detail estimate input");
    await expectBodyFontFamily(page.getByRole("button", { name: "Lưu thay đổi" }), fontContract.bodyFontFamily, "Task Detail edit action");

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("Calendar fails closed when the real workspace directory is unavailable", async ({ page }) => {
    await installCoreReadMocks(page, { usersFail: true });
    await page.route("**/api/tasks**", route => fulfillJson(route, listResponse([task])));
    let planningWrites = 0;
    await page.route("**/api/tasks/*/planning-blocks", async route => {
      if (route.request().method() === "POST") planningWrites += 1;
      await fulfillJson(route, { message: "Planning must stay disabled" }, 500);
    });

    await page.goto("/calendar");
    await expect(page.getByText("Lịch trình kế hoạch", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Thêm kế hoạch" }).click();
    await expect(page.getByText("Could not load real workspace users. Planning is disabled until the directory is available.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lưu kế hoạch" })).toBeDisabled();
    await expect(page.getByText(/usr-kha-founder|usr-deliverer/)).toHaveCount(0);
    expect(planningWrites).toBe(0);
  });

  test("Create Project sends every visible business field in one persisted payload", async ({ page }) => {
    await installCoreReadMocks(page);
    let submitted: Record<string, unknown> | null = null;
    await installProjectListMocks(page, body => { submitted = body; });

    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "All Projects" })).toBeVisible();
    await page.locator("main").getByRole("button", { name: /New Project/ }).click();
    await expect(page.getByText("Create New Project", { exact: true })).toBeVisible();

    await page.getByPlaceholder("e.g. Mobile App Redesign").fill("All Fields QA Project");
    // The create form carries no money and no status: Giá trị dự án is entered on the project's P&L screen, a new project starts at "Lên kế hoạch".
    await expect(page.getByPlaceholder("e.g. 50000")).toHaveCount(0);
    await page.getByLabel("Không tính vào số tổng P&L").check();
    await page.getByPlaceholder("Describe the scope, objectives, and deliverables of this project...").fill("All visible create fields must survive the request contract.");
    await page.getByPlaceholder("e.g. Core, Design, Marketing").fill("Audit, Persistence");

    // V-01: Loại dự án is required — without it the form does not submit.
    await page.getByRole("button", { name: "Create Project", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Chọn Loại dự án: Khách hàng, Nội bộ hoặc Đào tạo." })).toBeVisible();
    expect(submitted).toBeNull();
    const typeField = page.getByText("Loại dự án *", { exact: true }).locator("..");
    await typeField.getByRole("button").click();
    await expect(page.getByRole("option")).toHaveText(["Khách hàng", "Nội bộ", "Đào tạo"]);
    await page.getByRole("option", { name: "Khách hàng", exact: true }).click();

    const priorityField = page.getByText("Priority", { exact: true }).locator("..");
    await priorityField.getByRole("button").click();
    await page.getByRole("option", { name: "Critical", exact: true }).click();

    await page.getByRole("button", { name: `IQ ${workspaceUser.displayName}` }).click();
    await page.getByRole("button", { name: "Select project color #059669" }).click();

    await page.getByRole("button", { name: "Create Project", exact: true }).click();
    await expect.poll(() => submitted).not.toBeNull();
    const submittedPayload = submitted as unknown as Record<string, unknown>;
    expect(submittedPayload).toMatchObject({
      accountId: account.id,
      name: "All Fields QA Project",
      projectType: "delivery",
      ownerUserId: workspaceUser.id,
      memberUserIds: [workspaceUser.id],
      isTestProject: true,
      priority: "critical",
      tags: ["Audit", "Persistence"],
      scopeSummary: "All visible create fields must survive the request contract.",
      createStageTemplate: true
    });
    expect(submittedPayload).toHaveProperty("plannedStartAt");
    expect(submittedPayload).toHaveProperty("plannedEndAt");
    expect(submittedPayload).toHaveProperty("color");
    expect(submittedPayload).not.toHaveProperty("status");
    expect(submittedPayload).not.toHaveProperty("budgetAmount");
    expect(submittedPayload.color).not.toBe("#2563eb");
    await expect(page.getByText("Create New Project", { exact: true })).toHaveCount(0);
  });

  test("Create Project keeps focus while typing a custom milestone name", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page, () => undefined);

    await page.goto("/projects");
    await page.locator("main").getByRole("button", { name: /New Project/ }).click();
    await page.getByText("Tự chọn milestone", { exact: true }).click();
    const milestoneName = page.getByLabel("Milestone 1", { exact: true });
    await milestoneName.fill("");
    await milestoneName.pressSequentially("Discovery");
    await expect(milestoneName).toHaveValue("Discovery");
    await expect(milestoneName).toBeFocused();
  });

  test("failed time entry never attempts completion or displays combined success", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page);
    const controls = await installTaskDetailMocks(page, { failTimeEntry: true });

    await page.goto(`/tasks/${task.id}`);
    await openActualWorkModal(page, true);
    // A write the API rejected shows the API's own message; the generic text is only for requests that never got an answer.
    await expect(page.getByText("Time entry write failed", { exact: true })).toBeVisible();
    await expect(page.getByText(/Không thể lưu thay đổi vì chưa ghi nhận được trên hệ thống/)).toHaveCount(0);
    expect(controls.timeEntryCalls()).toBe(1);
    expect(controls.transitionCalls()).toBe(0);
    await expect(page.getByText(/và hoàn thành công việc/)).toHaveCount(0);
    expect(controls.canonicalTask().status).toBe("in_progress");
  });

  test("saved hours plus failed transition reports partial failure without combined success", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page);
    const controls = await installTaskDetailMocks(page, { failTransition: true });

    await page.goto(`/tasks/${task.id}`);
    await openActualWorkModal(page, true);
    await expect(page.getByText(/Đã lưu 1 giờ; yêu cầu hoàn thành công việc thất bại/)).toBeVisible();
    expect(controls.timeEntryCalls()).toBe(1);
    expect(controls.transitionCalls()).toBe(1);
    expect(controls.canonicalTask().timeEntries).toHaveLength(1);
    expect(controls.canonicalTask().timeEntries[0]).toMatchObject({ selectedTaskTypeLayer2: "CUSTOMER_PROJECT" });
    expect(controls.canonicalTask().status).toBe("in_progress");
    await expect(page.getByText(/Đã ghi 1 giờ làm việc và hoàn thành công việc/)).toHaveCount(0);
  });

  test("canonical daily actual log announces exact target, overage, and keeps below-target quiet", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page);

    const exactControls = await installTaskDetailMocks(page, {
      dailyActualLog: {
        localDate: "2026-07-15",
        timeZone: "Asia/Ho_Chi_Minh",
        totalMinutes: 480,
        targetMinutes: 480,
        state: "target_met"
      }
    });
    await page.goto(`/tasks/${task.id}`);
    await openActualWorkModal(page, false);
    const exactStatus = page.getByRole("status").filter({ hasText: "Đã ghi nhận đủ 8 giờ" });
    await expect(exactStatus).toContainText(`${workspaceUser.displayName} đã ghi nhận đủ 8 giờ trong ngày 15/07/2026.`);
    expect(exactControls.timeEntryCalls()).toBe(1);

    await page.unroute("**/api/tasks**");
    const overControls = await installTaskDetailMocks(page, {
      dailyActualLog: {
        localDate: "2026-07-15",
        timeZone: "Asia/Ho_Chi_Minh",
        totalMinutes: 525,
        targetMinutes: 480,
        state: "over_target"
      }
    });
    await page.reload();
    await openActualWorkModal(page, false);
    const overStatus = page.getByRole("status").filter({ hasText: "Đã vượt mốc 8 giờ/ngày" });
    await expect(overStatus).toContainText(`${workspaceUser.displayName} đã ghi nhận 8 giờ 45 phút trong ngày 15/07/2026, vượt 45 phút so với mốc 8 giờ.`);
    expect(overControls.timeEntryCalls()).toBe(1);

    await page.unroute("**/api/tasks**");
    const belowControls = await installTaskDetailMocks(page, {
      dailyActualLog: {
        localDate: "2026-07-15",
        timeZone: "Asia/Ho_Chi_Minh",
        totalMinutes: 479,
        targetMinutes: 480,
        state: "below_target"
      }
    });
    await page.reload();
    await openActualWorkModal(page, false);
    await expect(page.getByText("Đã ghi 1 giờ làm việc.", { exact: true })).toBeVisible();
    await expect(page.getByText(/đã ghi nhận đủ 8 giờ|Đã vượt mốc 8 giờ\/ngày/)).toHaveCount(0);
    expect(belowControls.timeEntryCalls()).toBe(1);
  });

  test("task detail attaches a link next to file uploads", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page);
    await installTaskDetailMocks(page, {});

    let fileBody: Record<string, unknown> = {};
    const linkFile = () => ({
      id: "file-link-qa",
      accountId: account.id,
      projectId: project.id,
      fileName: String(fileBody.fileName),
      contentType: "text/uri-list",
      byteSize: 0,
      storageProvider: "external",
      externalUrl: String(fileBody.externalUrl),
      ownerType: "task",
      ownerId: task.id,
      customerVisible: false,
      internalOnly: true,
      allowedRoles: [],
      scanStatus: "pending",
      status: "active",
      createdAt: "2026-07-15T03:00:00.000Z"
    });
    await page.route("**/api/files**", async route => {
      fileBody = route.request().postDataJSON();
      await fulfillJson(route, linkFile(), 201);
    });
    await page.route(`**/api/tasks/${task.id}/attachments**`, async route => {
      if (route.request().method() !== "POST") return route.fallback();
      expect(route.request().postDataJSON()).toEqual({ fileObjectId: "file-link-qa" });
      await fulfillJson(route, {
        id: "att-link-qa",
        taskId: task.id,
        accountId: account.id,
        projectId: project.id,
        fileObjectId: "file-link-qa",
        syncStatus: "not_synced",
        file: linkFile(),
        createdAt: "2026-07-15T03:00:00.000Z"
      }, 201);
    });

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "Đính kèm link" }).click();
    // No scheme typed: the page adds https:// before the API (which only takes http/https) sees it.
    await page.getByLabel("Đường dẫn").fill("figma.com/file/qa");
    await page.getByLabel("Tên hiển thị").fill("Spec Figma");
    await page.getByRole("button", { name: "Thêm link" }).click();

    const link = page.getByRole("link", { name: "Spec Figma" });
    await expect(link).toHaveAttribute("href", "https://figma.com/file/qa");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(page.getByText("Tài liệu đính kèm (1)")).toBeVisible();
    await expect(page.getByLabel("Đường dẫn")).toHaveCount(0);
    expect(fileBody).toMatchObject({
      storageProvider: "external",
      externalUrl: "https://figma.com/file/qa",
      fileName: "Spec Figma",
      ownerType: "task",
      ownerId: task.id,
      accountId: account.id
    });
  });

  test("project header edits and deletes in place without leaving the project", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page);
    for (const resource of ["stages", "activity", "risks", "documents"]) {
      await page.route(`**/api/projects/${project.id}/${resource}**`, route => fulfillJson(route, listResponse([])));
    }
    let patchBody: Record<string, unknown> | null = null;
    await page.route(`**/api/projects/${project.id}`, async route => {
      if (route.request().method() !== "PATCH") return route.fallback();
      patchBody = route.request().postDataJSON();
      await fulfillJson(route, { ...project, name: patchBody!.name });
    });

    await page.goto(`/projects/${project.id}?tab=Documents`);
    await page.getByRole("button", { name: "Chỉnh sửa dự án" }).click();
    const editDialog = page.getByRole("dialog", { name: "Chỉnh sửa dự án" });
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel("Tên dự án").fill("Renamed in place");
    await editDialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(editDialog).toBeHidden();
    expect(patchBody).toMatchObject({ name: "Renamed in place", accountId: account.id });
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}`));

    // "…" is a menu now, not a hidden delete button.
    await page.getByRole("button", { name: "Thao tác dự án" }).click();
    await page.getByRole("button", { name: "Xóa dự án" }).click();
    const deleteDialog = page.getByRole("alertdialog", { name: "Delete Project" });
    await expect(deleteDialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}`));
    await deleteDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteDialog).toBeHidden();
  });

  test("project document upload links bytes, while version and grant failures remain visible", async ({ page }) => {
    await installCoreReadMocks(page);
    await installProjectListMocks(page);
    await page.route("**/api/projects/prj-qa/stages**", route => fulfillJson(route, listResponse([])));
    await page.route("**/api/projects/prj-qa/activity**", route => fulfillJson(route, listResponse([])));
    await page.route("**/api/projects/prj-qa/risks**", route => fulfillJson(route, listResponse([])));

    let documentRows: any[] = [];
    let uploadedFileNumber = 0;
    const uploadedBodies: Record<string, unknown>[] = [];
    let linkedBody: Record<string, unknown> | null = null;
    let versionBody: Record<string, unknown> | null = null;

    await page.route("**/api/files", async route => {
      uploadedFileNumber += 1;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      uploadedBodies.push(body);
      await fulfillJson(route, {
        id: `file-qa-${uploadedFileNumber}`,
        accountId: account.id,
        projectId: project.id,
        fileName: String(body.fileName),
        contentType: String(body.contentType),
        byteSize: 17,
        storageProvider: "local",
        storageKey: `qa/${body.fileName}`,
        scanStatus: "clean",
        createdAt: "2026-07-15T03:00:00.000Z",
        updatedAt: "2026-07-15T03:00:00.000Z"
      }, 201);
    });
    await page.route("**/api/projects/prj-qa/documents**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/projects/prj-qa/documents" && route.request().method() === "GET") {
        await fulfillJson(route, listResponse(documentRows));
        return;
      }
      if (url.pathname === "/api/projects/prj-qa/documents" && route.request().method() === "POST") {
        linkedBody = route.request().postDataJSON();
        const created = {
          id: "doc-qa",
          accountId: account.id,
          accountName: account.name,
          projectId: project.id,
          projectName: project.name,
          code: "QA-DOC",
          name: linkedBody!.name,
          artifactType: linkedBody!.artifactType,
          storageKey: "qa/interaction-proof.txt",
          customerVisible: false,
          internalOnly: true,
          allowedRoles: [],
          versions: [{
            id: "doc-version-1",
            version: 1,
            fileObjectId: linkedBody!.fileObjectId,
            note: linkedBody!.note,
            createdByDisplayName: workspaceUser.displayName,
            createdAt: "2026-07-15T03:00:00.000Z",
            file: { id: linkedBody!.fileObjectId, fileName: "interaction-proof.txt", byteSize: 17, contentType: "text/plain", scanStatus: "clean" }
          }],
          createdAt: "2026-07-15T03:00:00.000Z",
          updatedAt: "2026-07-15T03:00:00.000Z"
        };
        documentRows = [created];
        await fulfillJson(route, created, 201);
        return;
      }
      if (url.pathname === "/api/projects/prj-qa/documents/doc-qa/versions" && route.request().method() === "POST") {
        versionBody = route.request().postDataJSON();
        await fulfillJson(route, { message: "Version conflict" }, 409);
        return;
      }
      await fulfillJson(route, { message: "Not found" }, 404);
    });
    await page.route("**/api/files/*/download-grants", route => fulfillJson(route, { message: "Grant unavailable" }, 500));

    await page.goto(`/projects/${project.id}?tab=Documents`);
    await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload Document" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Upload Document" }).first().click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "interaction-proof.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("durable qa bytes")
    });
    await page.getByRole("button", { name: "Save Document" }).click();
    await expect.poll(() => linkedBody).not.toBeNull();
    await expect(page.getByRole("heading", { name: "Add Document" })).toHaveCount(0);
    await expect(page.getByText("interaction-proof", { exact: true })).toBeVisible();
    expect(uploadedBodies[0]).toMatchObject({
      accountId: account.id,
      projectId: project.id,
      fileName: "interaction-proof.txt",
      contentType: "text/plain"
    });
    expect(Buffer.from(String(uploadedBodies[0]?.base64Data), "base64").toString("utf8")).toBe("durable qa bytes");
    expect(linkedBody).toMatchObject({ fileObjectId: "file-qa-1", internalOnly: true, customerVisible: false });

    await page.getByTitle("New version").click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "interaction-proof-v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("durable qa bytes v2")
    });
    await page.getByRole("button", { name: "Save New Version" }).click();
    await expect(page.getByText(/Another version was saved first\. The current canonical version is v1\.0/).first()).toBeVisible();
    expect(versionBody).toMatchObject({ fileObjectId: "file-qa-2", expectedVersion: 1 });
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: /Download interaction-proof version 1/ }).click();
    await expect(page.getByText("Could not create download grant: 500", { exact: true })).toBeVisible();
  });
});
