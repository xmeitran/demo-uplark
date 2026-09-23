import { expect, test, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

const authUser = {
  id: "usr-responsive",
  name: "Responsive QA",
  email: "responsive-qa@example.com",
  initials: "RQ",
  avatarColor: "#2563eb",
  role: "FOUNDER_GM"
};

const workspaceUser = {
  id: authUser.id,
  email: authUser.email,
  displayName: authUser.name,
  subjectType: "internal",
  status: "active",
  tenantKey: "responsive",
  workspaceId: "twk-responsive",
  departmentCode: "QA",
  resourceDisplayRole: "Quality Engineer",
  resourceSkills: ["Playwright", "Responsive QA"],
  resourceWeeklyCapacityMinutes: 2400,
  resourceBillableTargetPercent: 70,
  roleCodes: ["FOUNDER_GM"],
  accountIds: ["acc-responsive"],
  accountNames: ["Responsive Account"],
  projectIds: ["prj-responsive"],
  projectNames: ["Responsive Matrix Project"],
  projectMemberCount: 1,
  assignedTaskCount: 1,
  ownedTaskCount: 1,
  timeEntryCount: 0,
  activeSessionCount: 1,
  lastSeenAt: "2026-07-15T08:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z"
};

const account = {
  id: "acc-responsive",
  code: "RESP-ACCOUNT",
  name: "Responsive Account",
  stage: "active",
  tier: "Enterprise",
  ownerTeam: "QA",
  picUserId: workspaceUser.id,
  picName: workspaceUser.displayName,
  picEmail: workspaceUser.email,
  health: "green",
  annualValue: 120000,
  commercialNote: "Deterministic responsive fixture"
};

const project = {
  id: "prj-responsive",
  accountId: account.id,
  accountName: account.name,
  code: "RESP-PRJ",
  name: "Responsive Matrix Project",
  status: "in_progress",
  opportunityStage: "delivery",
  projectType: "delivery",
  scopeSummary: "Deterministic responsive layout fixture",
  priority: "high",
  tags: ["qa", "responsive"],
  color: "#2563eb",
  budgetAmount: 120000,
  spentAmount: 24000,
  progressPercent: 35,
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
  plannedStartAt: "2026-07-01T00:00:00.000Z",
  plannedEndAt: "2026-09-30T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-15T08:00:00.000Z"
};

const task = {
  id: "task-responsive",
  accountId: account.id,
  accountName: account.name,
  projectId: project.id,
  projectName: project.name,
  title: "Responsive ambient task",
  description: "Task detail fixture used to verify the shared shell and modal containment.",
  taskType: "delivery",
  status: "in_progress",
  priority: "high",
  assigneeUserId: workspaceUser.id,
  assigneeDisplayName: workspaceUser.displayName,
  ownerUserId: workspaceUser.id,
  ownerDisplayName: workspaceUser.displayName,
  plannedStartAt: "2026-07-15T02:00:00.000Z",
  dueAt: "2026-07-18T10:00:00.000Z",
  estimateMinutes: 120,
  loggedMinutes: 30,
  approvedMinutes: 30,
  overdue: false,
  customerVisible: false,
  statusHistory: [],
  planningBlocks: [],
  timeEntries: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-15T08:00:00.000Z"
};

const viewportMatrix = [
  { name: "compact-mobile", width: 320, height: 568 },
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "lg-boundary", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide", width: 2048, height: 1152 }
] as const;

type RouteSurface = {
  name: string;
  path: string;
  ready: (page: Page) => Locator;
  mainTestId?: string;
};

const routeSurfaces: RouteSurface[] = [
  {
    name: "task-detail",
    path: `/tasks/${task.id}`,
    ready: (page) => page.getByRole("heading", { name: task.title }).first()
  },
  {
    name: "projects",
    path: "/projects",
    ready: (page) => page.getByRole("heading", { name: "All Projects" })
  },
  {
    name: "project-detail",
    path: `/projects/${project.id}?tab=Dashboard`,
    ready: (page) => page.getByRole("heading", { name: project.name })
  },
  {
    name: "users",
    path: "/users",
    ready: (page) => page.getByRole("heading", { name: "Team Members" })
  },
  {
    name: "clients",
    path: "/clients",
    ready: (page) => page.getByRole("heading", { name: "Client Accounts" })
  },
  {
    name: "calendar",
    path: "/calendar",
    ready: (page) => page.getByText("Lịch trình kế hoạch", { exact: true }),
    mainTestId: "calendar-main"
  },
  {
    name: "analytics",
    path: "/analytics?view=resources&by=user",
    ready: (page) => page.getByRole("tab", { name: "Phân bổ nguồn lực" }),
    mainTestId: "analytics-main"
  }
];

function pagination(returned: number) {
  return {
    limit: 100,
    offset: 0,
    returned,
    total: returned,
    hasNextPage: false,
    hasPreviousPage: false
  };
}

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

function metric(key: string, value: number | null) {
  return { key, state: value === null ? "unavailable" : "available", value, deltaPercent: null };
}

function analyticsSummary() {
  const metricValues: Array<[string, number | null]> = [
    ["reviewedApprovedMinutes", 1200],
    ["legacyApprovedMinutes", 0],
    ["submittedMinutes", 300],
    ["rejectedMinutes", 0],
    ["billableRatio", 75],
    ["capacityMinutes", 2400],
    ["actualUtilization", 50],
    ["plannedUtilization", 60],
    ["scheduledMinutes", 600],
    ["allocationMinutes", 1440],
    ["estimateMinutes", 1800],
    ["projectsTouched", 1],
    ["taskCompletionRate", 50],
    ["onTimeCompletionRate", 80],
    ["dueDateCoverage", 100],
    ["estimateVarianceMinutes", -600],
    ["medianCycleTimeDays", 2],
    ["overdueTasks", 0],
    ["overdueEstimateMinutes", 0],
    ["blockedTasks", 0],
    ["overbookedPeople", 0],
    ["reworkShare", null]
  ];
  const userRow = {
    id: workspaceUser.id,
    label: workspaceUser.displayName,
    kind: "user",
    href: `/users/${workspaceUser.id}`,
    metrics: {
      reviewedApprovedMinutes: 1200,
      capacityMinutes: 2400,
      actualUtilization: 50,
      allocationMinutes: 1440,
      scheduledMinutes: 600,
      estimateMinutes: 1800,
      overdueTasks: 0,
      submittedMinutes: 300
    }
  };
  const projectRow = {
    id: project.id,
    label: project.name,
    kind: "project",
    href: `/projects/${project.id}?tab=Dashboard`,
    accountLabel: account.name,
    status: project.status,
    metrics: {
      reviewedApprovedMinutes: 1200,
      estimateMinutes: 1800,
      scheduledMinutes: 600,
      allocationMinutes: 1440,
      estimateVarianceMinutes: -600,
      taskCompletionRate: 50,
      onTimeCompletionRate: 80,
      overdueTasks: 0,
      blockedTasks: 0,
      submittedMinutes: 300
    }
  };
  return {
    meta: {
      generatedAt: "2026-07-15T08:00:00.000Z",
      asOf: "2026-07-15T08:00:00.000Z",
      range: { from: "2026-06-15T17:00:00.000Z", to: "2026-07-15T17:00:00.000Z" },
      timezone: "Asia/Ho_Chi_Minh",
      grain: "week",
      definitionsVersion: "responsive-v1",
      rowScope: "workspace",
      policy: "founder_gm_full_operational",
      hiddenFields: [],
      freshness: "live",
      warnings: [],
      suppressedGroups: 0,
      principal: workspaceUser.displayName,
      source: "postgresql",
      filters: {}
    },
    totals: metricValues.map(([key, value]) => metric(key, value)),
    series: [0, 1, 2, 3].map((index) => ({
      bucketStart: `2026-06-${16 + index * 7}T00:00:00.000Z`,
      bucketLabel: `Week ${index + 1}`,
      reviewedApprovedMinutes: 300,
      legacyApprovedMinutes: 0,
      submittedMinutes: 75,
      billableMinutes: 225,
      scheduledMinutes: 150,
      allocationMinutes: 360,
      capacityMinutes: 600,
      tasksCompleted: 1
    })),
    breakdowns: { users: [userRow], projects: [projectRow], departments: [], teams: [] },
    quality: {
      usersMissingDepartment: 0,
      usersMissingTeam: 0,
      usersMissingCapacity: 0,
      membershipCoverage: { covered: 1, total: 1 },
      unassignedActualMinutes: 0,
      legacyApprovedMinutes: 0,
      excludedTimeEntryRows: 0,
      suppressedGroups: 0,
      workTypeVocabulary: ["delivery"]
    },
    filterOptions: {
      departments: [{ id: "QA", label: "QA" }],
      teams: [{ id: "responsive", label: "Responsive" }],
      users: [{ id: workspaceUser.id, label: workspaceUser.displayName }],
      accounts: [{ id: account.id, label: account.name }],
      projects: [{ id: project.id, label: project.name, parentId: account.id }],
      projectStatuses: [{ id: project.status, label: project.status, count: 1 }],
      taskStatuses: [{ id: task.status, label: task.status, count: 1 }],
      workTypes: [{ id: "delivery", label: "delivery", count: 1 }]
    }
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installResponsiveSession(context: BrowserContext, page: Page, baseURL?: string) {
  const origin = new URL(baseURL ?? "http://127.0.0.1:3003").origin;
  await context.addCookies([{
    name: "lcrm_session",
    value: "responsive-matrix-session",
    url: origin,
    httpOnly: false,
    secure: origin.startsWith("https:"),
    sameSite: "Strict"
  }]);
  await page.addInitScript((user) => {
    window.localStorage.clear();
    window.localStorage.setItem("crm_auth_user", JSON.stringify(user));
  }, authUser);
}

async function installResponsiveApi(page: Page) {
  const summary = analyticsSummary();
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/auth/me") {
      await fulfillJson(route, {
        subjectId: workspaceUser.id,
        displayName: workspaceUser.displayName,
        email: workspaceUser.email,
        tenantKey: workspaceUser.tenantKey,
        workspaceId: workspaceUser.workspaceId,
        roleCodes: workspaceUser.roleCodes
      });
      return;
    }
    if (path === "/api/admin/users") {
      await fulfillJson(route, { data: [workspaceUser], meta: { total: 1, tenantKey: workspaceUser.tenantKey } });
      return;
    }
    if (path === "/api/accounts") {
      await fulfillJson(route, listResponse([account]));
      return;
    }
    if (path === "/api/projects") {
      await fulfillJson(route, listResponse([project]));
      return;
    }
    if (path === `/api/projects/${project.id}`) {
      await fulfillJson(route, project);
      return;
    }
    if (path.startsWith(`/api/projects/${project.id}/`)) {
      await fulfillJson(route, listResponse([]));
      return;
    }
    if (path === `/api/tasks/${task.id}`) {
      await fulfillJson(route, task);
      return;
    }
    if (path === `/api/tasks/${task.id}/attachments` || path === `/api/tasks/${task.id}/comments`) {
      await fulfillJson(route, listResponse([]));
      return;
    }
    if (path === "/api/tasks") {
      await fulfillJson(route, listResponse([task]));
      return;
    }
    if (path === "/api/tasks/planning-blocks" || path === "/api/tasks/time-entries") {
      await fulfillJson(route, listResponse([]));
      return;
    }
    if (path === "/api/capacity/summary") {
      await fulfillJson(route, {
        data: [],
        summary: { totalUsers: 1, availableUsers: 1, overbookedUsers: 0, allocatedMinutes: 0, capacityMinutes: 2400 },
        meta: { principal: workspaceUser.id, rowScope: "workspace" }
      });
      return;
    }
    if (path === "/api/project-controls/pl-summary") {
      await fulfillJson(route, {
        data: [],
        summary: { totalBudgetAmount: 120000, totalActualCostAmount: 24000, totalRecognizedRevenueAmount: 0 },
        meta: { principal: workspaceUser.id, rowScope: "workspace" }
      });
      return;
    }
    if (path === "/api/analytics/workforce-projects/summary") {
      await fulfillJson(route, summary);
      return;
    }
    if (path === "/api/analytics/workforce-projects/breakdown") {
      const by = url.searchParams.get("by") ?? "project";
      const rows = by === "user" ? summary.breakdowns.users : summary.breakdowns.projects;
      await fulfillJson(route, {
        meta: { ...summary.meta, by, sort: "reviewedApprovedMinutes", direction: "desc", limit: 25, totalRows: rows.length },
        rows,
        totals: { reviewedApprovedMinutes: 1200, estimateMinutes: 1800, submittedMinutes: 300, overdueTasks: 0, capacityMinutes: 2400 }
      });
      return;
    }

    await fulfillJson(route, { message: `Unhandled responsive fixture: ${path}` }, 404);
  });
}

type ResponsiveSnapshot = {
  viewportWidth: number;
  rootOverflow: number;
  bodyOverflow: number;
  main: { left: number; right: number; width: number };
  visibleAsideCount: number;
  offscreenControls: string[];
  invalidDataScrollOwners: string[];
};

async function readResponsiveSnapshot(page: Page, surface: RouteSurface): Promise<ResponsiveSnapshot> {
  const main = surface.mainTestId ? page.getByTestId(surface.mainTestId) : page.locator("main").first();
  return main.evaluate((mainElement) => {
    const isRendered = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const ownsHorizontalOverflow = (element: HTMLElement) => {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if ((style.overflowX === "auto" || style.overflowX === "scroll") && ancestor.scrollWidth > ancestor.clientWidth + 1) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    };
    const controlName = (element: HTMLElement) =>
      element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent?.trim().slice(0, 80) || element.tagName;
    const viewportControls = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role='tab'], [role='option']"))
      .filter(isRendered)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
    const offscreenControls = viewportControls.flatMap((element) => {
      if (ownsHorizontalOverflow(element)) return [];
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > window.innerWidth + 1 ? [controlName(element)] : [];
    });
    const invalidDataScrollOwners = Array.from(document.querySelectorAll<HTMLElement>("table, svg.recharts-surface"))
      .filter(isRendered)
      .flatMap((element) => {
        if (element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().right <= window.innerWidth + 1) return [];
        return ownsHorizontalOverflow(element) ? [] : [controlName(element)];
      });
    const mainRect = mainElement.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.documentElement.clientWidth,
      main: { left: mainRect.left, right: mainRect.right, width: mainRect.width },
      visibleAsideCount: Array.from(document.querySelectorAll<HTMLElement>("aside"))
        .filter(isRendered)
        .filter((aside) => aside.querySelector('[aria-label="Collapse sidebar"], [aria-label="Expand sidebar"]')).length,
      offscreenControls: Array.from(new Set(offscreenControls)),
      invalidDataScrollOwners: Array.from(new Set(invalidDataScrollOwners))
    };
  });
}

function installRuntimeErrorWatch(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function expectModalContained(page: Page, dialog: Locator) {
  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.documentElement.clientWidth
    };
  });
  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.rootOverflow).toBeLessThanOrEqual(1);
  expect(metrics.bodyOverflow).toBeLessThanOrEqual(1);
}

async function expectSharedModalContract(page: Page, dialog: Locator) {
  const metrics = await dialog.evaluate((element) => {
    const layer = element.closest<HTMLElement>("[data-modal-layer='true']");
    const overlay = layer?.firstElementChild as HTMLElement | null;
    const overlayRect = overlay?.getBoundingClientRect();
    const dialogRect = element.getBoundingClientRect();
    return {
      bodyLocked: getComputedStyle(document.body).overflow === "hidden",
      dialog: {
        bottom: dialogRect.bottom,
        left: dialogRect.left,
        right: dialogRect.right,
        top: dialogRect.top
      },
      layerPortaledToBody: layer?.parentElement === document.body,
      overlay: {
        bottom: overlayRect?.bottom ?? Number.NaN,
        left: overlayRect?.left ?? Number.NaN,
        position: overlay ? getComputedStyle(overlay).position : "",
        right: overlayRect?.right ?? Number.NaN,
        top: overlayRect?.top ?? Number.NaN
      },
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth
      }
    };
  });

  expect(metrics.layerPortaledToBody).toBe(true);
  expect(metrics.bodyLocked).toBe(true);
  expect(metrics.overlay.position).toBe("fixed");
  expect(metrics.overlay.left).toBeLessThanOrEqual(1);
  expect(metrics.overlay.top).toBeLessThanOrEqual(1);
  expect(metrics.overlay.right).toBeGreaterThanOrEqual(metrics.viewport.width - 1);
  expect(metrics.overlay.bottom).toBeGreaterThanOrEqual(metrics.viewport.height - 1);
  expect(metrics.dialog.left).toBeGreaterThanOrEqual(0);
  expect(metrics.dialog.top).toBeGreaterThanOrEqual(0);
  expect(metrics.dialog.right).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.dialog.bottom).toBeLessThanOrEqual(metrics.viewport.height);

  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  const focusableSelector = [
    "button:not([disabled])",
    "a[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const focusBoundary = async (position: "first" | "last") => dialog.evaluate((element, input) => {
    const candidates = Array.from(element.querySelectorAll<HTMLElement>(input.selector))
      .filter((candidate) => candidate.getClientRects().length > 0 && candidate.getAttribute("aria-hidden") !== "true");
    const target = input.position === "first" ? candidates[0] : candidates.at(-1);
    target?.focus();
    return candidates.length;
  }, { position, selector: focusableSelector });
  const boundaryIsFocused = (position: "first" | "last") => dialog.evaluate((element, input) => {
    const candidates = Array.from(element.querySelectorAll<HTMLElement>(input.selector))
      .filter((candidate) => candidate.getClientRects().length > 0 && candidate.getAttribute("aria-hidden") !== "true");
    const target = input.position === "first" ? candidates[0] : candidates.at(-1);
    return document.activeElement === target;
  }, { position, selector: focusableSelector });

  expect(await focusBoundary("last")).toBeGreaterThan(1);
  await page.keyboard.press("Tab");
  expect(await boundaryIsFocused("first")).toBe(true);
  await focusBoundary("first");
  await page.keyboard.press("Shift+Tab");
  expect(await boundaryIsFocused("last")).toBe(true);
}

test.describe("responsive route matrix", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await installResponsiveSession(context, page, baseURL);
    await installResponsiveApi(page);
  });

  for (const viewport of viewportMatrix) {
    for (const surface of routeSurfaces) {
      test(`${surface.name} satisfies the ${viewport.name} ${viewport.width}px shell contract`, async ({ page }) => {
        const runtimeErrors = installRuntimeErrorWatch(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(surface.path);
        const routeAnchor = surface.ready(page);
        await expect(routeAnchor).toBeAttached();
        await expect.soft(routeAnchor, "route anchor must not be clipped or hidden").toBeVisible({ timeout: 1_000 });
        if (surface.name === "analytics") {
          await expect(routeAnchor).toHaveAttribute("aria-selected", "true");
        }

        const snapshot = await readResponsiveSnapshot(page, surface);
        expect.soft(snapshot.rootOverflow, "document root must own no horizontal overflow").toBeLessThanOrEqual(1);
        expect.soft(snapshot.bodyOverflow, "body must own no horizontal overflow").toBeLessThanOrEqual(1);

        const mobileNavigationTrigger = page.getByRole("button", { name: "Open navigation" });
        if (viewport.width < 1024) {
          expect.soft(snapshot.visibleAsideCount, "desktop Sidebar must be absent below lg").toBe(0);
          await expect.soft(mobileNavigationTrigger, "mobile navigation trigger must be visible below lg").toBeVisible({ timeout: 1_000 });
          expect.soft(Math.abs(snapshot.main.left), "mobile main must start at the viewport edge").toBeLessThanOrEqual(1);
          expect.soft(Math.abs(snapshot.main.right - snapshot.viewportWidth), "mobile main must end at the viewport edge").toBeLessThanOrEqual(1);
          const triggerBox = await mobileNavigationTrigger.count() > 0 ? await mobileNavigationTrigger.boundingBox() : null;
          if (triggerBox) {
            expect.soft(triggerBox.width, "mobile navigation target width").toBeGreaterThanOrEqual(44);
            expect.soft(triggerBox.height, "mobile navigation target height").toBeGreaterThanOrEqual(44);
          }
        } else {
          expect.soft(snapshot.visibleAsideCount, "desktop Sidebar must be visible at and above lg").toBeGreaterThan(0);
          await expect.soft(mobileNavigationTrigger).toHaveCount(0);
        }

        expect.soft(snapshot.offscreenControls, "visible controls outside the viewport without a data scroller").toEqual([]);
        expect.soft(snapshot.invalidDataScrollOwners, "wide data surfaces must have a scoped horizontal scroll owner").toEqual([]);
        expect.soft(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
      });
    }
  }
});

test.describe("responsive navigation drawer contract", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await installResponsiveSession(context, page, baseURL);
    await installResponsiveApi(page);
  });

  for (const viewport of viewportMatrix.filter((item) => item.width < 1024)) {
    test(`drawer traps focus and closes predictably at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/projects");
      await expect(page.getByRole("heading", { name: "All Projects" })).toBeVisible();

      const trigger = page.getByRole("button", { name: "Open navigation" });
      await expect(trigger).toBeVisible({ timeout: 1_000 });
      await trigger.focus();
      await trigger.click();
      const drawer = page.getByRole("dialog", { name: "Navigation" });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator("button, a[href]").first()).toBeFocused();
      await expect(page.locator("aside:visible")).toHaveCount(0);

      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await trigger.click();
      const usersLink = drawer.getByRole("link", { name: "Users", exact: true });
      await usersLink.click();
      await expect(page).toHaveURL(/\/users$/);
      await expect(drawer).toHaveCount(0);
    });
  }
});

test.describe("responsive task modal containment", () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    await installResponsiveSession(context, page, baseURL);
    await installResponsiveApi(page);
  });

  for (const viewport of viewportMatrix) {
    test(`task logging chooser remains contained at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/tasks/${task.id}`);
      await expect(page.getByRole("heading", { name: task.title })).toBeVisible();

      const trigger = page.getByRole("button", { name: "Ghi giờ", exact: true });
      await trigger.focus();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Ghi nhận & Lên kế hoạch" });
      await expect(dialog).toBeVisible();
      await expectModalContained(page, dialog);
      await expectSharedModalContract(page, dialog);

      await dialog.getByRole("button", { name: /Lên kế hoạch dự kiến/ }).click();
      const planningDialog = page.getByRole("dialog", { name: "Lên kế hoạch dự kiến" });
      await expect(planningDialog).toBeVisible();
      await planningDialog.getByRole("button", { name: /Ngày thực hiện dự kiến/ }).click();
      const datePicker = page.getByRole("dialog", { name: /Ngày thực hiện dự kiến calendar/ });
      await expect(datePicker).toBeVisible();
      const floatingGeometry = await datePicker.evaluate((popover) => {
        const rect = popover.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
        const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
        const centerTarget = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return {
          bodyPortaled: popover.parentElement === document.body,
          fullyVisible:
            rect.left >= viewportLeft
            && rect.top >= viewportTop
            && rect.right <= viewportRight
            && rect.bottom <= viewportBottom,
          hitTestOwned: Boolean(centerTarget && popover.contains(centerTarget)),
          placement: popover.getAttribute("data-date-picker-placement"),
          position: window.getComputedStyle(popover).position,
          zIndex: Number(window.getComputedStyle(popover).zIndex)
        };
      });
      expect(floatingGeometry).toMatchObject({
        bodyPortaled: true,
        fullyVisible: true,
        hitTestOwned: true,
        position: "fixed"
      });
      expect(["up", "down"]).toContain(floatingGeometry.placement);
      expect(floatingGeometry.zIndex).toBeGreaterThanOrEqual(400);
      await datePicker.locator("button").last().focus();
      await page.keyboard.press("Tab");
      await expect.poll(async () => page.evaluate(() => {
        const active = document.activeElement;
        return Boolean(active && Array.from(document.querySelectorAll('[role="dialog"]'))
          .some((visibleDialog) => visibleDialog.contains(active)));
      })).toBe(true);

      if (!await datePicker.isVisible()) {
        await planningDialog.getByRole("button", { name: /Ngày thực hiện dự kiến/ }).click();
      }
      await expect(datePicker).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(datePicker).toHaveCount(0);
      await expect(planningDialog).toBeVisible();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

      await page.keyboard.press("Escape");
      await expect(planningDialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    });
  }
});
