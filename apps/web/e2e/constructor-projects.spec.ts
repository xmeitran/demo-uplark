import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

const fixtureMembers = new WeakMap<Page, Array<{ userId: string; displayName: string; email: string; avatarUrl?: string }>>();

const liveProject = {
  id: "e2e-live-project",
  accountId: "e2e-account",
  accountName: "E2E Customer",
  code: "E2E-001",
  name: "Live CRM Project",
  status: "in_progress",
  opportunityStage: "delivery",
  progressPercent: 64,
  taskCount: 12,
  completedTaskCount: 7,
  stageCount: 4,
  activeStageCount: 1,
  ownerUserId: "usr-e2e",
  ownerDisplayName: "Nguyễn Hùng Việt Kha",
  ownerAvatarUrl: "https://example.com/avatar-kha.png",
  memberUserIds: ["usr-e2e"],
  members: [
    {
      userId: "usr-e2e",
      displayName: "Nguyễn Hùng Việt Kha",
      email: "khanhv@upbase.asia",
      avatarUrl: "https://example.com/avatar-kha.png",
      relation: "member"
    }
  ],
  plannedStartAt: "2026-07-01T00:00:00.000Z",
  plannedEndAt: "2026-07-31T00:00:00.000Z",
  hierarchyOrderVersion: 0
};

const liveStage = {
  id: "e2e-stage-discovery",
  accountId: liveProject.accountId,
  accountName: liveProject.accountName,
  projectId: liveProject.id,
  projectName: liveProject.name,
  milestoneId: "e2e-milestone-discovery",
  milestoneName: "Discovery",
  milestoneSortOrder: 10,
  stageKey: "discovery",
  phase: "Discovery",
  activity: "Scope confirmation",
  sortOrder: 10,
  cumulativePercent: 25,
  activityPercent: 25,
  criteria: "Scope is confirmed from live API data.",
  status: "in_progress",
  ownerUserId: "usr-e2e",
  ownerDisplayName: "Nguyễn Hùng Việt Kha",
  ownerAvatarUrl: "https://example.com/avatar-kha.png",
  plannedStartAt: "2026-07-01T00:00:00.000Z",
  plannedEndAt: "2026-07-08T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

const liveBuildStage = {
  ...liveStage,
  id: "e2e-stage-build",
  stageKey: "build",
  phase: liveStage.phase,
  activity: "Build forecast rules",
  milestoneId: liveStage.milestoneId,
  milestoneName: liveStage.milestoneName,
  milestoneSortOrder: liveStage.milestoneSortOrder,
  sortOrder: 20,
  cumulativePercent: 50,
  activityPercent: 25,
  criteria: "Forecast logic is implemented from the same milestone.",
  status: "not_started",
  plannedStartAt: "2026-07-09T00:00:00.000Z",
  plannedEndAt: "2026-07-15T00:00:00.000Z"
};

const liveMilestonePlaceholderStage = {
  ...liveStage,
  id: "e2e-stage-discovery-placeholder",
  stageKey: "discovery-placeholder",
  activity: liveStage.phase,
  sortOrder: 5,
  status: "not_started",
  criteria: "Milestone shell record that should not render as a duplicate stage.",
  plannedStartAt: "2026-07-01T00:00:00.000Z",
  plannedEndAt: "2026-07-31T00:00:00.000Z"
};

const liveTask = {
  id: "e2e-task-live-migration",
  accountId: liveProject.accountId,
  accountName: liveProject.accountName,
  projectId: liveProject.id,
  projectName: liveProject.name,
  stageId: liveStage.id,
  stageKey: liveStage.stageKey,
  stageActivity: liveStage.activity,
  sortOrder: 10,
  title: "Migrated Lark Base Task",
  description: "This task is supplied by the tasks API for the project detail board.",
  taskType: "dx_manager",
  status: "in_progress",
  priority: "urgent",
  assigneeUserId: "usr-e2e",
  assigneeDisplayName: "Nguyễn Hùng Việt Kha",
  assigneeAvatarUrl: "https://example.com/avatar-kha.png",
  ownerUserId: "usr-e2e",
  ownerDisplayName: "Nguyễn Hùng Việt Kha",
  ownerAvatarUrl: "https://example.com/avatar-kha.png",
  plannedStartAt: "2026-07-01T00:00:00.000Z",
  dueAt: "2026-07-08T00:00:00.000Z",
  estimateMinutes: 150,
  loggedMinutes: 45,
  approvedMinutes: 45,
  overdue: false,
  customerVisible: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  statusHistory: [],
  timeEntries: [
    {
      id: "e2e-time-live",
      taskId: "e2e-task-live-migration",
      accountId: liveProject.accountId,
      projectId: liveProject.id,
      userId: "usr-e2e",
      userDisplayName: "Nguyễn Hùng Việt Kha",
      userAvatarUrl: "https://example.com/avatar-kha.png",
      workDate: "2026-07-02T02:00:00.000Z",
      startAt: "2026-07-02T02:00:00.000Z",
      endAt: "2026-07-02T02:45:00.000Z",
      timeZone: "Asia/Ho_Chi_Minh",
      minutes: 45,
      billable: true,
      workType: "kh_c",
      approvalStatus: "approved",
      note: "Live time entry",
      createdAt: "2026-07-02T00:00:00.000Z"
    }
  ]
};

const unassignedTask = {
  ...liveTask,
  id: "e2e-task-unassigned",
  stageId: null,
  stageKey: null,
  stageActivity: null,
  title: "Unassigned Imported Task",
  description: "This task has no persisted project stage and belongs in the synthetic No Stage bucket.",
  status: "todo",
  priority: "medium",
  plannedStartAt: null,
  dueAt: null,
  estimateMinutes: 0,
  loggedMinutes: 0,
  approvedMinutes: 0,
  timeEntries: []
};

const liveDocument = {
  id: "e2e-doc-handoff",
  accountId: liveProject.accountId,
  accountName: liveProject.accountName,
  projectId: liveProject.id,
  projectName: liveProject.name,
  code: "E2E-DOC-001",
  name: "Live Project Handoff.pdf",
  artifactType: "project_operations",
  storageKey: "project-documents/e2e-live-project/handoff.pdf",
  customerVisible: false,
  internalOnly: true,
  allowedRoles: [],
  signedUrlExpiresSeconds: 300,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z"
};

const liveActivity = {
  id: "e2e-activity-kickoff",
  accountId: liveProject.accountId,
  accountName: liveProject.accountName,
  projectId: liveProject.id,
  projectName: liveProject.name,
  activityType: "note",
  subject: "Live kickoff note from API",
  target: "Delivery team",
  occurredAt: "2026-07-02T00:00:00.000Z",
  occurredTime: "07:00",
  status: "active",
  createdByUserId: "usr-e2e",
  createdByDisplayName: "Constructor Smoke",
  createdByAvatarUrl: "https://example.com/avatar-kha.png",
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z"
};

const extraProjectActivities = Array.from({ length: 10 }, (_, index) => {
  const minute = String(59 - index).padStart(2, "0");
  return {
    ...liveActivity,
    id: `e2e-activity-extra-${index + 1}`,
    subject: `Extra activity ${index + 1}`,
    occurredAt: `2026-07-01T23:${minute}:00.000Z`,
    occurredTime: `06:${minute}`,
    createdAt: `2026-07-01T23:${minute}:00.000Z`,
    updatedAt: `2026-07-01T23:${minute}:00.000Z`
  };
});

const liveRisk = {
  id: "e2e-risk-cutover",
  accountId: liveProject.accountId,
  accountName: liveProject.accountName,
  projectId: liveProject.id,
  projectName: liveProject.name,
  category: "Operational",
  description: "Live operational risk from API",
  likelihood: "Medium",
  impact: "High",
  response: "Track mitigation in delivery cadence",
  switchTrigger: "Escalate when blocked",
  ownerDisplayName: "Live Delivery Lead",
  status: "open",
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z"
};

const liveAccount = {
  id: liveProject.accountId,
  code: "E2E-ACCT",
  name: liveProject.accountName,
  stage: "active",
  ownerTeam: "Delivery",
  picUserId: "usr-e2e",
  picName: "Live Account Owner",
  picEmail: "owner@example.com",
  health: "green",
  annualValue: 240000,
  commercialNote: "Visible clients route smoke"
};

const liveUser = {
  id: "usr-e2e",
  email: "khanhv@upbase.asia",
  displayName: "Nguyễn Hùng Việt Kha",
  avatarUrl: "https://example.com/avatar-kha.png",
  departmentCode: "CDS",
  larkOpenId: "ou_live_kha",
  larkTenantKey: "prod",
  hasResourceProfile: true,
  resourceDisplayRole: "Digital Transformation Lead",
  resourceSkills: ["Lark", "CRM", "Delivery"],
  resourceWeeklyCapacityMinutes: 2400,
  resourceBillableTargetPercent: 70,
  subjectType: "internal",
  status: "active",
  tenantKey: "prod",
  workspaceId: "twk-e2e",
  roleCodes: ["FOUNDER_GM", "DELIVERY_LEAD"],
  accountIds: [liveAccount.id],
  accountNames: [liveAccount.name],
  projectIds: [liveProject.id],
  projectNames: [liveProject.name],
  projectMemberCount: 1,
  assignedTaskCount: 1,
  ownedTaskCount: 0,
  timeEntryCount: 1,
  activeSessionCount: 1,
  lastSeenAt: "2026-07-01T10:00:00.000Z",
  createdAt: "2026-06-30T10:00:00.000Z"
};

const addableProjectUser = {
  ...liveUser,
  id: "usr-e2e-annnie",
  email: "annnie@example.com",
  displayName: "Trần Anh Annie",
  avatarUrl: "https://example.com/avatar-annnie.png",
  resourceDisplayRole: "Sales Owner",
  roleCodes: ["SALES_OWNER"],
  projectIds: [],
  projectNames: [],
  projectMemberCount: 0,
  assignedTaskCount: 0,
  timeEntryCount: 0
};

const initialsCollisionUser = {
  ...liveUser,
  id: "usr-e2e-ngan",
  email: "ngannk@upbase.vn",
  displayName: "Nguyễn Kim Ngân",
  avatarUrl: "https://example.com/avatar-ngan.png",
  resourceDisplayRole: "Project Manager",
  roleCodes: ["DELIVERY_LEAD"],
  projectMemberCount: 1,
  assignedTaskCount: 0,
  ownedTaskCount: 0,
  timeEntryCount: 0
};

const workspaceUsers = [liveUser, addableProjectUser];

function buildCalendarPlanningBlock(startAt: Date) {
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  return {
    id: "e2e-planning-calendar-block",
    taskId: liveTask.id,
    accountId: liveProject.accountId,
    accountName: liveProject.accountName,
    projectId: liveProject.id,
    projectName: liveProject.name,
    userId: liveUser.id,
    userDisplayName: liveUser.displayName,
    userEmail: liveUser.email,
    userAvatarUrl: liveUser.avatarUrl,
    title: "Mobile Calendar Planning Block",
    notes: "Responsive calendar proof",
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    plannedMinutes: 60,
    status: "planned",
    source: "manual",
    createdByUserId: liveUser.id,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z"
  };
}

function projectMembersForIds(userIds: string[]) {
  return Array.from(new Set(userIds))
    .map((userId) => workspaceUsers.find((user) => user.id === userId))
    .filter((user): user is typeof liveUser => Boolean(user))
    .map((user) => ({
      userId: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      relation: "member"
    }));
}

async function newUnauthenticatedPage(context: BrowserContext, seededPage: Page) {
  await context.clearCookies();
  await seededPage.route("**/api/auth/me", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Session is required" }) }));
  return seededPage;
}

async function pinControlNearMainBottom(page: Page, control: Locator) {
  await control.evaluate((node) => {
    const main = document.querySelector("main");
    if (!main) return;
    const controlRect = node.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const controlOffset = controlRect.top - mainRect.top + main.scrollTop;
    main.scrollTop = Math.max(0, controlOffset - main.clientHeight + 28);
  });
  await page.waitForTimeout(100);
}

async function expectActionMenuItemInViewport(page: Page, label: string) {
  const item = page.getByRole("button", { name: label, exact: true });
  await expect(item).toBeVisible();
  const box = await item.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

const projectNavigationLoadingLabels = [
  "Đang tải danh sách dự án...",
  "Đang tải chi tiết dự án...",
  "Loading project...",
  "Loading pinned projects..."
];

const projectNavigationEmptyLabels = [
  "No live projects",
  "Pinned projects unavailable",
  "Project not found",
  "No milestones yet",
  "No timeline yet",
  "No activity yet",
  "No documents yet"
];

async function installProjectNavigationProbe(page: Page, marker: string) {
  await page.evaluate(({ marker, loadingLabels, emptyLabels }) => {
    type ProjectNavigationProbe = {
      marker: string;
      loadingLabels: string[];
      emptyLabels: string[];
      historyReplaceCalls: number;
      tabEvents: number;
      sidebarMarker: string | null;
    };
    const projectWindow = window as typeof window & { __projectNavigationProbe?: ProjectNavigationProbe };
    const probe: ProjectNavigationProbe = {
      marker,
      loadingLabels: [],
      emptyLabels: [],
      historyReplaceCalls: 0,
      tabEvents: 0,
      sidebarMarker: null
    };
    const sidebar = document.querySelector<HTMLElement>("aside");
    if (sidebar) {
      sidebar.dataset.projectNavigationProbe = marker;
      probe.sidebarMarker = marker;
    }
    projectWindow.__projectNavigationProbe = probe;

    const recordVisibleLabels = () => {
      const bodyText = document.body.innerText;
      for (const label of loadingLabels) {
        if (bodyText.includes(label) && !probe.loadingLabels.includes(label)) probe.loadingLabels.push(label);
      }
      for (const label of emptyLabels) {
        if (bodyText.includes(label) && !probe.emptyLabels.includes(label)) probe.emptyLabels.push(label);
      }
    };
    const observer = new MutationObserver(recordVisibleLabels);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    recordVisibleLabels();

    const originalReplaceState = window.history.replaceState.bind(window.history);
    window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
      probe.historyReplaceCalls += 1;
      return originalReplaceState(...args);
    };
    window.addEventListener("b2b-crm:project-tab-navigation", () => {
      probe.tabEvents += 1;
    });
  }, { marker, loadingLabels: projectNavigationLoadingLabels, emptyLabels: projectNavigationEmptyLabels });
}

async function readProjectNavigationProbe(page: Page) {
  return page.evaluate(() => {
    const projectWindow = window as typeof window & {
      __projectNavigationProbe?: {
        marker: string;
        loadingLabels: string[];
        emptyLabels: string[];
        historyReplaceCalls: number;
        tabEvents: number;
        sidebarMarker: string | null;
      };
    };
    const probe = projectWindow.__projectNavigationProbe;
    return {
      marker: probe?.marker ?? null,
      loadingLabels: probe?.loadingLabels ?? [],
      emptyLabels: probe?.emptyLabels ?? [],
      historyReplaceCalls: probe?.historyReplaceCalls ?? -1,
      tabEvents: probe?.tabEvents ?? -1,
      sidebarMarker: document.querySelector<HTMLElement>("aside")?.dataset.projectNavigationProbe ?? null
    };
  });
}

async function readProjectNavigationGeometry(page: Page, projectName: string) {
  return page.evaluate((expectedProjectName) => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const sidebar = document.querySelector<HTMLElement>("aside");
    const shell = sidebar?.parentElement;
    const projectRow = Array.from(sidebar?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.includes(expectedProjectName));
    const main = document.querySelector<HTMLElement>("main");
    if (!sidebar || !shell || !projectRow || !main) throw new Error("Project navigation shell is incomplete");
    return {
      shell: rect(shell),
      sidebar: rect(sidebar),
      projectRow: rect(projectRow),
      main: rect(main),
      mainScrollTop: main.scrollTop,
      windowScrollY: window.scrollY
    };
  }, projectName);
}

function expectProjectNavigationGeometryStable(
  current: Awaited<ReturnType<typeof readProjectNavigationGeometry>>,
  baseline: Awaited<ReturnType<typeof readProjectNavigationGeometry>>,
  includeMain = false
) {
  const expectRect = (actual: typeof current.shell, expected: typeof current.shell) => {
    expect(Math.abs(actual.top - expected.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(1);
  };
  expectRect(current.shell, baseline.shell);
  expectRect(current.sidebar, baseline.sidebar);
  expectRect(current.projectRow, baseline.projectRow);
  if (includeMain) expectRect(current.main, baseline.main);
  expect(current.windowScrollY).toBe(0);
}

async function installLogoutRegressionProbe(page: Page) {
  let logoutCalls = 0;
  let releaseLogout!: () => void;
  const logoutPending = new Promise<void>((resolve) => {
    releaseLogout = resolve;
  });

  await page.route("**/api/auth/session/logout", async (route) => {
    logoutCalls += 1;
    expect(route.request().method()).toBe("POST");
    await logoutPending;
    await route.fulfill({
      status: 303,
      headers: {
        location: "/login?returnTo=%2F&logged_out=1",
        "set-cookie": "lcrm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
      }
    });
  });

  return { calls: () => logoutCalls, release: releaseLogout };
}

async function expectServerBackedLogout(page: Page, context: BrowserContext, logoutCalls: () => number) {
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Sign in to Account", exact: true })).toBeVisible();
  await expect.poll(logoutCalls).toBe(1);
  await expect(page.getByText("Guest", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Workspace User", { exact: true })).toHaveCount(0);
  expect((await context.cookies()).some((cookie) => cookie.name === "lcrm_session" && cookie.value)).toBe(false);

  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprojects$/);
  await expect(page.getByRole("heading", { name: "Sign in to Account", exact: true })).toBeVisible();
  await expect.poll(logoutCalls).toBe(1);
}

async function installHierarchyBoundaryFixture(page: Page) {
  const deliveryStage = {
    ...liveStage,
    id: "e2e-stage-delivery-boundary",
    stageKey: "delivery-boundary",
    phase: "Delivery",
    activity: "Release boundary",
    milestoneId: "e2e-milestone-delivery-boundary",
    milestoneName: "Delivery boundary",
    milestoneSortOrder: 20,
    sortOrder: 10,
    plannedStartAt: "2026-07-16T00:00:00.000Z",
    plannedEndAt: "2026-07-31T00:00:00.000Z"
  };
  const secondTask = {
    ...liveTask,
    id: "e2e-task-live-migration-boundary",
    title: "Second hierarchy boundary task",
    sortOrder: 20
  };

  await page.route("**/api/projects/e2e-live-project**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/projects/${liveProject.id}/stages` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveMilestonePlaceholderStage, liveStage, liveBuildStage, deliveryStage],
          meta: { hierarchyOrderVersion: 0 }
        })
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/assignment-history")) { await route.fallback(); return; }
    if (url.pathname === "/api/tasks" && url.searchParams.get("projectId") === liveProject.id) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveTask, secondTask],
          meta: {
            pagination: { limit: 200, offset: 0, returned: 2, total: 2, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }
    await route.fallback();
  });
}

async function expectHierarchyBoundaries(page: Page, reorderEnabled: boolean) {
  const milestoneItems = page
    .getByRole("list", { name: "Milestones của dự án", exact: true })
    .locator(':scope > [role="listitem"]');
  const stageItems = page
    .getByRole("list", { name: `Stages trong milestone ${liveStage.milestoneName}`, exact: true })
    .locator(':scope > [role="listitem"]');
  const taskItems = page
    .getByRole("list", { name: `Tasks trong stage ${liveStage.activity}`, exact: true })
    .locator(':scope > [role="listitem"]');

  await expect(milestoneItems).toHaveCount(2);
  await expect(stageItems).toHaveCount(2);
  await expect(taskItems).toHaveCount(2);

  const taskDivider = await taskItems.evaluateAll((elements) => {
    const firstStyle = getComputedStyle(elements[0]);
    const secondStyle = getComputedStyle(elements[1]);
    return {
      width: Number.parseFloat(firstStyle.borderBottomWidth) + Number.parseFloat(secondStyle.borderTopWidth),
      styles: [firstStyle.borderBottomStyle, secondStyle.borderTopStyle]
    };
  });
  expect(taskDivider.width).toBeGreaterThanOrEqual(1);
  expect(taskDivider.styles).toContain("solid");

  const expectGap = async (items: Locator, expectedGap: number) => {
    await expect.poll(async () => {
      const first = await items.nth(0).boundingBox();
      const second = await items.nth(1).boundingBox();
      if (!first || !second) return Number.NaN;
      return Math.round(second.y - (first.y + first.height));
    }).toBe(expectedGap);
  };
  await expectGap(stageItems, 10);
  await expectGap(milestoneItems, 20);

  const dragHandles = [
    page.getByRole("button", { name: `Sắp xếp milestone ${liveStage.milestoneName}`, exact: true }),
    page.getByRole("button", { name: `Sắp xếp stage ${liveStage.activity}`, exact: true }),
    page.getByRole("button", { name: `Sắp xếp task ${liveTask.title}`, exact: true })
  ];
  if (reorderEnabled) {
    for (const handle of dragHandles) {
      await expect(handle).toBeVisible();
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  } else {
    for (const handle of dragHandles) await expect(handle).toHaveCount(0);
  }

  const taskDateSelector = '[title="Jul 1, 2026 đến Jul 8, 2026"]:visible';
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(taskItems.first().locator(taskDateSelector)).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(taskItems.first().locator(taskDateSelector)).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:3003").origin;
  fixtureMembers.set(page, [...liveProject.members]);
  let currentLiveTask = { ...liveTask };
  let currentMilestoneName = liveStage.milestoneName;
  await context.addCookies([
    {
      name: "lcrm_session",
      value: "constructor-smoke-session",
      url: origin,
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "Strict"
    }
  ]);

  await page.addInitScript(() => window.localStorage.clear());

  await page.route("https://example.com/avatar-kha.png", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2563eb"/><text x="20" y="25" text-anchor="middle" font-size="13" fill="white">NK</text></svg>`
    });
  });
  await page.route("https://example.com/avatar-annnie.png", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#64748b"/><text x="20" y="25" text-anchor="middle" font-size="13" fill="white">TA</text></svg>`
    });
  });
  await page.route("https://example.com/avatar-ngan.png", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#db2777"/><text x="20" y="25" text-anchor="middle" font-size="13" fill="white">NN</text></svg>`
    });
  });

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subjectId: liveUser.id,
        displayName: liveUser.displayName,
        email: liveUser.email,
        avatarUrl: liveUser.avatarUrl,
        tenantKey: "prod",
        workspaceId: "twk-e2e",
        roleCodes: liveUser.roleCodes
      })
    });
  });

  await page.route(/\/api\/(?:admin|workspace)\/users(?:[/?].*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/admin/users/${liveUser.id}` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: liveUser,
          meta: { tenantKey: "prod" }
        })
      });
      return;
    }

    if (["/api/admin/users", "/api/workspace/users"].includes(url.pathname) && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: workspaceUsers,
          meta: { tenantKey: "prod", total: workspaceUsers.length }
        })
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ message: "Not found" })
    });
  });

  await page.route("**/api/projects/*/members?**", async route => {
    const rows = (fixtureMembers.get(page) ?? []).filter(member => member.userId).map(member => ({ ...member, status: "active", roleCodes: workspaceUsers.find(user => user.id === member.userId)?.roleCodes ?? [] }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: rows, meta: { principalUserId: liveUser.id, permissions: { canManage: true, canLogForOthers: true }, pagination: { limit: 100, offset: 0, returned: rows.length, total: rows.length, hasNextPage: false, hasPreviousPage: false } } }) });
  });
  await page.route("**/api/tasks/*/assignment-history", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }));

  await page.route("**/api/projects**", async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/").filter(Boolean);
    const projectId = parts[parts.length - 1];
    if (url.pathname.endsWith("/members")) { await route.fallback(); return; }

    if (url.pathname === `/api/projects/${liveProject.id}/documents` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveDocument],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "project",
            hiddenFields: [],
            pagination: { limit: 100, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === `/api/projects/${liveProject.id}/activity` && route.request().method() === "GET") {
      expect(url.searchParams.get("limit")).toBe("10");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveActivity, ...extraProjectActivities],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "project",
            hiddenFields: [],
            pagination: { limit: 10, offset: 0, returned: 10, total: 12, hasNextPage: true, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === `/api/projects/${liveProject.id}/risks` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveRisk],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "project",
            hiddenFields: [],
            pagination: { limit: 100, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === `/api/projects/${liveProject.id}/stages` && route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      expect(input.phase).toBe(liveStage.phase);
      expect(input.activity).toBe("Production QA");
      expect(input.activity).not.toBe(input.phase);
      expect(input.ownerUserId).toBe(liveUser.id);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ...liveBuildStage,
          id: "e2e-stage-production-qa",
          stageKey: "production-qa",
          activity: input.activity,
          phase: input.phase,
          status: input.status ?? "in_progress",
          ownerUserId: input.ownerUserId,
          plannedStartAt: input.plannedStartAt,
          plannedEndAt: input.plannedEndAt,
          criteria: input.criteria,
          description: input.description,
          scopeSummary: input.scopeSummary,
          sortOrder: input.sortOrder,
          progressPercent: input.progressPercent ?? 0,
          updatedAt: "2026-07-03T00:00:00.000Z"
        })
      });
      return;
    }

    if (url.pathname === `/api/projects/${liveProject.id}/stages/${liveMilestonePlaceholderStage.id}` && route.request().method() === "PATCH") {
      const input = route.request().postDataJSON();
      expect(url.searchParams.get("scope")).toBe("milestone");
      expect(input.phase).toBe("Discovery Renamed");
      expect(input.activity).toBeUndefined();
      expect(input.ownerUserId).toBeUndefined();
      currentMilestoneName = input.phase;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...liveMilestonePlaceholderStage,
          milestoneName: currentMilestoneName,
          phase: currentMilestoneName,
          activity: currentMilestoneName,
          status: input.status ?? liveStage.status,
          ownerUserId: input.ownerUserId,
          plannedStartAt: input.plannedStartAt,
          plannedEndAt: input.plannedEndAt,
          criteria: input.criteria,
          description: input.description,
          scopeSummary: input.scopeSummary,
          progressPercent: input.progressPercent ?? 25,
          updatedAt: "2026-07-03T00:00:00.000Z"
        })
      });
      return;
    }

    if (url.pathname === `/api/projects/${liveProject.id}/stages/${liveStage.id}` && route.request().method() === "PATCH") {
      const input = route.request().postDataJSON();
      expect(url.searchParams.get("scope")).toBeNull();
      expect(input.activity).toBe("Scope confirmation renamed");
      expect(input.phase).toBeUndefined();
      expect(input.sortOrder).toBeUndefined();
      expect(input.ownerUserId).toBe(liveUser.id);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...liveStage,
          activity: input.activity,
          status: input.status ?? liveStage.status,
          ownerUserId: input.ownerUserId,
          plannedStartAt: input.plannedStartAt,
          plannedEndAt: input.plannedEndAt,
          criteria: input.criteria,
          description: input.description,
          scopeSummary: input.scopeSummary,
          progressPercent: input.progressPercent ?? 25,
          updatedAt: "2026-07-03T00:00:00.000Z"
        })
      });
      return;
    }

    if (url.pathname === `/api/projects/${liveProject.id}/stages` && route.request().method() === "GET") {
      const currentStages = [liveMilestonePlaceholderStage, liveStage, liveBuildStage].map((stage) => ({
        ...stage,
        milestoneName: currentMilestoneName,
        phase: currentMilestoneName,
        activity: stage.id === liveMilestonePlaceholderStage.id ? currentMilestoneName : stage.activity
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: currentStages,
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "project",
            hiddenFields: []
          }
        })
      });
      return;
    }

    if (url.pathname === "/api/projects" && route.request().method() === "GET") {
      expect(url.searchParams.get("limit")).toBe("10");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveProject],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: 10, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === `/api/projects/${liveProject.id}` && route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON();
      const memberUserIds = Array.isArray(patch.memberUserIds) ? patch.memberUserIds : liveProject.memberUserIds;
      fixtureMembers.set(page, projectMembersForIds(memberUserIds));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...liveProject,
          accountId: patch.accountId ?? liveProject.accountId,
          accountName: patch.accountId === liveProject.accountId ? liveProject.accountName : liveProject.accountName,
          code: patch.code ?? liveProject.code,
          name: patch.name ?? liveProject.name,
          status: patch.status ?? liveProject.status,
          plannedStartAt: patch.plannedStartAt ?? liveProject.plannedStartAt,
          plannedEndAt: patch.plannedEndAt ?? liveProject.plannedEndAt,
          memberUserIds,
          members: projectMembersForIds(memberUserIds)
        })
      });
      return;
    }

    if (url.pathname === `/api/projects/${liveProject.id}` && route.request().method() === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deleted: true, id: liveProject.id })
      });
      return;
    }

    await route.fulfill({
      status: projectId === liveProject.id ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(projectId === liveProject.id ? liveProject : { message: "Project not found" })
    });
  });

  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/assignment-history")) { await route.fallback(); return; }
    if (url.pathname === `/api/tasks/${liveTask.id}` && route.request().method() === "PATCH") {
      const input = route.request().postDataJSON();
      expect(input.projectId).toBe(liveProject.id);
      if (input.stageId !== undefined) {
        expect(input.stageId).toBe(liveStage.id);
        expect(input.taskType).toBeUndefined();
      }
      expect(input.title).toMatch(/^Migrated Lark Base Task( renamed)?$/);
      expect(input.ownerTeamId).toBeUndefined();
      if (input.assigneeUserId !== undefined && input.assigneeUserId !== null) {
        expect(input.assigneeUserId).toBe(liveUser.id);
      }
      if (input.ownerUserId !== undefined && input.ownerUserId !== null) {
        expect(input.ownerUserId).toBe(liveUser.id);
      }
      currentLiveTask = {
        ...currentLiveTask,
        title: input.title,
        description: input.description ?? undefined,
        status: input.status ?? currentLiveTask.status,
        priority: input.priority ?? currentLiveTask.priority,
        assigneeUserId: input.assigneeUserId ?? currentLiveTask.assigneeUserId,
        ownerUserId: input.ownerUserId ?? currentLiveTask.ownerUserId,
        plannedStartAt: input.plannedStartAt ?? currentLiveTask.plannedStartAt,
        dueAt: input.dueAt ?? currentLiveTask.dueAt,
        estimateMinutes: input.estimateMinutes ?? currentLiveTask.estimateMinutes,
        updatedAt: "2026-07-03T00:00:00.000Z"
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentLiveTask)
      });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(currentLiveTask)
      });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}/comments` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] })
      });
      return;
    }

    if (url.pathname === "/api/tasks" && url.searchParams.get("assigneeUserId") === liveUser.id) {
      expect(url.searchParams.get("limit")).toBe("20");
      expect(url.searchParams.get("offset")).toBe("0");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [currentLiveTask],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: 20, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === "/api/tasks" && url.searchParams.get("projectId") === liveProject.id) {
      expect(url.searchParams.get("limit")).toBe("200");
      expect(url.searchParams.get("offset")).toBe("0");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [currentLiveTask],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: 200, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        meta: {
          principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
          rowScope: "workspace",
          hiddenFields: [],
          pagination: { limit: 200, offset: 0, returned: 0, total: 0, hasNextPage: false, hasPreviousPage: false }
        }
      })
    });
  });

  await page.route("**/api/accounts**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/accounts" && route.request().method() === "GET") {
      expect(url.searchParams.get("limit")).toBe("100");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveAccount],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: 100, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ message: "Not found" })
    });
  });
});

test("login shows the UpLark Partner CRM brand and keeps a single wrapper focus ring", async ({ page, context }) => {
  const loginPage = await newUnauthenticatedPage(context, page);
  await loginPage.goto("/login");

  await expect(loginPage).toHaveTitle("UpLark Partner CRM");
  await expect(loginPage.getByText("UpLark Partner CRM", { exact: true })).toBeVisible();
  await expect(loginPage.getByRole("img", { name: "UpLark Partner CRM logo" })).toHaveAttribute(
    "src",
    "https://cdn.prod.website-files.com/67d77474ac7150f21af5ec99/67e79517a0b57d64bc5f086d_UB1%201.avif"
  );

  const emailInput = loginPage.getByPlaceholder("username@google.com");
  await emailInput.focus();

  await expect(emailInput).toBeFocused();
  await expect(emailInput).toHaveCSS("outline-style", "none");
  await expect(emailInput).toHaveCSS("outline-width", "0px");
  await expect.poll(async () => loginPage.getByTestId("login-email-field").evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");

  const passwordInput = loginPage.locator('input[autocomplete="current-password"]');
  await passwordInput.focus();

  await expect(passwordInput).toBeFocused();
  await expect(passwordInput).toHaveCSS("outline-style", "none");
  await expect(passwordInput).toHaveCSS("outline-width", "0px");
  await expect.poll(async () => loginPage.getByTestId("login-password-field").evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
});

test("native founder password login retains its HttpOnly session after reload", async ({ page, context }) => {
  const founderSessionToken = "local-founder-session-token";
  const loginPage = await newUnauthenticatedPage(context, page);
  await loginPage.route("**/api/auth/native/password/login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: liveUser.email, password: "Constructor-Test-Password-2026!" });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: {
        "set-cookie": `lcrm_session=${founderSessionToken}; Path=/; HttpOnly; Expires=Fri, 02 Jul 2027 13:15:06 GMT; SameSite=Strict`
      },
      body: JSON.stringify({
        expiresAt: "2027-07-02T13:15:06.135Z"
      })
    });
  });
  await loginPage.route("**/api/auth/me", async (route) => {
    const cookie = route.request().headers().cookie ?? "";
    if (!cookie.includes(`lcrm_session=${founderSessionToken}`)) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Session is invalid or expired" })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subjectId: liveUser.id,
        displayName: liveUser.displayName,
        email: liveUser.email,
        avatarUrl: liveUser.avatarUrl,
        tenantKey: "prod",
        workspaceId: "twk-e2e",
        roleCodes: liveUser.roleCodes
      })
    });
  });

  await loginPage.goto("/login?returnTo=%2Fprojects");
  await loginPage.getByPlaceholder("username@google.com").fill(liveUser.email);
  await loginPage.locator('input[autocomplete="current-password"]').fill("Constructor-Test-Password-2026!");
  await loginPage.getByRole("button", { name: /Sign In/ }).click();

  await expect(loginPage).toHaveURL(/\/projects$/);
  await loginPage.reload();
  await expect(loginPage).toHaveURL(/\/projects$/);
  await expect(loginPage).not.toHaveURL(/\/login/);

  const sessionCookie = (await context.cookies(new URL(loginPage.url()).origin)).find((cookie) => cookie.name === "lcrm_session");
  expect(sessionCookie?.value).toBe(founderSessionToken);
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(await loginPage.evaluate(() => document.cookie)).not.toContain(founderSessionToken);
  expect(await loginPage.evaluate(() => localStorage.getItem("crm_auth_user"))).toBeNull();
  await expect(loginPage.getByRole("heading", { name: "All Projects" })).toBeVisible();
});

test("sidebar logout revokes through the BFF and keeps protected routes on login", async ({ page, context }) => {
  const logoutProbe = await installLogoutRegressionProbe(page);

  await page.goto("/projects");
  await expect(page.getByText(liveUser.email, { exact: true })).toBeVisible();
  await expect(page.getByText("Workspace User", { exact: true })).toHaveCount(0);

  await page.getByText(liveUser.email, { exact: true }).hover();
  await page.getByTitle("Sign out").click({ noWaitAfter: true });

  await expect.poll(logoutProbe.calls).toBe(1);

  logoutProbe.release();
  await expectServerBackedLogout(page, context, logoutProbe.calls);
});

test("dashboard uses the same live projects feed as projects page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Live CRM Project" })).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await expect(page.locator("main").getByText("CRM Platform v2.0")).toHaveCount(0);
  await expect(page.locator("main").getByText("1", { exact: true }).first()).toBeVisible();
});

test("header sign out clears the server session before showing the login page", async ({ page, context }) => {
  let logoutRequests = 0;
  let releaseLogout!: () => void;
  const logoutPending = new Promise<void>((resolve) => {
    releaseLogout = resolve;
  });

  await page.route("**/api/auth/session/logout", async (route) => {
    logoutRequests += 1;
    await logoutPending;
    await route.fulfill({
      status: 303,
      headers: {
        location: "/login?returnTo=%2F&logged_out=1",
        "set-cookie": "lcrm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax"
      }
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Sign Out", exact: true }).click({ noWaitAfter: true });

  await expect.poll(() => logoutRequests).toBe(1);

  releaseLogout();
  await expect(page).toHaveURL(/\/login\?.*logged_out=1/);
  await expect(page.getByRole("status")).toContainText("Bạn đã đăng xuất");
  await expect(page.getByText("Guest", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Workspace User", { exact: true })).toHaveCount(0);
  expect(logoutRequests).toBe(1);
  expect((await context.cookies()).some((cookie) => cookie.name === "lcrm_session" && cookie.value)).toBe(false);

  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fprojects$/);
  await expect(page.getByRole("heading", { name: "Sign in to Account", exact: true })).toBeVisible();
  expect(logoutRequests).toBe(1);
});

test("logout revoke failure still clears the browser session and shows an honest login warning", async ({ page, context }) => {
  await page.route("**/api/auth/session/logout", async (route) => {
    await route.fulfill({
      status: 303,
      headers: {
        location: "/login?returnTo=%2F&auth_error=logout_cleanup_failed",
        "set-cookie": "lcrm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
      }
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Sign Out", exact: true }).click();

  await expect(page).toHaveURL(/\/login\?.*auth_error=logout_cleanup_failed/);
  await expect(page.getByText("chưa xác nhận được thu hồi phiên trên máy chủ", { exact: false })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "lcrm_session" && cookie.value)).toBe(false);
  await expect(page.getByText("Guest", { exact: true })).toHaveCount(0);
});

test("projects page renders real project member avatars from the API", async ({ page }) => {
  await page.goto("/projects");

  await expect(page.getByRole("heading", { name: "All Projects" })).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await expect(page.locator("main").getByText("NK", { exact: true })).toHaveCount(0);
});

test("project sheet presents the delivery summary and opens the project control center", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Project Sheet View", exact: true }).click();

  const sheet = page.getByTestId("project-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Project Sheet", exact: true })).toBeVisible();
  await expect(sheet.getByRole("link", { name: new RegExp(liveProject.name) })).toBeVisible();
  await expect(sheet.getByRole("columnheader", { name: "Plan hour", exact: true })).toBeVisible();
  await expect(sheet.getByRole("columnheader", { name: "Logwork hour", exact: true })).toBeVisible();
  await expect(sheet.getByRole("columnheader", { name: "P&L hour", exact: true })).toBeVisible();

  const controlCenterLink = sheet.getByRole("link", { name: `Open Project Sheet for ${liveProject.name}` });
  await expect(controlCenterLink).toHaveAttribute("href", `/projects/${liveProject.id}?tab=Project%20Sheet`);
});

test("projects search is sent to the API before pagination", async ({ page }) => {
  const projectListRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/projects") {
      projectListRequests.push(url.search);
    }
  });

  await page.goto("/projects");
  const searchInput = page.getByPlaceholder("Search by name, client, description...");
  await searchInput.fill("Live CRM");

  await expect(searchInput).toBeFocused();
  await expect(searchInput).toHaveCSS("outline-width", "2px");

  await expect.poll(() => projectListRequests.some((search) => {
    const params = new URLSearchParams(search);
    return params.get("q") === "Live CRM" && params.get("limit") === "10" && params.get("offset") === "0";
  })).toBe(true);
});

test("projects search filter and pagination keep the page frame stable", async ({ page }) => {
  type FrameBox = { x: number; y: number; width: number; height: number };
  await page.setViewportSize({ width: 2048, height: 832 });

  const projectListRequests: string[] = [];
  let releaseSearchRequest = () => {};
  let releaseNextPageRequest = () => {};
  const searchRequestGate = new Promise<void>((resolve) => {
    releaseSearchRequest = resolve;
  });
  const nextPageRequestGate = new Promise<void>((resolve) => {
    releaseNextPageRequest = resolve;
  });
  let blockSearchRequest = true;
  let blockNextPageRequest = true;
  const stableProjects = Array.from({ length: 12 }, (_, index) => ({
    ...liveProject,
    id: `e2e-live-project-${index + 1}`,
    code: `E2E-${String(index + 1).padStart(3, "0")}`,
    name: `Live CRM Project ${index + 1}`,
    status: index % 2 === 0 ? "in_progress" : "planning",
    opportunityStage: index % 3 === 0 ? "implementation" : "delivery",
    progressPercent: (index * 7) % 100
  }));

  await page.route(/\/api\/projects\?/, async (route) => {
    const url = new URL(route.request().url());
    projectListRequests.push(url.search);

    const limit = Number(url.searchParams.get("limit") ?? "10");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const query = (url.searchParams.get("q") ?? "").toLowerCase();
    const status = url.searchParams.get("status");
    const category = url.searchParams.get("category");

    if (blockSearchRequest && query === "live crm project 12") {
      await searchRequestGate;
      blockSearchRequest = false;
    }
    if (blockNextPageRequest && offset === 10 && !query && !status && !category) {
      await nextPageRequestGate;
      blockNextPageRequest = false;
    }

    let data = stableProjects;
    if (query) {
      data = data.filter((project) => (
        project.name.toLowerCase().includes(query) ||
        project.accountName.toLowerCase().includes(query) ||
        project.code.toLowerCase().includes(query)
      ));
    }
    if (status) {
      data = data.filter((project) => project.status === status);
    }
    if (category) {
      data = data.filter((project) => project.opportunityStage === category.toLowerCase());
    }

    const pageData = data.slice(offset, offset + limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: pageData,
        meta: {
          principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
          rowScope: "workspace",
          hiddenFields: [],
          pagination: {
            limit,
            offset,
            returned: pageData.length,
            total: data.length,
            hasNextPage: offset + pageData.length < data.length,
            hasPreviousPage: offset > 0
          }
        }
      })
    });
  });

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "All Projects" })).toBeVisible();

  const controlBar = page.getByTestId("projects-control-bar");
  const stableShell = page.getByTestId("projects-stable-shell");
  const resultsFrame = page.getByTestId("projects-results-frame");
  const footer = page.getByTestId("projects-pagination-footer");
  const searchInput = page.getByPlaceholder("Search by name, client, description...");
  const nextButton = page.getByRole("button", { name: "Next" });

  const readBox = async (locator: Locator) => {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return box!;
  };
  const expectStableFrame = async (label: string, initial: { shell: FrameBox; control: FrameBox; results: FrameBox; footer: FrameBox }) => {
    const shell = await readBox(stableShell);
    const control = await readBox(controlBar);
    const results = await readBox(resultsFrame);
    const footerBox = await readBox(footer);
    expect(Math.abs(shell.y - initial.shell.y), `${label} shell y`).toBeLessThanOrEqual(1);
    expect(Math.abs(shell.height - initial.shell.height), `${label} shell height`).toBeLessThanOrEqual(1);
    expect(Math.abs(control.y - initial.control.y), `${label} control y`).toBeLessThanOrEqual(1);
    expect(Math.abs(control.height - initial.control.height), `${label} control height`).toBeLessThanOrEqual(1);
    expect(Math.abs(results.y - initial.results.y), `${label} results y`).toBeLessThanOrEqual(1);
    expect(Math.abs(results.height - initial.results.height), `${label} results height`).toBeLessThanOrEqual(1);
    expect(Math.abs(footerBox.y - initial.footer.y), `${label} footer y`).toBeLessThanOrEqual(1);
    expect(Math.abs(footerBox.height - initial.footer.height), `${label} footer height`).toBeLessThanOrEqual(1);
    expect(
      Math.abs((footerBox.y + footerBox.height) - (shell.y + shell.height)),
      `${label} footer bottom alignment`
    ).toBeLessThanOrEqual(1);
  };

  await expect(nextButton).toBeEnabled();
  const initialFrame = {
    shell: await readBox(stableShell),
    control: await readBox(controlBar),
    results: await readBox(resultsFrame),
    footer: await readBox(footer)
  };
  expect(
    Math.abs((initialFrame.footer.y + initialFrame.footer.height) - (initialFrame.shell.y + initialFrame.shell.height)),
    "initial footer bottom alignment"
  ).toBeLessThanOrEqual(1);

  await searchInput.fill("Live CRM Project 12");
  await expect(page.getByRole("status")).toHaveText("Updating projects...");
  await expectStableFrame("during search", initialFrame);
  releaseSearchRequest();
  await expect(page.getByText("Live CRM Project 12")).toBeVisible();
  await expect(nextButton).toBeDisabled();
  await expectStableFrame("after search", initialFrame);

  await searchInput.fill("");
  await expect(nextButton).toBeEnabled();

  await page.getByRole("button", { name: "All Status" }).click();
  await page.getByRole("button", { name: "Active", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Completed", exact: true })).toBeHidden();
  await expect.poll(() => projectListRequests.some((search) => new URLSearchParams(search).get("status") === "in_progress")).toBe(true);
  await expectStableFrame("after status filter", initialFrame);

  await page.getByRole("button", { name: "Active", exact: true }).click();
  await page.getByRole("button", { name: "All Status", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Completed", exact: true })).toBeHidden();
  await expect(nextButton).toBeEnabled();
  await nextButton.click();
  await expect(page.getByRole("status")).toHaveText("Updating projects...");
  await expectStableFrame("during next page", initialFrame);
  releaseNextPageRequest();
  await expect(page.getByText("Live CRM Project 11")).toBeVisible();
  await expect(footer.getByText("Showing 11-12 / 12 projects")).toBeVisible();
  await expectStableFrame("after next page", initialFrame);

  const previousButton = page.getByRole("button", { name: "Previous" });
  await expect(previousButton).toBeEnabled();
  await previousButton.click();
  await expect(footer.getByText("Showing 1-10 / 12 projects")).toBeVisible();
  await expectStableFrame("after previous page", initialFrame);
});

test("sidebar only shows projects pinned by the current user", async ({ page }) => {
  await page.goto("/projects");

  const sidebar = page.locator("aside");
  await expect(sidebar.getByText(liveProject.name)).toHaveCount(0);

  await page.locator('button[title="Push to Sidebar Menu"]').first().click();

  await expect(sidebar.getByText(liveProject.name)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pushed_projects:usr-e2e"))).toContain(liveProject.id);
  expect(await page.evaluate(() => window.localStorage.getItem("pushed_projects"))).toBeNull();
});

test("project sidebar tab links switch smoothly without a document refresh", async ({ page }) => {
  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);
  const sidebar = page.locator("aside");
  await expect(page.getByText("Migrated Lark Base Task")).toBeVisible();
  await page.evaluate((projectId) => {
    window.localStorage.setItem("pushed_projects:usr-e2e", JSON.stringify([projectId]));
    window.dispatchEvent(new Event("pushed_projects_changed"));
    window.dispatchEvent(new CustomEvent("constructor_x_frontend_store_changed", { detail: { entity: "pushed-projects" } }));
  }, liveProject.id);
  await expect(sidebar.getByText(liveProject.name)).toBeVisible();
  await expect(sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Dashboard"]`)).toBeVisible();

  const documentRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      documentRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Dashboard"]`).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Dashboard$`));
  await expect(page.getByText("Mức độ ưu tiên", { exact: true })).toBeVisible();
  await expect(sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Tasks"]`)).toBeVisible();
  expect(documentRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("project sidebar submenu uses one client navigation from the projects index", async ({ page }) => {
  await page.goto("/projects");
  const sidebar = page.locator("aside");
  await page.evaluate((projectId) => {
    window.localStorage.setItem("pushed_projects:usr-e2e", JSON.stringify([projectId]));
    window.dispatchEvent(new Event("pushed_projects_changed"));
    window.dispatchEvent(new CustomEvent("constructor_x_frontend_store_changed", { detail: { entity: "pushed-projects" } }));
  }, liveProject.id);
  await expect(sidebar.getByText(liveProject.name)).toBeVisible();
  await sidebar.getByRole("button", { name: new RegExp(liveProject.name) }).click();
  await expect(sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Timeline"]`)).toBeVisible();

  const documentRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      documentRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Timeline"]`).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Timeline$`));
  await expect(page.getByRole("heading", { name: liveProject.name })).toBeVisible();
  await expect(page.getByText("Scope confirmation").first()).toBeVisible();
  expect(documentRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("pinned project menu stays stable when navigating in from another module", async ({ page }) => {
  let releaseProjectFetch = () => {};
  const projectFetchGate = new Promise<void>((resolve) => {
    releaseProjectFetch = resolve;
  });

  await page.route(`**/api/projects/${liveProject.id}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await projectFetchGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(liveProject)
    });
  });

  await page.addInitScript((projectId) => {
    window.localStorage.setItem("pushed_projects:usr-e2e", JSON.stringify([projectId]));
  }, liveProject.id);

  await page.goto("/users");
  const sidebar = page.locator("aside");

  await expect(sidebar.getByText("No live projects")).toHaveCount(0);
  await expect(sidebar.getByText("Loading pinned projects...")).toBeVisible();

  releaseProjectFetch();
  await expect(sidebar.getByText(liveProject.name)).toBeVisible();
  await expect(sidebar.getByText("Loading pinned projects...")).toHaveCount(0);
  await expect(sidebar.getByText("No live projects")).toHaveCount(0);

  await sidebar.getByRole("button", { name: new RegExp(liveProject.name) }).click();
  await expect(sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Dashboard"]`)).toBeVisible();

  const documentRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      documentRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Dashboard"]`).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Dashboard$`));
  await expect(page.getByRole("heading", { name: liveProject.name })).toBeVisible();
  await expect(sidebar.getByText("No live projects")).toHaveCount(0);
  expect(documentRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("AC-PIN-009 pinned cached navigation keeps one document and one canonical project request without shell flash", async ({ page }) => {
  let canonicalProjectGets = 0;
  let markCanonicalProjectGetStarted!: () => void;
  let releaseCanonicalProjectGet!: () => void;
  const canonicalProjectGetStarted = new Promise<void>((resolve) => {
    markCanonicalProjectGetStarted = resolve;
  });
  const canonicalProjectGetGate = new Promise<void>((resolve) => {
    releaseCanonicalProjectGet = resolve;
  });

  await page.route(`**/api/projects/${liveProject.id}`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.pathname !== `/api/projects/${liveProject.id}`) {
      await route.fallback();
      return;
    }
    canonicalProjectGets += 1;
    markCanonicalProjectGetStarted();
    await canonicalProjectGetGate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liveProject) });
  });

  await page.addInitScript((project) => {
    window.localStorage.setItem("pushed_projects:usr-e2e", JSON.stringify([project.id]));
    window.localStorage.setItem("sidebar_projects_cache:usr-e2e", JSON.stringify([{
      id: project.id,
      name: project.name,
      color: "#2563eb",
      initials: "NK",
      taskCount: project.taskCount
    }]));
  }, liveProject);

  await page.goto("/users");
  await canonicalProjectGetStarted;

  const sidebar = page.locator("aside");
  const projectRow = sidebar.getByRole("button", { name: new RegExp(liveProject.name) });
  await expect(projectRow).toBeVisible();
  await expect(sidebar.getByText("Loading pinned projects...")).toHaveCount(0);
  await projectRow.click();
  const dashboardLink = sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Dashboard"]`);
  await expect(dashboardLink).toBeVisible();

  const marker = "ac-pin-009-document";
  await installProjectNavigationProbe(page, marker);
  const baselineGeometry = await readProjectNavigationGeometry(page, liveProject.name);
  const documentRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await dashboardLink.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Dashboard$`));
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));

  const pendingProbe = await readProjectNavigationProbe(page);
  const pendingGeometry = await readProjectNavigationGeometry(page, liveProject.name);
  releaseCanonicalProjectGet();

  expect(canonicalProjectGets).toBeLessThanOrEqual(1);
  expect(pendingProbe.marker).toBe(marker);
  expect(pendingProbe.loadingLabels).toEqual([]);
  expect(pendingProbe.emptyLabels).toEqual([]);
  expectProjectNavigationGeometryStable(pendingGeometry, baselineGeometry);
  await expect(sidebar.getByText(liveProject.name)).toBeVisible();
  await expect(sidebar.getByText("Loading pinned projects...")).toHaveCount(0);
  await expect(sidebar.getByText("No live projects")).toHaveCount(0);

  await expect(page.getByRole("heading", { name: liveProject.name })).toBeVisible();
  await expect(page.getByText("Mức độ ưu tiên", { exact: true })).toBeVisible();
  await expect.poll(() => canonicalProjectGets).toBe(1);
  const finalProbe = await readProjectNavigationProbe(page);
  expect(finalProbe.marker).toBe(marker);
  expect(finalProbe.loadingLabels).toEqual([]);
  expect(finalProbe.emptyLabels).toEqual([]);
  expect(documentRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expectProjectNavigationGeometryStable(await readProjectNavigationGeometry(page, liveProject.name), baselineGeometry);
});

test("AC-PIN-010 same-project detail controls are request-free stable and active-tab idempotent", async ({ page }) => {
  await page.addInitScript((project) => {
    window.localStorage.setItem("pushed_projects:usr-e2e", JSON.stringify([project.id]));
    window.localStorage.setItem("sidebar_projects_cache:usr-e2e", JSON.stringify([{
      id: project.id,
      name: project.name,
      color: "#2563eb",
      initials: "NK",
      taskCount: project.taskCount
    }]));
  }, liveProject);
  await page.goto(`/projects/${liveProject.id}?tab=Dashboard`);
  await expect(page.getByRole("heading", { name: liveProject.name })).toBeVisible();
  await expect(page.getByText("Live operational risk from API")).toBeVisible();
  await expect(page.getByTestId("project-dashboard-capacity-summary")).toBeVisible();

  const sidebar = page.locator("aside");
  await expect(sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Tasks"]`)).toBeVisible();
  const marker = "ac-pin-010-document";
  await installProjectNavigationProbe(page, marker);

  const documentRequests: string[] = [];
  const rscRequests: string[] = [];
  const projectWorkItemRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === "document") documentRequests.push(request.url());
    if (
      url.pathname === `/projects/${liveProject.id}` &&
      (request.headers().rsc === "1" || url.searchParams.has("_rsc"))
    ) {
      rscRequests.push(request.url());
    }
    if (request.method() !== "GET") return;
    const isProjectRequest = url.pathname === `/api/projects/${liveProject.id}` || url.pathname.startsWith(`/api/projects/${liveProject.id}/`);
    const isProjectTaskRequest = url.pathname === "/api/tasks" && url.searchParams.get("projectId") === liveProject.id;
    if (isProjectRequest || isProjectTaskRequest) projectWorkItemRequests.push(`${url.pathname}${url.search}`);
  });

  const expectStableNavigation = async (expectedHistoryCalls: number, expectedTabEvents: number) => {
    const probe = await readProjectNavigationProbe(page);
    expect(probe.marker).toBe(marker);
    expect(probe.sidebarMarker).toBe(marker);
    expect(probe.loadingLabels).toEqual([]);
    expect(probe.emptyLabels).toEqual([]);
    expect(probe.historyReplaceCalls).toBe(expectedHistoryCalls);
    expect(probe.tabEvents).toBe(expectedTabEvents);
    expect(documentRequests).toEqual([]);
    expect(rscRequests).toEqual([]);
    expect(projectWorkItemRequests).toEqual([]);
  };

  const main = page.locator("main");
  await main.evaluate((element) => {
    element.scrollTop = 64;
  });
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(64);

  const timelineTab = page.getByRole("tab", { name: "Timeline", exact: true });
  await timelineTab.focus();
  const timelineBaseline = await readProjectNavigationGeometry(page, liveProject.name);
  await timelineTab.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Timeline$`));
  await expect(page.getByText("Project Timeline")).toBeVisible();
  await expect(timelineTab).toBeFocused();
  const timelineGeometry = await readProjectNavigationGeometry(page, liveProject.name);
  expectProjectNavigationGeometryStable(timelineGeometry, timelineBaseline, true);
  expect(Math.abs(timelineGeometry.mainScrollTop - timelineBaseline.mainScrollTop)).toBeLessThanOrEqual(1);
  await expectStableNavigation(1, 1);

  await timelineTab.click();
  await expect(page.getByText("Project Timeline")).toBeVisible();
  await expect(timelineTab).toBeFocused();
  await expectStableNavigation(1, 1);

  const dashboardTab = page.getByRole("tab", { name: "Dashboard", exact: true });
  await dashboardTab.focus();
  await dashboardTab.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Dashboard$`));
  await expect(page.getByTestId("project-dashboard-capacity-summary")).toBeVisible();
  await expect(dashboardTab).toBeFocused();
  await expectStableNavigation(2, 2);

  const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
  await overviewTab.focus();
  await overviewTab.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Overview$`));
  await expect(overviewTab).toBeFocused();
  await expectStableNavigation(3, 3);

  const activityDetailControl = page.getByRole("button", { name: "View all", exact: true }).first();
  await activityDetailControl.focus();
  await activityDetailControl.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Activity$`));
  await expect(page.getByTestId("project-activity-feed")).toBeVisible();
  await expectStableNavigation(4, 4);

  const tasksSidebarLink = sidebar.locator(`a[href="/projects/${liveProject.id}?tab=Tasks"]`);
  await tasksSidebarLink.focus();
  await main.evaluate((element) => {
    element.scrollTop = 32;
  });
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(32);
  const tasksBaseline = await readProjectNavigationGeometry(page, liveProject.name);
  await tasksSidebarLink.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Tasks$`));
  await expect(page.getByText(liveTask.title)).toBeVisible();
  await expect(tasksSidebarLink).toBeFocused();
  const tasksGeometry = await readProjectNavigationGeometry(page, liveProject.name);
  expectProjectNavigationGeometryStable(tasksGeometry, tasksBaseline, true);
  expect(Math.abs(tasksGeometry.mainScrollTop - tasksBaseline.mainScrollTop)).toBeLessThanOrEqual(1);
  await expectStableNavigation(5, 5);

  const activeTasksTab = page.getByRole("tab", { name: "Tasks", exact: true });
  await activeTasksTab.focus();
  await activeTasksTab.click();
  await expect(page.getByText(liveTask.title)).toBeVisible();
  await expect(activeTasksTab).toBeFocused();
  await expectStableNavigation(5, 5);
});

test("projects page can edit and delete a project through the persisted API", async ({ page }) => {
  await page.goto("/projects");

  await page.locator('button[title="Edit project"]').first().click();
  await expect(page.getByRole("heading", { name: "Edit Project" })).toBeVisible();
  await page.getByLabel("Project Name").fill("Live CRM Project Updated");
  await page.getByLabel("Project Code").fill("E2E-002");
  await page.getByRole("button", { name: "Save Changes" }).click();

  await expect(page.getByText("Live CRM Project Updated")).toBeVisible();
  await expect(page.getByText("E2E-002 · 4 stages · 12 tasks")).toBeVisible();

  await page.locator('button[title="Delete project"]').first().click();
  await expect(page.getByRole("heading", { name: "Delete Project" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Project", exact: true }).click();

  await expect(page.getByText("Live CRM Project Updated")).toHaveCount(0);
  await expect(page.getByText("No projects found")).toBeVisible();
});

test("dashboard redirects to login instead of rendering seed data when projects API is unauthorized", async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/projects**", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: {
        "set-cookie": "lcrm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
      },
      body: JSON.stringify({ message: "Unauthorized" })
    });
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/login\?returnTo=%2F/);
  await expect(page.locator("main").getByText("CRM Platform v2.0")).toHaveCount(0);
});

test("project detail loads live data and switches workspace tabs", async ({ page }) => {
  await page.goto(`/projects/${liveProject.id}?tab=Dashboard`);

  await expect(page.getByRole("heading", { name: liveProject.name })).toBeVisible();
  await expect(page.getByText("E2E-001 · 4 stages · 12 tasks")).toBeVisible();
  await expect(page.locator("main").getByText("in_progress")).toHaveCount(0);
  await expect(page.locator("main").getByText("In progress", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("CRM Platform v2.0")).toHaveCount(0);
  await expect(page.getByText("Live operational risk from API")).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await expect(page.getByText("Cơ cấu trạng thái task")).toBeVisible();
  await expect(page.getByText("Độ ưu tiên vs. hoàn thành")).toBeVisible();
  await expect(page.getByText("Trạng thái năng lực nhân sự")).toBeVisible();
  await expect(page.getByTestId("project-dashboard-capacity-summary").locator("> div")).toHaveCount(1);
  await expect(page.getByText("Biểu đồ tiến độ tích lũy")).toHaveCount(0);
  await expect(page.getByText("Biểu đồ phân tán")).toHaveCount(0);

  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Timeline", exact: true })).toBeVisible();
  await expect(page.getByText("Project Timeline")).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();

  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("Migrated Lark Base Task")).toBeVisible();
  await expect(page.getByText("Scope confirmation")).toBeVisible();
  await expect(page.getByText("Build forecast rules")).toBeVisible();
  await expect(page.locator("main").getByText("Discovery", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Stage actions for Discovery", exact: true })).toHaveCount(0);
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await expect(page.locator("main").getByText("Run delivery kickoff")).toHaveCount(0);

  await page.getByRole("button", { name: "Add Stage", exact: true }).click();
  const addStageDialog = page.getByRole("dialog", { name: "Add Stage" });
  await expect(addStageDialog).toBeVisible();
  await expect(addStageDialog.getByRole("button", { name: "Create Stage" })).toBeDisabled();
  await expect(addStageDialog.getByText("Selected PIC: Nguyễn Hùng Việt Kha")).toBeVisible();
  await expect(addStageDialog.locator('img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await addStageDialog.getByRole("button", { name: /Nguyễn Hùng Việt Kha/ }).click();
  await expect(addStageDialog.getByRole("option", { name: /Nguyễn Hùng Việt Kha/ })).toBeVisible();
  await expect(addStageDialog.getByRole("option", { name: /Trần Anh Annie/ })).toHaveCount(0);
  await expect(addStageDialog.locator('img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await addStageDialog.getByPlaceholder("e.g. Development, QA, Review...").fill("Discovery");
  await expect(addStageDialog.getByText("Stage name must be different from the milestone name.")).toBeVisible();
  await expect(addStageDialog.getByRole("button", { name: "Create Stage" })).toBeDisabled();
  await addStageDialog.getByPlaceholder("e.g. Development, QA, Review...").fill("Production QA");
  await expect(addStageDialog.getByRole("button", { name: "Create Stage" })).toBeEnabled();
  await addStageDialog.getByRole("button", { name: "Create Stage" }).click();
  await expect(page.locator("main").getByText("Production QA", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("Discovery", { exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "Milestone actions for Discovery", exact: true }).click();
  await page.getByRole("button", { name: "Edit Milestone", exact: true }).click();
  const editMilestoneDialog = page.getByRole("dialog", { name: "Edit Milestone" });
  await expect(editMilestoneDialog).toBeVisible();
  await editMilestoneDialog.locator("input").first().fill("Discovery Renamed");
  await editMilestoneDialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("main").getByText("Discovery Renamed", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("Scope confirmation", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("Build forecast rules", { exact: true })).toBeVisible();
  await expect(page.getByText("Project stage not found")).toHaveCount(0);
  await expect(page.getByText("Internal server error")).toHaveCount(0);

  await page.getByRole("button", { name: "Stage actions for Scope confirmation", exact: true }).click();
  await page.getByRole("button", { name: "Edit Stage", exact: true }).click();
  const editStageDialog = page.getByRole("dialog", { name: "Edit Stage" });
  await expect(editStageDialog).toBeVisible();
  await editStageDialog.locator("input").first().fill("Scope confirmation renamed");
  await editStageDialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("main").getByText("Scope confirmation renamed", { exact: true })).toBeVisible();
  await expect(page.getByText("Internal server error")).toHaveCount(0);

  const taskActionsButton = page.getByRole("button", { name: `Task actions for ${liveTask.title}`, exact: true });
  await taskActionsButton.click({ force: true });
  await page.getByRole("button", { name: "Edit Task", exact: true }).click();
  const editTaskDialog = page.getByRole("dialog", { name: "Edit Task" });
  await expect(editTaskDialog).toBeVisible();
  await editTaskDialog.locator("input").first().fill("Migrated Lark Base Task renamed");
  await editTaskDialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("main").getByText("Migrated Lark Base Task renamed", { exact: true })).toBeVisible();
  await expect(page.getByText("Internal server error")).toHaveCount(0);

  await page.getByRole("button", { name: "Task", exact: true }).first().click();
  const addTaskDialog = page.getByRole("dialog", { name: "Add Task" });
  await expect(addTaskDialog).toBeVisible();
  await expect(addTaskDialog.getByText("Selected assignee: Nguyễn Hùng Việt Kha")).toBeVisible();
  await expect(addTaskDialog.locator('img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await addTaskDialog.getByRole("button", { name: /Nguyễn Hùng Việt Kha/ }).click();
  await expect(addTaskDialog.getByRole("option", { name: /Nguyễn Hùng Việt Kha/ })).toBeVisible();
  await expect(addTaskDialog.getByRole("option", { name: /Trần Anh Annie/ })).toHaveCount(0);
  await expect(addTaskDialog.locator('img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await addTaskDialog.getByRole("button", { name: "Close Add Task" }).click();

  await page.getByText("Migrated Lark Base Task renamed", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${liveTask.id}`));
  await expect(page.getByRole("heading", { name: "Migrated Lark Base Task" })).toBeVisible();
  await expect(page.getByText("Planning cho Calendar")).toHaveCount(0);
  await expect(page.getByText("Thêm ghi nhận giờ làm mới")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ghi giờ" })).toBeVisible();
  await expect(page.getByText("Live time entry")).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  await expect(page.getByText("Quản lý DX").first()).toBeVisible();
  await expect(page.getByText("Rất cao").first()).toBeVisible();
  await expect(page.getByText("KH C").first()).toBeVisible();
  await expect(page.getByText("dx_manager")).toHaveCount(0);
  await expect(page.getByText("urgent")).toHaveCount(0);
  await expect(page.getByText("kh_c")).toHaveCount(0);

  await page.goto(`/projects/${liveProject.id}?tab=Team`);
  await page.getByRole("tab", { name: "Team", exact: true }).click();
  await expect(page.locator("main").getByText("Nguyễn Hùng Việt Kha")).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();

  await page.getByRole("button", { name: "Invite Member" }).click();
  const inviteDialog = page.getByRole("dialog", { name: "Invite Team Member" });
  await expect(inviteDialog).toBeVisible();
  await inviteDialog.getByPlaceholder("Type name, email, or role...").fill("Annie");
  await inviteDialog.getByRole("button", { name: /Trần Anh Annie/ }).click();
  await expect(inviteDialog.locator('img[src="https://example.com/avatar-annnie.png"]').first()).toBeVisible();
  await inviteDialog.getByRole("button", { name: "Add to Project" }).click();
  await expect(inviteDialog).toHaveCount(0);
  await expect(page.locator("main").getByText("Trần Anh Annie")).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-annnie.png"]').first()).toBeVisible();

  await page.getByRole("button", { name: "Remove Trần Anh Annie from project" }).click();
  await expect(page.locator("main").getByText("Trần Anh Annie")).toHaveCount(0);
  await expect(page.locator("main").getByText("Nguyễn Hùng Việt Kha")).toBeVisible();

  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  const activityFeed = page.getByTestId("project-activity-feed");
  await expect(activityFeed).toBeVisible();
  await expect(page.getByTestId("project-activity-empty")).toHaveCount(0);
  await expect(activityFeed.getByText("Real user work stream")).toBeVisible();
  await expect(page.getByText("Live kickoff note from API")).toBeVisible();
  await expect(activityFeed.getByText("Live time entry")).toBeVisible();
  await expect(activityFeed.getByText("0.8h actual")).toBeVisible();
  await expect(activityFeed.getByText("09:00 · GMT+7 · Jul 2, 2026")).toBeVisible();
  await expect(activityFeed.getByText("07:00 · GMT+7 · Jul 2, 2026")).toBeVisible();
  await expect(activityFeed.getByTestId("project-activity-row")).toHaveCount(10);
  await expect(activityFeed.getByText("Showing 1-10 of 12 activity items")).toBeVisible();
  await expect(activityFeed.getByText("1/2")).toBeVisible();
  await activityFeed.getByRole("button", { name: "Next" }).click();
  await expect(activityFeed.getByTestId("project-activity-row")).toHaveCount(2);
  await expect(activityFeed.getByText("Showing 11-12 of 12 activity items")).toBeVisible();
  await expect(activityFeed.getByText("2/2")).toBeVisible();
  await expect(activityFeed.locator('img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
  const activityFeedBox = await activityFeed.boundingBox();
  expect(activityFeedBox?.width ?? 0).toBeGreaterThan(900);

  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await expect(page.getByText("Live Project Handoff.pdf")).toBeVisible();
  await expect(page.locator("main").getByText("No documents found.")).toHaveCount(0);
});

test("project hierarchy consistently displays start and due dates", async ({ page }) => {
  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);
  await expect(page.getByText("Task Board")).toBeVisible();

  await expect(page.getByTitle("Jul 1, 2026 đến Jul 31, 2026")).toBeVisible();
  await expect(page.getByTitle("Jul 9, 2026 đến Jul 15, 2026")).toBeVisible();
  const visibleLiveRange = page.locator('[title="Jul 1, 2026 đến Jul 8, 2026"]:visible');
  const liveTaskItem = page.locator(`[data-hierarchy-kind="task"][data-hierarchy-id="${liveTask.id}"]`);
  const liveTaskVisibleDate = liveTaskItem.locator('[title="Jul 1, 2026 đến Jul 8, 2026"]:visible');
  await expect(visibleLiveRange).toHaveCount(2);
  await expect(liveTaskVisibleDate).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(visibleLiveRange).toHaveCount(2);
  await expect(liveTaskVisibleDate).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect(page.getByText("Project Timeline")).toBeVisible();
  await expect(page.getByTitle("Jul 1, 2026 đến Jul 31, 2026")).toBeVisible();
  await expect(page.getByTitle("Jul 1, 2026 đến Jul 8, 2026")).toBeVisible();
  await expect(page.getByTitle("Jul 9, 2026 đến Jul 15, 2026")).toBeVisible();
  await expect(page.getByTitle(liveStage.milestoneName).first()).toBeVisible();
  await expect(page.getByTitle(liveStage.activity).first()).toBeVisible();
});

for (const scenario of [
  { label: "reorder-authorized", roleCodes: ["FOUNDER_GM"], reorderEnabled: true },
  { label: "read-only", roleCodes: ["SALES_OWNER"], reorderEnabled: false }
]) {
  test(`project hierarchy preserves visual boundaries for ${scenario.label} users`, async ({ page }) => {
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          subjectId: liveUser.id,
          displayName: liveUser.displayName,
          email: liveUser.email,
          tenantKey: "prod",
          workspaceId: "twk-e2e",
          roleCodes: scenario.roleCodes
        })
      });
    });
    await installHierarchyBoundaryFixture(page);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${liveProject.id}?tab=Tasks`);
    await expect(page.getByText("Task Board")).toBeVisible();
    await expectHierarchyBoundaries(page, scenario.reorderEnabled);
  });
}

test("project detail action menus stay visible near the scroll viewport edge", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 640 });
  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);

  await expect(page.getByText("Task Board")).toBeVisible();
  await expect(page.locator("main").getByText("Discovery", { exact: true })).toBeVisible();

  const milestoneMenuButton = page.getByRole("button", { name: "Milestone actions for Discovery", exact: true });
  await pinControlNearMainBottom(page, milestoneMenuButton);
  await milestoneMenuButton.click();
  await expectActionMenuItemInViewport(page, "Delete Milestone");
  await page.keyboard.press("Escape");

  const stageMenuButton = page.getByRole("button", { name: "Stage actions for Scope confirmation", exact: true });
  await pinControlNearMainBottom(page, stageMenuButton);
  await stageMenuButton.click();
  await expectActionMenuItemInViewport(page, "Delete Stage");
  await page.keyboard.press("Escape");

  const taskMenuButton = page.getByRole("button", { name: `Task actions for ${liveTask.title}`, exact: true });
  await pinControlNearMainBottom(page, taskMenuButton);
  await taskMenuButton.click({ force: true });
  await expectActionMenuItemInViewport(page, "Delete Task");
  await page.keyboard.press("Escape");
});

test("project hierarchy exposes dedicated handles and excludes synthetic buckets", async ({ page }) => {
  const deliveryStage = {
    ...liveStage,
    id: "e2e-stage-delivery",
    stageKey: "delivery",
    phase: "Delivery",
    activity: "Release",
    milestoneId: "e2e-milestone-delivery",
    milestoneName: "Delivery",
    milestoneSortOrder: 20,
    sortOrder: 10
  };
  await page.route("**/api/projects/e2e-live-project**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/projects/${liveProject.id}` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveProject)
      });
      return;
    }
    if (url.pathname === `/api/projects/${liveProject.id}/stages` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveStage, deliveryStage],
          meta: { hierarchyOrderVersion: 0 }
        })
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/assignment-history")) { await route.fallback(); return; }
    if (url.pathname === "/api/tasks" && url.searchParams.get("projectId") === liveProject.id) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveTask, unassignedTask],
          meta: {
            pagination: { limit: 200, offset: 0, returned: 2, total: 2, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);

  const discoveryHandle = page.getByRole("button", { name: "Sắp xếp milestone Discovery", exact: true });
  await expect(discoveryHandle).toBeVisible();
  await expect(page.getByRole("button", { name: "Sắp xếp milestone Delivery", exact: true })).toBeVisible();
  await expect(discoveryHandle).toHaveAttribute("aria-roledescription", "sortable");
  await expect(page.getByRole("button", { name: "Sắp xếp milestone Unassigned Tasks", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sắp xếp stage No Stage", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Sắp xếp task ${unassignedTask.title}`, exact: true })).toHaveCount(0);
});

test("project hierarchy hides reorder handles from read-only internal roles", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subjectId: liveUser.id,
        displayName: liveUser.displayName,
        email: liveUser.email,
        tenantKey: "prod",
        workspaceId: "twk-e2e",
        roleCodes: ["SALES_OWNER"]
      })
    });
  });

  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);
  await expect(page.getByText("Task Board")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sắp xếp (milestone|stage|task) / })).toHaveCount(0);
});

test("project hierarchy honors an allowed secondary role binding", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subjectId: liveUser.id,
        displayName: liveUser.displayName,
        email: liveUser.email,
        tenantKey: "prod",
        workspaceId: "twk-e2e",
        roleCodes: ["FINANCE_ADMIN", "DELIVERY_LEAD"]
      })
    });
  });

  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);
  await expect(page.getByText("Task Board")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sắp xếp milestone Discovery", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sắp xếp stage Scope confirmation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Sắp xếp task ${liveTask.title}`, exact: true })).toBeVisible();
});

test("project hierarchy reorders milestones with the real pointer sensor", async ({ page }) => {
  const deliveryStage = {
    ...liveStage,
    id: "e2e-stage-delivery-pointer",
    stageKey: "delivery-pointer",
    phase: "Delivery",
    activity: "Release with pointer",
    milestoneId: "e2e-milestone-delivery-pointer",
    milestoneName: "Delivery",
    milestoneSortOrder: 20,
    sortOrder: 10
  };
  const reorderBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/projects/e2e-live-project**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/projects/${liveProject.id}/hierarchy/order` && route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      reorderBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          kind: body.kind,
          parentId: body.parentId,
          orderedIds: body.orderedIds,
          hierarchyOrderVersion: 1
        })
      });
      return;
    }
    if (url.pathname === `/api/projects/${liveProject.id}` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveProject)
      });
      return;
    }
    if (url.pathname === `/api/projects/${liveProject.id}/stages` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [liveStage, deliveryStage], meta: { hierarchyOrderVersion: 0 } })
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/assignment-history")) { await route.fallback(); return; }
    if (url.pathname === "/api/tasks" && url.searchParams.get("projectId") === liveProject.id) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveTask],
          meta: {
            pagination: { limit: 200, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);

  const discoveryHandle = page.getByRole("button", { name: "Sắp xếp milestone Discovery", exact: true });
  const deliveryHandle = page.getByRole("button", { name: "Sắp xếp milestone Delivery", exact: true });
  await expect(discoveryHandle).toBeVisible();
  await expect(deliveryHandle).toBeVisible();
  await deliveryHandle.scrollIntoViewIfNeeded();
  await discoveryHandle.scrollIntoViewIfNeeded();
  const discoveryBox = await discoveryHandle.boundingBox();
  const deliveryBox = await deliveryHandle.boundingBox();
  expect(discoveryBox).not.toBeNull();
  expect(deliveryBox).not.toBeNull();

  const startX = discoveryBox!.x + discoveryBox!.width / 2;
  const startY = discoveryBox!.y + discoveryBox!.height / 2;
  const targetX = deliveryBox!.x + deliveryBox!.width / 2;
  const targetY = deliveryBox!.y + deliveryBox!.height / 2;
  expect(await page.evaluate(({ x, y }) => {
    return document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label");
  }, { x: startX, y: startY })).toBe("Sắp xếp milestone Discovery");
  const discoveryLabelCountBeforeDrag = await page.getByText("Discovery", { exact: true }).count();
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 12, { steps: 2 });
  await expect(discoveryHandle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => page.getByText("Discovery", { exact: true }).count())
    .toBeGreaterThan(discoveryLabelCountBeforeDrag);
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => reorderBodies).toEqual([{
    kind: "milestone",
    parentId: null,
    orderedIds: ["e2e-milestone-delivery-pointer", "e2e-milestone-discovery"],
    expectedVersion: 0
  }]);
  await expect(page.getByText("Đã lưu thứ tự.", { exact: true })).toBeAttached();
  await expect.poll(async () => {
    const delivery = await deliveryHandle.boundingBox();
    const discovery = await discoveryHandle.boundingBox();
    return Boolean(delivery && discovery && delivery.y < discovery.y);
  }).toBe(true);
});

test.describe("project hierarchy mobile touch", () => {
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("project hierarchy touch sorting preserves mobile scroll and requires delayed activation", async ({ page }) => {
  const deliveryStage = {
    ...liveStage,
    id: "e2e-stage-delivery-touch",
    stageKey: "delivery-touch",
    phase: "Delivery",
    activity: "Release with touch",
    milestoneId: "e2e-milestone-delivery-touch",
    milestoneName: "Delivery",
    milestoneSortOrder: 20,
    sortOrder: 10
  };
  const reorderBodies: Array<Record<string, unknown>> = [];

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });

  await page.route("**/api/projects/e2e-live-project**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/projects/${liveProject.id}/hierarchy/order` && route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      reorderBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          kind: body.kind,
          parentId: body.parentId,
          orderedIds: body.orderedIds,
          hierarchyOrderVersion: 1
        })
      });
      return;
    }
    if (url.pathname === `/api/projects/${liveProject.id}` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveProject)
      });
      return;
    }
    if (url.pathname === `/api/projects/${liveProject.id}/stages` && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [liveStage, deliveryStage], meta: { hierarchyOrderVersion: 0 } })
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/assignment-history")) { await route.fallback(); return; }
    if (url.pathname === "/api/tasks" && url.searchParams.get("projectId") === liveProject.id) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveTask],
          meta: {
            pagination: { limit: 200, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }
    await route.fallback();
  });

  const dispatchTouch = async (
    type: "touchStart" | "touchMove" | "touchEnd",
    x?: number,
    y?: number
  ) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd"
        ? []
        : [{ x: x ?? 0, y: y ?? 0, radiusX: 2, radiusY: 2, force: 1, id: 1 }]
    });
  };

  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);

  const discoveryHandle = page.getByRole("button", { name: "Sắp xếp milestone Discovery", exact: true });
  const deliveryHandle = page.getByRole("button", { name: "Sắp xếp milestone Delivery", exact: true });
  const taskHandle = page.getByRole("button", { name: `Sắp xếp task ${liveTask.title}`, exact: true });
  await expect(discoveryHandle).toBeVisible();
  await expect(deliveryHandle).toBeVisible();
  await expect(taskHandle).toBeVisible();
  for (const handle of [discoveryHandle, deliveryHandle, taskHandle]) {
    await handle.click({ trial: true });
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  const main = page.locator("main");
  await main.evaluate((node) => { node.scrollTop = 0; });
  const discoveryTitle = page.getByText("Discovery", { exact: true }).first();
  await discoveryTitle.scrollIntoViewIfNeeded();
  const contentBox = await discoveryTitle.boundingBox();
  expect(contentBox).not.toBeNull();
  const contentX = contentBox!.x + contentBox!.width / 2;
  const contentY = contentBox!.y + contentBox!.height / 2;
  const scrollBefore = await main.evaluate((node) => node.scrollTop);
  await dispatchTouch("touchStart", contentX, contentY);
  await dispatchTouch("touchMove", contentX, Math.max(80, contentY - 100));
  await dispatchTouch("touchMove", contentX, Math.max(60, contentY - 220));
  await dispatchTouch("touchEnd");
  await expect.poll(async () => main.evaluate((node) => node.scrollTop)).toBeGreaterThan(scrollBefore);
  expect(reorderBodies).toHaveLength(0);

  await discoveryHandle.click({ trial: true });
  let discoveryBox = await discoveryHandle.boundingBox();
  expect(discoveryBox).not.toBeNull();
  let startX = discoveryBox!.x + discoveryBox!.width / 2;
  let startY = discoveryBox!.y + discoveryBox!.height / 2;
  await dispatchTouch("touchStart", startX, startY);
  await page.waitForTimeout(80);
  await dispatchTouch("touchEnd");
  expect(reorderBodies).toHaveLength(0);
  await expect(discoveryHandle).not.toHaveAttribute("aria-pressed", "true");

  // End any momentum from the preceding scroll gesture before starting the
  // delayed drag. Otherwise Chromium can treat the next CDP touch sequence as
  // part of the scroll and never deliver it to the drag handle.
  await main.evaluate((node) => { node.scrollTop = 0; });
  await expect.poll(async () => main.evaluate((node) => node.scrollTop)).toBe(0);
  await discoveryHandle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  discoveryBox = await discoveryHandle.boundingBox();
  const deliveryBox = await deliveryHandle.boundingBox();
  expect(discoveryBox).not.toBeNull();
  expect(deliveryBox).not.toBeNull();
  startX = Math.round(discoveryBox!.x + discoveryBox!.width / 2);
  startY = Math.round(discoveryBox!.y + discoveryBox!.height / 2);
  const targetX = Math.round(deliveryBox!.x + deliveryBox!.width / 2);
  const targetY = Math.round(deliveryBox!.y + deliveryBox!.height / 2);
  expect(await page.evaluate(({ x, y }) => {
    return document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label");
  }, { x: startX, y: startY })).toBe("Sắp xếp milestone Discovery");
  await page.evaluate(() => {
    (window as typeof window & { __hierarchyTouchStartTarget?: string }).__hierarchyTouchStartTarget = "";
    document.addEventListener("touchstart", (event) => {
      (window as typeof window & { __hierarchyTouchStartTarget?: string }).__hierarchyTouchStartTarget =
        (event.target as Element | null)?.closest("button")?.getAttribute("aria-label") ?? "unknown";
    }, { once: true });
  });
  const discoveryLabelCountBeforeDrag = await page.getByText("Discovery", { exact: true }).count();
  await dispatchTouch("touchStart", startX, startY);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __hierarchyTouchStartTarget?: string }).__hierarchyTouchStartTarget
  )).toBe("Sắp xếp milestone Discovery");
  await page.waitForTimeout(260);
  await dispatchTouch("touchMove", startX, startY + 2);
  await expect(discoveryHandle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => page.getByText("Discovery", { exact: true }).count())
    .toBeGreaterThan(discoveryLabelCountBeforeDrag);
  await dispatchTouch("touchMove", targetX, startY + (targetY - startY) / 2);
  await page.waitForTimeout(100);
  await dispatchTouch("touchMove", targetX, Math.round(targetY + deliveryBox!.height / 2 - 2));
  await page.waitForTimeout(100);
  await dispatchTouch("touchEnd");

  await expect.poll(() => reorderBodies).toEqual([{
    kind: "milestone",
    parentId: null,
    orderedIds: ["e2e-milestone-delivery-touch", "e2e-milestone-discovery"],
    expectedVersion: 0
  }]);
  await expect(page.getByText("Đã lưu thứ tự.", { exact: true })).toBeAttached();
});
});

test("project detail dedupes duplicate project members and keeps real avatars", async ({ page }) => {
  await page.route("**/api/projects/e2e-live-project", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    const duplicateMember = {
      ...liveProject.members[0],
      relation: "delivery_lead",
      avatarUrl: undefined
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...liveProject,
        memberUserIds: ["usr-e2e", "usr-e2e"],
        members: [liveProject.members[0], duplicateMember]
      })
    });
  });

  await page.goto(`/projects/${liveProject.id}?tab=Team`);
  await expect(page.getByRole("tab", { name: "Team", exact: true })).toHaveAttribute("aria-selected", "true");

  await expect(page.locator("main").getByText("Nguyễn Hùng Việt Kha", { exact: true })).toHaveCount(1);
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]')).toHaveCount(1);
});

test("project detail No Stage task mutations persist Add Task dates and description without the synthetic stage id", async ({ page }) => {
  const createdTaskBodies: Record<string, unknown>[] = [];
  const patchedTaskBodies: Record<string, unknown>[] = [];
  const createdTaskId = "e2e-task-created-no-stage";
  let createdTaskResponse: Record<string, unknown> | undefined;

  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/assignment-history")) { await route.fallback(); return; }
    const method = route.request().method();

    if (url.pathname === "/api/tasks" && url.searchParams.get("projectId") === liveProject.id && method === "GET") {
      const canonicalTasks = createdTaskResponse
        ? [liveTask, unassignedTask, createdTaskResponse]
        : [liveTask, unassignedTask];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: canonicalTasks,
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: {
              limit: 200,
              offset: 0,
              returned: canonicalTasks.length,
              total: canonicalTasks.length,
              hasNextPage: false,
              hasPreviousPage: false
            }
          }
        })
      });
      return;
    }

    if (url.pathname === "/api/tasks" && method === "POST") {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      createdTaskBodies.push(input);
      createdTaskResponse = {
        ...unassignedTask,
        id: createdTaskId,
        title: input.title,
        description: input.description,
        stageId: input.stageId ?? null,
        stageKey: null,
        stageActivity: null,
        status: input.status ?? "todo",
        priority: input.priority ?? "medium",
        assigneeUserId: input.assigneeUserId ?? liveUser.id,
        ownerUserId: input.ownerUserId ?? liveUser.id,
        plannedStartAt: input.plannedStartAt ?? null,
        dueAt: input.dueAt ?? null,
        estimateMinutes: input.estimateMinutes ?? 0,
        updatedAt: "2026-07-08T00:00:00.000Z"
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(createdTaskResponse)
      });
      return;
    }

    if (url.pathname === `/api/tasks/${createdTaskId}` && method === "GET" && createdTaskResponse) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createdTaskResponse)
      });
      return;
    }

    if (url.pathname === `/api/tasks/${unassignedTask.id}` && method === "PATCH") {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      patchedTaskBodies.push(input);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...unassignedTask,
          title: input.title ?? unassignedTask.title,
          stageId: input.stageId ?? null,
          stageKey: null,
          stageActivity: null,
          description: input.description ?? unassignedTask.description,
          status: input.status ?? unassignedTask.status,
          priority: input.priority ?? unassignedTask.priority,
          assigneeUserId: input.assigneeUserId ?? unassignedTask.assigneeUserId,
          ownerUserId: input.ownerUserId ?? unassignedTask.ownerUserId,
          dueAt: input.dueAt ?? null,
          estimateMinutes: input.estimateMinutes ?? 0,
          updatedAt: "2026-07-08T00:00:00.000Z"
        })
      });
      return;
    }

    await route.fallback();
  });

  await page.setViewportSize({ width: 1080, height: 1080 });
  await page.clock.setFixedTime(new Date("2026-07-13T09:00:00.000Z"));
  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);

  await expect(page.locator("main").getByText("Unassigned Tasks", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("No Stage", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText(unassignedTask.title, { exact: true })).toBeVisible();

  const noStageSection = page
    .locator("main")
    .getByText("No Stage", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  await noStageSection.getByRole("button", { name: "Task", exact: true }).click();
  const addTaskDialog = page.getByRole("dialog", { name: "Add Task" });
  await expect(addTaskDialog).toBeVisible();
  await addTaskDialog.getByPlaceholder("Describe the task...").fill("Task created from No Stage");
  await addTaskDialog
    .getByPlaceholder("Describe the scope or deliverables of this task...")
    .fill("  Persist this task description across detail hydration.  ");

  const selectTaskDate = async (fieldLabel: string, day: number) => {
    const field = addTaskDialog.getByText(fieldLabel, { exact: true }).locator("..");
    const trigger = field.getByRole("button").first();
    await trigger.click();
    const calendarLabel = fieldLabel.startsWith("Start") ? "Start Date calendar" : "Due Date calendar";
    const calendar = page.getByRole("dialog", { name: calendarLabel }).last();
    await expect(calendar).toBeVisible();

    const calendarBox = await calendar.boundingBox();
    const footerBox = await addTaskDialog.locator('[data-modal-footer="true"]').boundingBox();
    const viewport = page.viewportSize();
    expect(calendarBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(calendarBox!.x).toBeGreaterThanOrEqual(0);
    expect(calendarBox!.y).toBeGreaterThanOrEqual(0);
    expect(calendarBox!.x + calendarBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(calendarBox!.y + calendarBox!.height).toBeLessThanOrEqual(viewport!.height);
    expect(calendarBox!.y + calendarBox!.height <= footerBox!.y || calendarBox!.y >= footerBox!.y + footerBox!.height).toBe(true);
    expect(await calendar.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && node.contains(hit));
    })).toBe(true);

    if (fieldLabel.startsWith("Start")) {
      await calendar.getByRole("button", { name: "Next month" }).click();
      const rovingDay = calendar.locator('[role="gridcell"][tabindex="0"]');
      await expect(rovingDay).toHaveCount(1);
      await expect(rovingDay).toBeFocused();
      await calendar.getByRole("button", { name: "Previous month" }).click();
      await expect(calendar.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    }

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: calendarLabel })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(calendar).toBeVisible();

    await calendar.getByRole("gridcell", { name: `July ${day}, 2026`, exact: true }).click();
  };

  await selectTaskDate("Start Date (optional)", 20);
  await page.setViewportSize({ width: 390, height: 844 });
  await addTaskDialog.locator('[data-modal-body="true"]').evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await selectTaskDate("Due Date (optional)", 18);
  await page.setViewportSize({ width: 1080, height: 1080 });
  await addTaskDialog.getByRole("button", { name: "Add Task", exact: true }).click();
  await expect(addTaskDialog.getByRole("alert")).toHaveText("Start Date must be on or before Due Date.");
  expect(createdTaskBodies).toHaveLength(0);

  await selectTaskDate("Due Date (optional)", 22);
  await addTaskDialog.getByRole("button", { name: "Add Task", exact: true }).click();
  await expect(addTaskDialog).toHaveCount(0);

  const unassignedTaskActions = page.getByRole("button", { name: `Task actions for ${unassignedTask.title}`, exact: true });
  await unassignedTaskActions.click({ force: true });
  await page.getByRole("button", { name: "Edit Task", exact: true }).click();
  const editTaskDialog = page.getByRole("dialog", { name: "Edit Task" });
  await expect(editTaskDialog).toBeVisible();
  await editTaskDialog.locator("input").first().fill("Unassigned Imported Task renamed");
  await editTaskDialog.getByRole("button", { name: "Save Changes" }).click();

  await expect.poll(() => createdTaskBodies.length).toBe(1);
  await expect.poll(() => patchedTaskBodies.length).toBe(1);

  expect(createdTaskBodies[0].projectId).toBe(liveProject.id);
  expect(createdTaskBodies[0].stageId ?? null).toBeNull();
  expect(createdTaskBodies[0].stageId).not.toBe("__unassigned_stage__");
  expect(createdTaskBodies[0].description).toBe("Persist this task description across detail hydration.");
  expect(createdTaskBodies[0].plannedStartAt).toBe(new Date("Jul 20, 2026").toISOString());
  expect(createdTaskBodies[0].dueAt).toBe(new Date("Jul 22, 2026").toISOString());
  expect(patchedTaskBodies[0].projectId).toBe(liveProject.id);
  expect(patchedTaskBodies[0].stageId ?? null).toBeNull();
  expect(patchedTaskBodies[0].stageId).not.toBe("__unassigned_stage__");

  await page.getByText("Task created from No Stage", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${createdTaskId}`));
  await expect(page.getByRole("heading", { name: "Task created from No Stage" })).toBeVisible();
  await expect(page.getByText("Persist this task description across detail hydration.", { exact: true })).toBeVisible();
  await expect(page.getByText("20/07/2026", { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Task created from No Stage" })).toBeVisible();
  await expect(page.getByText("Persist this task description across detail hydration.", { exact: true })).toBeVisible();
  await expect(page.getByText("20/07/2026", { exact: true }).first()).toBeVisible();
  expect(createdTaskBodies).toHaveLength(1);
});

test("legacy workspace nonmember assignee requires an explicit current project member without a native alert", async ({ page }) => {
  const workspaceHydrationUser = {
    ...liveUser,
    id: "usr-workspace-alias-same-email"
  };
  const legacyNonmemberUser = {
    ...addableProjectUser,
    id: "usr-lark-ou_9e402519a965d0e26e3dbfc713d15e57",
    email: "legacy-nonmember@example.com",
    displayName: "Legacy Workspace Nonmember",
    projectIds: [],
    projectNames: [],
    projectMemberCount: 0
  };
  const legacyAssignedTask = {
    ...liveTask,
    id: "e2e-task-legacy-nonmember",
    title: "Legacy Nonmember Assignment",
    assigneeUserId: legacyNonmemberUser.id,
    assigneeDisplayName: legacyNonmemberUser.displayName,
    assigneeAvatarUrl: legacyNonmemberUser.avatarUrl,
    ownerUserId: legacyNonmemberUser.id,
    ownerDisplayName: legacyNonmemberUser.displayName,
    ownerAvatarUrl: legacyNonmemberUser.avatarUrl
  };
  const initialsOnlyTask = {
    ...liveTask,
    id: "e2e-task-initials-only",
    title: "Initials Only Assignment",
    assigneeUserId: undefined,
    assigneeDisplayName: liveUser.displayName,
    ownerUserId: undefined,
    ownerDisplayName: liveUser.displayName
  };
  const patchedTaskBodies: Array<Record<string, unknown>> = [];
  const nativeDialogMessages: string[] = [];

  page.on("dialog", async (dialog) => {
    nativeDialogMessages.push(dialog.message());
    await dialog.dismiss();
  });

  await page.route(/\/api\/(?:admin|workspace)\/users(?:[/?].*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (["/api/admin/users", "/api/workspace/users"].includes(url.pathname) && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [workspaceHydrationUser, legacyNonmemberUser],
          meta: { tenantKey: "prod", total: 2 }
        })
      });
      return;
    }
    await route.fallback();
  });

  await page.route(`**/api/projects/${liveProject.id}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveProject)
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/assignment-history")) { await route.fallback(); return; }
    if (url.pathname === "/api/tasks" && url.searchParams.get("projectId") === liveProject.id) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [legacyAssignedTask, initialsOnlyTask],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "project",
            hiddenFields: [],
            pagination: { limit: 200, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === `/api/tasks/${legacyAssignedTask.id}` && route.request().method() === "PATCH") {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      patchedTaskBodies.push(input);
      expect(input.assigneeUserId).toBe(liveUser.id);
      expect(input.ownerUserId).toBe(liveUser.id);
      expect(input.assigneeUserId).not.toBe(workspaceHydrationUser.id);
      expect(input.assigneeUserId).not.toBe(legacyNonmemberUser.id);
      if (patchedTaskBodies.length === 1) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            statusCode: 400,
            message: `User(s) are not project members: ${legacyNonmemberUser.id}`,
            error: "Bad Request"
          })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...legacyAssignedTask,
          ...input,
          assigneeUserId: liveUser.id,
          assigneeDisplayName: liveUser.displayName,
          assigneeAvatarUrl: liveUser.avatarUrl,
          ownerUserId: liveUser.id,
          ownerDisplayName: liveUser.displayName,
          ownerAvatarUrl: liveUser.avatarUrl
        })
      });
      return;
    }

    await route.fallback();
  });

  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);
  await expect(page.locator("main").getByText(legacyAssignedTask.title, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Task actions for ${legacyAssignedTask.title}`, exact: true }).click({ force: true });
  await page.getByRole("button", { name: "Edit Task", exact: true }).click();
  const editTaskDialog = page.getByRole("dialog", { name: "Edit Task" });
  const saveButton = editTaskDialog.getByRole("button", { name: "Save Changes", exact: true });

  await expect(editTaskDialog).toBeVisible();
  await expect(editTaskDialog.getByText(/not a current project member/i)).toBeVisible();
  await expect(editTaskDialog.getByText(legacyNonmemberUser.id, { exact: false })).toHaveCount(0);
  await expect(saveButton).toBeDisabled();
  expect(patchedTaskBodies).toHaveLength(0);

  await editTaskDialog.getByRole("button", { name: /Select task assignee|Nguyễn Hùng Việt Kha/ }).click();
  await expect(editTaskDialog.getByRole("option", { name: /Legacy Workspace Nonmember/ })).toHaveCount(0);
  await editTaskDialog.getByRole("option", { name: /Nguyễn Hùng Việt Kha/ }).click();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect.poll(() => patchedTaskBodies.length).toBe(1);
  await expect(editTaskDialog).toBeVisible();
  await expect(editTaskDialog.getByRole("alert")).toContainText("not a current project member");
  await expect(editTaskDialog.getByText(legacyNonmemberUser.id, { exact: false })).toHaveCount(0);
  await expect(saveButton).toBeEnabled();
  expect(nativeDialogMessages).toEqual([]);

  await editTaskDialog.getByRole("button", { name: /Nguyễn Hùng Việt Kha/ }).click();
  await editTaskDialog.getByRole("option", { name: /Nguyễn Hùng Việt Kha/ }).click();
  await saveButton.click();

  await expect.poll(() => patchedTaskBodies.length).toBe(2);
  expect(patchedTaskBodies[0].assigneeUserId).toBe(liveUser.id);
  expect(patchedTaskBodies[0].ownerUserId).toBe(liveUser.id);
  expect(patchedTaskBodies[0].assigneeUserId).not.toBe(workspaceHydrationUser.id);
  expect(patchedTaskBodies[0].assigneeUserId).not.toBe(legacyNonmemberUser.id);
  expect(patchedTaskBodies[1].assigneeUserId).toBe(liveUser.id);
  expect(patchedTaskBodies[1].ownerUserId).toBe(liveUser.id);
  expect(patchedTaskBodies[1].assigneeUserId).not.toBe(workspaceHydrationUser.id);
  expect(patchedTaskBodies[1].assigneeUserId).not.toBe(legacyNonmemberUser.id);
  expect(nativeDialogMessages).toEqual([]);
  await expect(page.getByText(legacyNonmemberUser.id, { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: `Task actions for ${initialsOnlyTask.title}`, exact: true }).click({ force: true });
  await page.getByRole("button", { name: "Edit Task", exact: true }).click();
  const initialsOnlyDialog = page.getByRole("dialog", { name: "Edit Task" });
  await expect(initialsOnlyDialog.getByText(/not a current project member/i)).toBeVisible();
  await expect(initialsOnlyDialog.getByRole("button", { name: "Save Changes", exact: true })).toBeDisabled();
  await expect.poll(() => patchedTaskBodies.length).toBe(2);
});

test("project invite preserves canonical member IDs without inferring identity from display names", async ({ page }) => {
  const legacyWorkspaceUser = {
    ...liveUser,
    id: "usr-e2e-legacy-lb",
    email: "legacy.lb@example.com",
    displayName: "Legacy Buyer",
    avatarUrl: undefined,
    resourceDisplayRole: "Delivery Lead",
    roleCodes: ["DELIVERY_LEAD"],
    projectIds: [liveProject.id],
    projectNames: [liveProject.name],
    projectMemberCount: 1,
    assignedTaskCount: 0,
    timeEntryCount: 0
  };
  const projectWithDisplayOnlyMember = {
    ...liveProject,
    memberUserIds: [legacyWorkspaceUser.id],
    members: [
      {
        userId: legacyWorkspaceUser.id,
        displayName: legacyWorkspaceUser.displayName,
        email: legacyWorkspaceUser.email,
        relation: "member"
      }
    ]
  };
  fixtureMembers.set(page, projectWithDisplayOnlyMember.members);
  let patchedMemberUserIds: string[] | undefined;

  await page.route(/\/api\/(?:admin|workspace)\/users(?:[/?].*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (["/api/admin/users", "/api/workspace/users"].includes(url.pathname) && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [legacyWorkspaceUser, addableProjectUser],
          meta: { tenantKey: "prod", total: 2 }
        })
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/projects/e2e-live-project", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(projectWithDisplayOnlyMember)
      });
      return;
    }

    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON();
      patchedMemberUserIds = patch.memberUserIds;
      fixtureMembers.set(page, [projectWithDisplayOnlyMember.members[0], ...projectMembersForIds([addableProjectUser.id])]);
      expect(patchedMemberUserIds).toEqual([legacyWorkspaceUser.id, addableProjectUser.id]);
      expect(patchedMemberUserIds).not.toContain("LB");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...liveProject,
          memberUserIds: patchedMemberUserIds,
          members: [
            {
              userId: legacyWorkspaceUser.id,
              displayName: legacyWorkspaceUser.displayName,
              email: legacyWorkspaceUser.email,
              relation: "member"
            },
            {
              userId: addableProjectUser.id,
              displayName: addableProjectUser.displayName,
              email: addableProjectUser.email,
              avatarUrl: addableProjectUser.avatarUrl,
              relation: "member"
            }
          ]
        })
      });
      return;
    }

    await route.fallback();
  });

  await page.goto(`/projects/${liveProject.id}?tab=Team`);
  await expect(page.getByRole("tab", { name: "Team", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("main").getByText("Legacy Buyer", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Invite Member" }).click();
  const inviteDialog = page.getByRole("dialog", { name: "Invite Team Member" });
  await inviteDialog.getByPlaceholder("Type name, email, or role...").fill("Annie");
  await inviteDialog.getByRole("button", { name: /Trần Anh Annie/ }).click();
  await inviteDialog.getByRole("button", { name: "Add to Project" }).click();

  await expect.poll(() => patchedMemberUserIds).toEqual([legacyWorkspaceUser.id, addableProjectUser.id]);
  await expect(page.locator("main").getByText("Unknown or inactive project user")).toHaveCount(0);
  await expect(page.locator("main").getByText("Trần Anh Annie", { exact: true })).toBeVisible();
});

test("project detail does not merge different users that only share initials", async ({ page }) => {
  const projectWithInitialCollision = {
    ...liveProject,
    memberUserIds: [initialsCollisionUser.id, liveUser.id],
    members: [
      {
        userId: initialsCollisionUser.id,
        displayName: initialsCollisionUser.displayName,
        email: initialsCollisionUser.email,
        avatarUrl: initialsCollisionUser.avatarUrl,
        relation: "PM_OWNER"
      },
      liveProject.members[0]
    ]
  };

  await page.route(/\/api\/(?:admin|workspace)\/users(?:[/?].*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (["/api/admin/users", "/api/workspace/users"].includes(url.pathname) && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [liveUser, initialsCollisionUser],
          meta: { tenantKey: "prod", total: 2 }
        })
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/projects/e2e-live-project", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projectWithInitialCollision)
    });
  });

  fixtureMembers.set(page, projectWithInitialCollision.members);
  await page.goto(`/projects/${liveProject.id}?tab=Overview`);

  await expect(page.locator("main").getByText("Nguyễn Kim Ngân", { exact: true }).first()).toBeVisible();
  await expect(page.locator("main").getByText("Nguyễn Hùng Việt Kha", { exact: true }).first()).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-ngan.png"]').first()).toBeVisible();
  await expect(page.locator('main img[src="https://example.com/avatar-kha.png"]').first()).toBeVisible();
});

test("unknown project route never falls back to the first seed project", async ({ page }) => {
  await page.goto("/projects/not-a-real-project?tab=Overview");

  await expect(page.getByRole("heading", { name: "Project not found" })).toBeVisible();
  await expect(page.locator("main").getByText("CRM Platform v2.0")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to projects" })).toBeVisible();
});

test("clients route uses accounts API instead of client seed data", async ({ page }) => {
  await page.goto("/clients");

  await expect(page.getByRole("heading", { name: "Client Accounts" })).toBeVisible();
  await expect(page.getByText(liveAccount.name)).toBeVisible();
  await expect(page.getByText("Live Account Owner")).toBeVisible();
  await expect(page.locator("main").getByText("Apex Technologies")).toHaveCount(0);
  await expect(page.locator("main").getByText("Alice Nguyen")).toHaveCount(0);
});

test("user detail uses the live profile endpoint and keeps the latest profile frontend", async ({ page }) => {
  const userApiRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/admin/users")) {
      userApiRequests.push(url.pathname);
    }
  });

  await page.goto(`/users/${liveUser.id}`);

  await expect(page.getByRole("heading", { name: liveUser.displayName })).toBeVisible();
  await expect(page.locator("main").getByText(liveUser.email).first()).toBeVisible();
  await expect(page.getByText("Lark SSO linked")).toBeVisible();
  await expect(page.getByText("Digital Transformation Lead")).toBeVisible();
  await expect(page.locator("main").getByText("Alice Nguyen")).toHaveCount(0);
  await expect(page.locator("main").getByText("John Smith")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Email" })).toHaveAttribute("href", `mailto:${liveUser.email}`);
  await expect(page.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page).toHaveURL(/tab=Activity/);
  await expect(page.getByRole("button", { name: "Activity" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Identity Activity")).toBeVisible();

  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
  expect(page.url()).not.toContain("tab=");

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/tab=Projects/);
  await expect(page.getByRole("button", { name: "Projects", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(liveProject.name)).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(liveProject.name) })).toHaveAttribute("href", `/projects/${liveProject.id}`);

  await page.getByRole("button", { name: "Tasks" }).click();
  await expect(page).toHaveURL(/tab=Tasks/);
  await expect(page.getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(liveTask.title)).toBeVisible();
  const taskLink = page.getByRole("link", { name: `Open task ${liveTask.title}` });
  await expect(taskLink).toHaveAttribute("href", `/projects/${liveProject.id}?tab=Tasks`);

  await expect.poll(() => userApiRequests.includes(`/api/admin/users/${liveUser.id}`)).toBe(true);
  expect(userApiRequests.some((path) => path === "/api/admin/users")).toBe(false);

  await taskLink.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Tasks`));
  await expect(page.getByRole("heading", { name: liveProject.name })).toBeVisible();
});

test("sidebar exposes production Calendar while disabled placeholder modules stay hidden", async ({ page }) => {
  await page.goto("/");

  const sidebar = page.locator("aside");
  await expect(sidebar.getByText(liveProject.name)).toHaveCount(0);
  await expect(sidebar.getByText("Notes", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Messenger", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Activity", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Statistic", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Calendar", { exact: true })).toBeVisible();
  await expect(sidebar.locator('a[href="/calendar"]')).toBeVisible();
  await expect(sidebar.getByText("Settings", { exact: true })).toBeVisible();

  await page.goto("/notes");

  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByText("Not active in production")).toBeVisible();
  await expect(page.getByText("Q4 Product Roadmap")).toHaveCount(0);
});

test("calendar direct route uses full-width mobile shell while Calendar is production-enabled", async ({ page }) => {
  await page.route("**/api/tasks/planning-blocks**", async (route) => {
    const url = new URL(route.request().url());
    const windowStart = new Date(url.searchParams.get("startAt") ?? "2026-06-29T00:00:00.000Z");
    const blockStart = new Date(windowStart);
    blockStart.setDate(blockStart.getDate() + 2);
    blockStart.setHours(9, 0, 0, 0);
    const planningBlock = buildCalendarPlanningBlock(blockStart);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [planningBlock],
        meta: {
          principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
          rowScope: "workspace",
          hiddenFields: [],
          startAt: url.searchParams.get("startAt"),
          endAt: url.searchParams.get("endAt"),
          pagination: { limit: 200, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
        }
      })
    });
  });
  await page.route("**/api/tasks/time-entries**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        meta: {
          principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
          rowScope: "workspace",
          hiddenFields: [],
          startAt: url.searchParams.get("startAt"),
          endAt: url.searchParams.get("endAt"),
          pagination: { limit: 200, offset: 0, returned: 0, total: 0, hasNextPage: false, hasPreviousPage: false }
        }
      })
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calendar");

  await expect(page.getByText("Lịch trình kế hoạch")).toBeVisible();
  await expect(page.getByText("Mobile Calendar Planning Block")).toBeVisible();
  await expect(page.getByTestId("calendar-mobile-shell")).toBeVisible();
  await expect(page.getByTestId("calendar-desktop-sidebar")).toBeHidden();

  const metrics = await page.getByTestId("calendar-main").evaluate((main) => {
    const mainRect = main.getBoundingClientRect();
    const firstCard = Array.from(document.querySelectorAll('[data-testid="calendar-event-card"]')).find((element) => {
      return element.textContent?.includes("Mobile Calendar Planning Block");
    });
    return {
      bodyScrollWidth: document.body.scrollWidth,
      cardWidth: firstCard?.getBoundingClientRect().width ?? 0,
      mainLeft: mainRect.left,
      mainWidth: mainRect.width,
      viewportWidth: window.innerWidth
    };
  });

  expect(metrics.mainLeft).toBeLessThanOrEqual(1);
  expect(metrics.mainWidth).toBeGreaterThanOrEqual(360);
  expect(metrics.cardWidth).toBeGreaterThan(24);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
});

test("calendar filters every view and summary by project and member on desktop and mobile", async ({ page }) => {
  const secondProject = { id: "e2e-calendar-project-two", name: "Dự án Beta" };

  await page.route("**/api/tasks/planning-blocks**", async (route) => {
    const url = new URL(route.request().url());
    const rangeStart = new Date(url.searchParams.get("startAt") ?? "2026-07-27T00:00:00.000Z");
    const at = (dayOffset: number, hour: number) => {
      const date = new Date(rangeStart);
      date.setUTCDate(date.getUTCDate() + dayOffset);
      date.setUTCHours(hour, 0, 0, 0);
      return date;
    };
    const planningBlocks = [
      {
        ...buildCalendarPlanningBlock(at(1, 2)),
        id: "calendar-project-a-user-one",
        title: "Alpha của Kha",
        plannedMinutes: 60
      },
      {
        ...buildCalendarPlanningBlock(at(2, 3)),
        id: "calendar-project-a-user-two",
        title: "Alpha của Annie",
        userId: addableProjectUser.id,
        userDisplayName: addableProjectUser.displayName,
        userEmail: addableProjectUser.email,
        userAvatarUrl: addableProjectUser.avatarUrl,
        plannedMinutes: 30,
        endAt: new Date(at(2, 3).getTime() + 30 * 60 * 1000).toISOString()
      },
      {
        ...buildCalendarPlanningBlock(at(3, 4)),
        id: "calendar-project-b-user-two",
        title: "Beta của Annie",
        projectId: secondProject.id,
        projectName: secondProject.name,
        userId: addableProjectUser.id,
        userDisplayName: addableProjectUser.displayName,
        userEmail: addableProjectUser.email,
        userAvatarUrl: addableProjectUser.avatarUrl,
        plannedMinutes: 120,
        endAt: at(3, 6).toISOString()
      }
    ];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: planningBlocks,
        meta: {
          principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
          rowScope: "workspace",
          hiddenFields: [],
          startAt: url.searchParams.get("startAt"),
          endAt: url.searchParams.get("endAt"),
          pagination: {
            limit: 200,
            offset: 0,
            returned: planningBlocks.length,
            total: planningBlocks.length,
            hasNextPage: false,
            hasPreviousPage: false
          }
        }
      })
    });
  });

  await page.route("**/api/tasks/time-entries**", async (route) => {
    const url = new URL(route.request().url());
    const rangeStart = new Date(url.searchParams.get("startAt") ?? "2026-07-27T00:00:00.000Z");
    rangeStart.setUTCDate(rangeStart.getUTCDate() + 3);
    rangeStart.setUTCHours(7, 0, 0, 0);
    const rangeEnd = new Date(rangeStart.getTime() + 45 * 60 * 1000);
    const timeEntries = [{
      id: "calendar-actual-project-b-user-two",
      taskId: liveTask.id,
      accountId: liveProject.accountId,
      accountName: liveProject.accountName,
      projectId: secondProject.id,
      projectName: secondProject.name,
      userId: addableProjectUser.id,
      userDisplayName: addableProjectUser.displayName,
      userAvatarUrl: addableProjectUser.avatarUrl,
      taskTitle: "Beta thực tế của Annie",
      workDate: rangeStart.toISOString(),
      startAt: rangeStart.toISOString(),
      endAt: rangeEnd.toISOString(),
      timeZone: "Asia/Ho_Chi_Minh",
      minutes: 45,
      billable: true,
      approvalStatus: "approved",
      createdAt: rangeStart.toISOString()
    }];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: timeEntries,
        meta: {
          principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
          rowScope: "workspace",
          hiddenFields: [],
          startAt: url.searchParams.get("startAt"),
          endAt: url.searchParams.get("endAt"),
          pagination: {
            limit: 200,
            offset: 0,
            returned: timeEntries.length,
            total: timeEntries.length,
            hasNextPage: false,
            hasPreviousPage: false
          }
        }
      })
    });
  });

  await page.goto("/calendar");
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(4);
  await expect(page.getByText(/4 mốc · 3\.5h KH · 0\.8h TT · 2 PIC/)).toBeVisible();

  const projectTrigger = page.getByRole("button", { name: /^Dự án Tất cả dự án$/ });
  await projectTrigger.click();
  const projectListbox = page.getByRole("listbox", { name: "Dự án" });
  await expect(projectListbox).toBeVisible();
  await expect(projectListbox).toHaveAttribute("aria-multiselectable", "true");
  const projectSearch = page.getByRole("searchbox", { name: "Tìm Dự án" });
  await expect(projectSearch).toBeFocused();
  await projectSearch.fill(secondProject.name);
  await expect(projectListbox.getByRole("option", { name: secondProject.name, exact: true })).toBeVisible();
  await expect(projectListbox.getByRole("option", { name: liveProject.name, exact: true })).toHaveCount(0);
  await projectSearch.fill("");
  await page.keyboard.press("ArrowDown");
  await expect(projectListbox.getByRole("option", { name: "Tất cả dự án", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(projectListbox.locator('[role="option"]:focus')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(projectListbox).toHaveCount(0);
  await expect(projectTrigger).toBeFocused();

  await projectTrigger.click();
  await projectListbox.getByRole("option", { name: liveProject.name, exact: true }).click();
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(2);
  await expect(page.getByText(/2 mốc · 1\.5h KH · 0h TT · 2 PIC/)).toBeVisible();

  await projectListbox.getByRole("option", { name: secondProject.name, exact: true }).click();
  await expect(projectListbox.getByRole("option", { name: liveProject.name, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(projectListbox.getByRole("option", { name: secondProject.name, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(4);
  await expect(page.getByText(/4 mốc · 3\.5h KH · 0\.8h TT · 2 PIC/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Dự án 2 dự án đã chọn$/ })).toBeFocused();

  const memberTrigger = page.getByRole("button", { name: /^Thành viên Tất cả thành viên$/ });
  await memberTrigger.click();
  const memberListbox = page.getByRole("listbox", { name: "Thành viên" });
  await memberListbox.getByRole("option", { name: new RegExp(addableProjectUser.displayName) }).click();
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(3);
  await expect(page.getByText(/3 mốc · 2\.5h KH · 0\.8h TT · 1 PIC/)).toBeVisible();

  await memberListbox.getByRole("option", { name: new RegExp(liveUser.displayName) }).click();
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^Thành viên 2 thành viên đã chọn$/ })).toBeVisible();

  await memberListbox.getByRole("option", { name: "Tất cả thành viên", exact: true }).click();
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(4);
  await expect(memberListbox.getByRole("option", { name: "Tất cả thành viên", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: /^Dự án 2 dự án đã chọn$/ }).click();
  await projectListbox.getByRole("option", { name: "Tất cả dự án", exact: true }).click();
  await projectListbox.getByRole("option", { name: secondProject.name, exact: true }).click();
  await page.getByRole("button", { name: /^Thành viên Tất cả thành viên$/ }).click();
  await memberListbox.getByRole("option", { name: new RegExp(liveUser.displayName) }).click();
  await expect(page.getByTestId("calendar-filter-empty")).toBeVisible();
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("calendar-filter-toolbar").getByRole("button", { name: /^Thành viên/ }).click();
  const mobilePopoverMetrics = await memberListbox.evaluate((listbox) => {
    const rect = listbox.parentElement?.getBoundingClientRect();
    return { left: rect?.left ?? -1, right: rect?.right ?? -1, viewportWidth: window.innerWidth };
  });
  expect(mobilePopoverMetrics.left).toBeGreaterThanOrEqual(0);
  expect(mobilePopoverMetrics.right).toBeLessThanOrEqual(mobilePopoverMetrics.viewportWidth);
  await page.keyboard.press("Escape");
  const toolbarMetrics = await page.getByTestId("calendar-filter-toolbar").evaluate((toolbar) => {
    const rect = toolbar.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
  });
  expect(toolbarMetrics.left).toBeGreaterThanOrEqual(0);
  expect(toolbarMetrics.right).toBeLessThanOrEqual(toolbarMetrics.viewportWidth);

  await page.getByTestId("calendar-filter-empty").getByRole("button", { name: "Xóa bộ lọc" }).click();
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(4);
  await expect(page.getByTestId("calendar-filter-summary")).toHaveText("4 mốc trong phạm vi");
});

test("calendar keeps paginated overlapping events within bounds and shows one generated actual after completion", async ({ page }) => {
  const buildPlanningBlock = ({
    id,
    title,
    startAt,
    endAt,
    plannedMinutes
  }: {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    plannedMinutes: number;
  }) => ({
    id,
    taskId: liveTask.id,
    accountId: liveProject.accountId,
    accountName: liveProject.accountName,
    projectId: liveProject.id,
    projectName: liveProject.name,
    userId: liveUser.id,
    userDisplayName: liveUser.displayName,
    userEmail: liveUser.email,
    userAvatarUrl: liveUser.avatarUrl,
    title,
    notes: `Regression proof for ${title}`,
    startAt,
    endAt,
    plannedMinutes,
    status: "planned",
    source: "manual",
    createdByUserId: liveUser.id,
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T01:30:00.000Z"
  });

  const thirtyMinuteBlock = buildPlanningBlock({
    id: "e2e-calendar-30",
    title: "Thirty minute planning block",
    startAt: "2026-07-14T02:00:00.000Z",
    endAt: "2026-07-14T02:30:00.000Z",
    plannedMinutes: 30
  });
  const sixtyMinuteBlock = buildPlanningBlock({
    id: "e2e-calendar-60",
    title: "Sixty minute planning block with a deliberately long title",
    startAt: "2026-07-14T02:00:00.000Z",
    endAt: "2026-07-14T03:00:00.000Z",
    plannedMinutes: 60
  });
  const ninetyMinuteBlock = buildPlanningBlock({
    id: "e2e-calendar-90",
    title: "Ninety minute planning block",
    startAt: "2026-07-14T02:00:00.000Z",
    endAt: "2026-07-14T03:30:00.000Z",
    plannedMinutes: 90
  });
  const paginatedBlock = buildPlanningBlock({
    id: "e2e-calendar-page-two",
    title: "Page two planning block with a very long title that must stay selectable",
    startAt: "2026-07-14T02:15:00.000Z",
    endAt: "2026-07-14T03:45:00.000Z",
    plannedMinutes: 90
  });
  let persistedPaginatedBlock = { ...paginatedBlock };
  const transitionBodies: Record<string, unknown>[] = [];
  const actualPostBodies: Record<string, unknown>[] = [];
  const taskOffsets: string[] = [];

  const actualEntry = {
    id: "e2e-calendar-actual",
    taskId: liveTask.id,
    taskTitle: "Actual work with a long title that overlaps planning",
    accountId: liveProject.accountId,
    accountName: liveProject.accountName,
    projectId: liveProject.id,
    projectName: liveProject.name,
    userId: liveUser.id,
    userDisplayName: liveUser.displayName,
    userAvatarUrl: liveUser.avatarUrl,
    workDate: "2026-07-14T02:30:00.000Z",
    startAt: "2026-07-14T02:30:00.000Z",
    endAt: "2026-07-14T03:30:00.000Z",
    timeZone: "Asia/Ho_Chi_Minh",
    minutes: 60,
    billable: true,
    workType: "delivery",
    approvalStatus: "approved",
    note: "Actual Calendar regression proof",
    createdAt: "2026-07-14T04:00:00.000Z"
  };
  let generatedActualEntry: Record<string, unknown> | null = null;

  await page.route("**/api/tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/tasks/planning-blocks" && request.method() === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const data = offset === 0
        ? [thirtyMinuteBlock, sixtyMinuteBlock, ninetyMinuteBlock]
        : [thirtyMinuteBlock, persistedPaginatedBlock];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data,
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            startAt: url.searchParams.get("startAt"),
            endAt: url.searchParams.get("endAt"),
            pagination: {
              limit: 200,
              offset,
              returned: data.length,
              total: 4,
              hasNextPage: offset === 0,
              hasPreviousPage: offset > 0
            }
          }
        })
      });
      return;
    }

    if (url.pathname === "/api/tasks/time-entries" && request.method() === "GET") {
      const data = generatedActualEntry ? [actualEntry, generatedActualEntry] : [actualEntry];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data,
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            startAt: url.searchParams.get("startAt"),
            endAt: url.searchParams.get("endAt"),
            pagination: {
              limit: 200,
              offset: 0,
              returned: data.length,
              total: data.length,
              hasNextPage: false,
              hasPreviousPage: false
            }
          }
        })
      });
      return;
    }

    if (url.pathname === `/api/tasks/planning-blocks/${paginatedBlock.id}/transitions` && request.method() === "POST") {
      transitionBodies.push(request.postDataJSON() as Record<string, unknown>);
      persistedPaginatedBlock = {
        ...persistedPaginatedBlock,
        status: "completed",
        updatedAt: "2026-07-14T05:00:00.000Z"
      };
      generatedActualEntry = {
        ...actualEntry,
        id: "e2e-calendar-page-two-generated-actual",
        taskTitle: paginatedBlock.title,
        workDate: paginatedBlock.startAt,
        startAt: paginatedBlock.startAt,
        endAt: paginatedBlock.endAt,
        minutes: paginatedBlock.plannedMinutes,
        note: paginatedBlock.notes,
        sourcePlanningBlockId: paginatedBlock.id,
        createdAt: "2026-07-14T05:00:00.000Z"
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(persistedPaginatedBlock)
      });
      return;
    }

    if (url.pathname === `/api/tasks/planning-blocks/${thirtyMinuteBlock.id}` && request.method() === "DELETE") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Delete rejected for regression proof" })
      });
      return;
    }

    if (url.pathname.includes("/time-entries") && request.method() === "POST") {
      actualPostBodies.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Unexpected actual log" }) });
      return;
    }

    if (url.pathname === "/api/tasks" && request.method() === "GET") {
      const offset = url.searchParams.get("offset") ?? "0";
      taskOffsets.push(offset);
      const pageOneTask = { ...liveTask, id: "e2e-calendar-task-page-one", title: "Page one Calendar option" };
      const pageTwoTask = { ...liveTask, id: "e2e-calendar-task-page-two", title: "Page two Calendar option" };
      const data = offset === "0" ? [pageOneTask] : [pageTwoTask];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data,
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: {
              limit: 100,
              offset: Number(offset),
              returned: 1,
              total: 2,
              hasNextPage: offset === "0",
              hasPreviousPage: offset !== "0"
            }
          }
        })
      });
      return;
    }

    await route.fallback();
  });

  await page.clock.setFixedTime(new Date("2026-07-13T02:00:00.000Z"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/calendar");

  const cards = page.getByTestId("calendar-event-card");
  await expect(cards).toHaveCount(5);
  await expect(page.locator('[data-event-id="e2e-calendar-page-two"]')).toHaveCount(1);
  await expect(page.locator('[data-event-id="actual-e2e-calendar-actual"]')).toHaveCount(1);
  await expect(page.locator('[data-event-id="e2e-calendar-60"]')).toHaveAttribute(
    "aria-label",
    /KH: Sixty minute planning block.*09:00 - 10:00, Kế hoạch/
  );
  await expect(page.locator('[data-event-id="actual-e2e-calendar-actual"]')).toHaveAttribute(
    "aria-label",
    /TT: Actual work.*09:30 - 10:30, Thực tế/
  );

  const layoutMetrics = await cards.evaluateAll((nodes) => {
    const viewport = document.querySelector('[data-testid="calendar-time-grid"]')?.getBoundingClientRect();
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const columnRect = node.closest('[data-testid="calendar-day-column"]')?.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        id: node.getAttribute("data-event-id"),
        finite: [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite),
        positive: rect.width > 0 && rect.height > 0,
        withinColumn: Boolean(columnRect) && rect.left >= columnRect!.left - 1 && rect.right <= columnRect!.right + 1,
        withinVisibleGrid: Boolean(viewport) && rect.top >= viewport!.top - 1 && rect.bottom <= viewport!.bottom + 1,
        receivesCenterHit: Boolean(hit) && (hit === node || node.contains(hit)),
        clientHeight: (node as HTMLElement).clientHeight,
        scrollHeight: (node as HTMLElement).scrollHeight,
        clientWidth: (node as HTMLElement).clientWidth,
        scrollWidth: (node as HTMLElement).scrollWidth
      };
    });
  });
  for (const metric of layoutMetrics) {
    expect(metric.finite, metric.id ?? "unknown card").toBe(true);
    expect(metric.positive, metric.id ?? "unknown card").toBe(true);
    expect(metric.withinColumn, metric.id ?? "unknown card").toBe(true);
    expect(metric.withinVisibleGrid, metric.id ?? "unknown card").toBe(true);
    expect(metric.receivesCenterHit, metric.id ?? "unknown card").toBe(true);
  }
  const sixtyMinuteMetrics = layoutMetrics.find((metric) => metric.id === sixtyMinuteBlock.id);
  expect(sixtyMinuteMetrics).toBeDefined();
  expect(sixtyMinuteMetrics!.scrollHeight).toBeLessThanOrEqual(sixtyMinuteMetrics!.clientHeight);
  expect(sixtyMinuteMetrics!.scrollWidth).toBeLessThanOrEqual(sixtyMinuteMetrics!.clientWidth);
  const viewportOverflow = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: window.innerWidth }));
  expect(viewportOverflow.body).toBeLessThanOrEqual(viewportOverflow.viewport + 2);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverlapMetrics = await page.getByTestId("calendar-week-canvas").evaluate((canvas) => {
    const overlappingCard = document.querySelector('[data-event-id="e2e-calendar-60"]');
    const rect = overlappingCard?.getBoundingClientRect();
    return {
      cardWidth: rect?.width ?? 0,
      internalHorizontalScroll: canvas.scrollWidth > canvas.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });
  expect(mobileOverlapMetrics.cardWidth).toBeGreaterThan(20);
  expect(mobileOverlapMetrics.internalHorizontalScroll).toBe(true);
  expect(mobileOverlapMetrics.bodyScrollWidth).toBeLessThanOrEqual(mobileOverlapMetrics.viewportWidth + 2);

  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.locator(`[data-event-id="${paginatedBlock.id}"]`).click();
  const detailDialog = page.getByRole("dialog", { name: `Chi tiết kế hoạch: ${paginatedBlock.title}` });
  await expect(detailDialog).toBeVisible();
  const detailBounds = await detailDialog.boundingBox();
  expect(detailBounds).not.toBeNull();
  expect(detailBounds!.x).toBeGreaterThanOrEqual(0);
  expect(detailBounds!.y).toBeGreaterThanOrEqual(0);
  expect(detailBounds!.x + detailBounds!.width).toBeLessThanOrEqual(1440);
  expect(detailBounds!.y + detailBounds!.height).toBeLessThanOrEqual(1000);
  await expect(page.getByText("Chỉnh sửa kế hoạch", { exact: true })).toHaveCount(0);

  await detailDialog.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true }).click();
  const completionDialog = page.getByRole("dialog", { name: "Hoàn thành kế hoạch" });
  await expect(completionDialog).toContainText("Thời lượng kế hoạch sẽ được ghi nhận một lần vào giờ thực tế.");
  await completionDialog.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true }).click();

  await expect(page.locator(`[data-event-id="${paginatedBlock.id}"]`)).toHaveCount(0);
  await expect(page.locator('[data-event-id="actual-e2e-calendar-page-two-generated-actual"]')).toHaveCount(1);
  await expect(page.locator('[data-event-id="actual-e2e-calendar-page-two-generated-actual"]')).toHaveAttribute(
    "aria-label",
    /TT: Page two planning block.*Thực tế/
  );
  expect(transitionBodies).toEqual([{
    status: "completed",
    expectedUpdatedAt: paginatedBlock.updatedAt,
    reason: "Hoàn thành kế hoạch từ Calendar"
  }]);
  expect(actualPostBodies).toHaveLength(0);

  await page.locator(`[data-event-id="${thirtyMinuteBlock.id}"]`).click();
  const deleteDetail = page.getByRole("dialog", { name: `Chi tiết kế hoạch: ${thirtyMinuteBlock.title}` });
  await deleteDetail.getByRole("button", { name: "Xóa kế hoạch" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Xóa mốc kế hoạch" });
  await deleteDialog.getByRole("button", { name: "Xóa mốc", exact: true }).click();
  await expect(deleteDialog.getByRole("alert")).toHaveText("Delete rejected for regression proof");
  await expect(page.locator(`[data-event-id="${thirtyMinuteBlock.id}"]`)).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem("lark_crm_deleted_planning_blocks"))).toBeNull();
  await deleteDialog.getByRole("button", { name: "Hủy", exact: true }).click();

  await page.getByRole("button", { name: "Thêm kế hoạch", exact: true }).click();
  const addModal = page.getByRole("dialog", { name: "Lên lịch kế hoạch tuần mới" });
  await expect(addModal).toBeVisible();
  await addModal.getByRole("button", { name: "Page one Calendar option", exact: true }).click();
  await expect(addModal.getByRole("option", { name: /Page two Calendar option/ })).toBeVisible();
  expect(taskOffsets).toEqual(["0", "1"]);
  expect(actualPostBodies).toHaveLength(0);
});

test("calendar-created planning block stays canonical across task detail and reload", async ({ page }) => {
  const planningBlockId = "e2e-calendar-task-detail-canonical";
  const planningTitle = "Calendar to Task Detail canonical block";
  let savedPlanningBlock: Record<string, unknown> | null = null;
  let holdNextPlanningList = false;
  let taskDetailGetCount = 0;
  let taskListGetCount = 0;
  let releaseStalePlanningList!: () => void;
  let markStalePlanningListStarted!: () => void;
  const stalePlanningListGate = new Promise<void>(resolve => {
    releaseStalePlanningList = resolve;
  });
  const stalePlanningListStarted = new Promise<void>(resolve => {
    markStalePlanningListStarted = resolve;
  });

  const staleTaskListItem = {
    ...liveTask,
    loggedMinutes: 0,
    approvedMinutes: 0,
    timeEntries: [],
    subtasks: []
  };
  expect(staleTaskListItem.subtasks).toEqual([]);
  expect("planningBlocks" in staleTaskListItem).toBe(false);

  await page.route("**/api/tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/tasks/planning-blocks" && request.method() === "GET") {
      let data: Record<string, unknown>[] = [];
      if (savedPlanningBlock && holdNextPlanningList) {
        holdNextPlanningList = false;
        markStalePlanningListStarted();
        await stalePlanningListGate;
      } else if (savedPlanningBlock) {
        data = [savedPlanningBlock];
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data,
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: 200, offset: 0, returned: data.length, total: data.length, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === "/api/tasks/time-entries" && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: 200, offset: 0, returned: 0, total: 0, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}/planning-blocks` && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      savedPlanningBlock = {
        id: planningBlockId,
        taskId: liveTask.id,
        accountId: liveTask.accountId,
        accountName: liveTask.accountName,
        projectId: liveTask.projectId,
        projectName: liveTask.projectName,
        userId: body.userId,
        userDisplayName: liveUser.displayName,
        userEmail: liveUser.email,
        userAvatarUrl: liveUser.avatarUrl,
        title: body.title,
        notes: body.notes,
        startAt: body.startAt,
        endAt: body.endAt,
        plannedMinutes: body.plannedMinutes,
        status: body.status,
        source: "manual",
        createdByUserId: liveUser.id,
        createdAt: "2026-07-14T02:00:00.000Z",
        updatedAt: "2026-07-14T02:00:00.000Z"
      };
      holdNextPlanningList = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(savedPlanningBlock) });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "GET") {
      taskDetailGetCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...staleTaskListItem,
          planningBlocks: savedPlanningBlock ? [savedPlanningBlock] : [],
          timeEntries: [],
          subtasks: []
        })
      });
      return;
    }

    if (url.pathname === "/api/tasks" && request.method() === "GET") {
      taskListGetCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [staleTaskListItem],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: Number(url.searchParams.get("limit") ?? 100), offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    await route.fallback();
  });

  await page.clock.setFixedTime(new Date("2026-07-13T02:00:00.000Z"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/calendar");
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(0);

  await page.getByRole("button", { name: "Thêm kế hoạch", exact: true }).click();
  const addModal = page.getByText("Lên lịch kế hoạch tuần mới", { exact: true }).locator("xpath=ancestor::div[contains(@class,'fixed')]");
  const formDropdowns = addModal.locator(".task-select-control > button");
  await formDropdowns.nth(0).click();
  await addModal.getByRole("option", { name: new RegExp(liveTask.title) }).click();
  await addModal.getByPlaceholder("Tiêu đề hiển thị trên lịch...").fill(planningTitle);
  await formDropdowns.nth(1).click();
  await addModal.getByRole("option", { name: new RegExp(liveUser.displayName) }).click();
  await addModal.getByRole("button", { name: "Ngày thực hiện", exact: true }).click();
  const datePicker = page.getByRole("dialog", { name: "Ngày thực hiện calendar", exact: true });
  await expect(datePicker).toBeVisible();
  await datePicker.getByRole("gridcell", { name: "July 14, 2026", exact: true }).press("Enter");
  await addModal.getByPlaceholder("Mô tả công việc dự tính thực hiện...").fill("Cross-surface canonical proof");
  await addModal.getByRole("button", { name: "Lưu kế hoạch", exact: true }).click();

  await stalePlanningListStarted;
  const calendarCard = page.locator(`[data-planning-block-id="${planningBlockId}"]`);
  await expect(calendarCard).toHaveCount(1);
  await expect(calendarCard).toHaveAttribute("aria-label", /09:00 - 11:00, Kế hoạch/);

  const staleListResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/tasks/planning-blocks" && response.request().method() === "GET" && response.status() === 200;
  });
  releaseStalePlanningList();
  await staleListResponse;
  await expect(calendarCard).toHaveCount(1);

  await calendarCard.click();
  const calendarDialog = page.getByRole("dialog", { name: `Chi tiết kế hoạch: ${planningTitle}` });
  await expect(calendarDialog).toHaveAttribute("data-planning-block-id", planningBlockId);
  await calendarDialog.getByRole("link", { name: `Mở chi tiết công việc: ${planningTitle}`, exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/tasks/${liveTask.id}$`));
  await expect.poll(() => taskDetailGetCount).toBeGreaterThanOrEqual(1);
  expect(taskListGetCount).toBeGreaterThanOrEqual(1);
  const taskDetailPlanningRow = page.locator(`[data-planning-block-id="${planningBlockId}"]`);
  await expect(taskDetailPlanningRow).toHaveCount(1);
  await expect(taskDetailPlanningRow).toContainText(liveUser.displayName);
  await expect(taskDetailPlanningRow).toContainText("09:00 - 11:00");
  await expect(taskDetailPlanningRow).toContainText("Kế hoạch");
  await expect(page.locator("[data-time-entry-id]")).toHaveCount(0);
  await expect(page.getByText("0 phút thực tế", { exact: true })).toBeVisible();

  await page.reload();
  await expect.poll(() => taskDetailGetCount).toBeGreaterThanOrEqual(2);
  await expect(page.locator(`[data-planning-block-id="${planningBlockId}"]`)).toHaveCount(1);
  await expect(page.locator("[data-time-entry-id]")).toHaveCount(0);
  await expect(page.getByText("0 phút thực tế", { exact: true })).toBeVisible();
});

test("clicking a task card navigates to /tasks/[taskId] full page (not modal)", async ({ page }) => {
  await page.goto(`/projects/${liveProject.id}?tab=Tasks`);
  await expect(page).toHaveURL(/\/projects\/e2e-live-project/);

  const taskCard = page.getByText(liveTask.title, { exact: false }).first();
  await expect(taskCard).toBeVisible();
  await taskCard.click();

  await expect(page).toHaveURL(new RegExp(`/tasks/${liveTask.id}`));
  await expect(page).not.toHaveURL(/\/projects\/e2e-live-project$/);
  await expect(page.getByRole("heading", { name: liveTask.title })).toBeVisible();

  const modal = page.locator('[role="dialog"]');
  await expect(modal).not.toBeVisible();

  await page.getByRole("link", { name: /Quay lại danh sách/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${liveProject.id}\\?tab=Tasks(&principal=founder)?$`));
});

test("direct task detail route hydrates from /api/tasks/[taskId] when the task list page is empty", async ({ page }) => {
  await page.goto(`/tasks/${liveTask.id}`);

  await expect(page).toHaveURL(new RegExp(`/tasks/${liveTask.id}`));
  await expect(page.getByRole("heading", { name: liveTask.title })).toBeVisible();
  await expect(page.getByText("Không tìm thấy công việc")).toHaveCount(0);
});

test("one-hour and two-hour planning blocks preserve the four-hour task estimate", async ({ page }) => {
  const planningPostBodies: Record<string, unknown>[] = [];
  const estimatePatchBodies: Record<string, unknown>[] = [];
  let planningBlocks: Record<string, unknown>[] = [];

  const canonicalTask = () => ({
    ...liveTask,
    estimateMinutes: 240,
    loggedMinutes: 0,
    approvedMinutes: 0,
    timeEntries: [],
    planningBlocks,
    subtasks: []
  });

  await page.route("**/api/tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === `/api/tasks/${liveTask.id}/planning-blocks` && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      planningPostBodies.push(body);
      const savedBlock = {
        id: `e2e-baseline-plan-${planningPostBodies.length}`,
        taskId: liveTask.id,
        accountId: liveTask.accountId,
        accountName: liveTask.accountName,
        projectId: liveTask.projectId,
        projectName: liveTask.projectName,
        userId: body.userId,
        userDisplayName: liveUser.displayName,
        userEmail: liveUser.email,
        userAvatarUrl: liveUser.avatarUrl,
        title: body.title,
        notes: body.notes,
        startAt: body.startAt,
        endAt: body.endAt,
        plannedMinutes: body.plannedMinutes,
        status: "planned",
        source: "manual",
        createdByUserId: liveUser.id,
        createdAt: `2026-07-${13 + planningPostBodies.length}T02:00:00.000Z`,
        updatedAt: `2026-07-${13 + planningPostBodies.length}T02:00:00.000Z`
      };
      planningBlocks = [savedBlock, ...planningBlocks];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(savedBlock) });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "PATCH") {
      estimatePatchBodies.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(canonicalTask()) });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(canonicalTask()) });
      return;
    }

    if (url.pathname === "/api/tasks" && request.method() === "GET") {
      const listItem = { ...canonicalTask(), planningBlocks: undefined, subtasks: undefined };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [listItem],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: 200, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    await route.fallback();
  });

  const expectFourHourEstimate = async () => {
    const estimateStat = page.getByText("Ước tính", { exact: true }).first().locator("..");
    await expect(estimateStat).toContainText("4 giờ");
  };

  const openPlanningDialog = async () => {
    await page.getByRole("button", { name: "Ghi giờ", exact: true }).click();
    const chooser = page.getByRole("dialog", { name: "Ghi nhận & Lên kế hoạch" });
    await chooser.getByRole("button", { name: /Lên kế hoạch dự kiến/ }).click();
    return page.getByRole("dialog", { name: "Lên kế hoạch dự kiến" });
  };

  await page.clock.setFixedTime(new Date("2026-07-13T09:00:00.000Z"));
  await page.goto(`/tasks/${liveTask.id}`);
  await expectFourHourEstimate();

  const oneHourDialog = await openPlanningDialog();
  await expect(oneHourDialog.locator('input[type="number"]')).toHaveValue("60");
  await oneHourDialog.getByPlaceholder("Kế hoạch thực hiện chi tiết...").fill("Kế hoạch một giờ");
  await oneHourDialog.getByRole("button", { name: "Lưu kế hoạch", exact: true }).click();
  await expect(page.getByText("Kế hoạch một giờ", { exact: true })).toBeVisible();
  await expectFourHourEstimate();

  await page.reload();
  await expect(page.getByText("Kế hoạch một giờ", { exact: true })).toBeVisible();
  await expectFourHourEstimate();

  const twoHourDialog = await openPlanningDialog();
  const endTimeInput = twoHourDialog.locator('input[placeholder="hh:mm"]').nth(1);
  await endTimeInput.fill("11:00");
  await endTimeInput.press("Tab");
  await expect(twoHourDialog.locator('input[type="number"]')).toHaveValue("120");
  await twoHourDialog.getByPlaceholder("Kế hoạch thực hiện chi tiết...").fill("Kế hoạch hai giờ");
  await twoHourDialog.getByRole("button", { name: "Lưu kế hoạch", exact: true }).click();
  await expect(page.getByText("Kế hoạch hai giờ", { exact: true })).toBeVisible();
  await expectFourHourEstimate();

  await page.reload();
  await expect(page.getByText("Kế hoạch một giờ", { exact: true })).toBeVisible();
  await expect(page.getByText("Kế hoạch hai giờ", { exact: true })).toBeVisible();
  await expectFourHourEstimate();
  expect(planningPostBodies.map((body) => body.plannedMinutes)).toEqual([60, 120]);
  expect(estimatePatchBodies).toEqual([]);
});

test("task detail completes a planning block into one canonical actual without a client time-entry POST", async ({ page }) => {
  const planningPostBodies: Record<string, unknown>[] = [];
  const planningTransitionBodies: Record<string, unknown>[] = [];
  const actualPostBodies: Record<string, unknown>[] = [];
  const estimatePatchBodies: Record<string, unknown>[] = [];
  let taskDetailGetCount = 0;
  let persistedPlanningBlocks: Record<string, unknown>[] = [];
  let persistedTimeEntries: Record<string, unknown>[] = [];
  let estimateMinutes = 240;
  let planningDeleteCount = 0;

  const canonicalTask = () => {
    const loggedMinutes = persistedTimeEntries.reduce((total, entry) => total + Number(entry.minutes ?? 0), 0);
    return {
    ...liveTask,
    estimateMinutes,
    loggedMinutes,
    approvedMinutes: loggedMinutes,
    timeEntries: persistedTimeEntries,
    planningBlocks: persistedPlanningBlocks,
    subtasks: []
    };
  };

  await page.route("**/api/tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/tasks" && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ ...canonicalTask(), subtasks: undefined, planningBlocks: undefined }],
          meta: {
            principal: { subjectId: "e2e", workspaceId: "e2e-workspace" },
            rowScope: "workspace",
            hiddenFields: [],
            pagination: { limit: 200, offset: 0, returned: 1, total: 1, hasNextPage: false, hasPreviousPage: false }
          }
        })
      });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "GET") {
      taskDetailGetCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(canonicalTask())
      });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      estimatePatchBodies.push(body);
      estimateMinutes = Number(body.estimateMinutes ?? estimateMinutes);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(canonicalTask())
      });
      return;
    }

    if (url.pathname === `/api/tasks/${liveTask.id}/planning-blocks` && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      planningPostBodies.push(body);
      const savedBlock = {
        id: "e2e-plan-visible-after-reload",
        taskId: liveTask.id,
        accountId: liveTask.accountId,
        accountName: liveTask.accountName,
        projectId: liveTask.projectId,
        projectName: liveTask.projectName,
        userId: body.userId,
        userDisplayName: liveUser.displayName,
        userEmail: liveUser.email,
        userAvatarUrl: liveUser.avatarUrl,
        title: body.title,
        notes: body.notes,
        startAt: body.startAt,
        endAt: body.endAt,
        plannedMinutes: body.plannedMinutes,
        status: "planned",
        source: "manual",
        createdByUserId: liveUser.id,
        createdAt: "2026-07-13T02:00:00.000Z",
        updatedAt: "2026-07-13T02:00:00.000Z"
      };
      persistedPlanningBlocks = [savedBlock];
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(savedBlock) });
      return;
    }

    if (url.pathname === "/api/tasks/planning-blocks/e2e-plan-visible-after-reload/transitions" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      planningTransitionBodies.push(body);
      const currentBlock = persistedPlanningBlocks[0];
      const completedBlock: Record<string, any> = {
        ...currentBlock,
        status: "completed",
        updatedAt: "2026-07-13T03:00:00.000Z"
      };
      persistedPlanningBlocks = [completedBlock];
      if (!persistedTimeEntries.some(entry => entry.sourcePlanningBlockId === completedBlock.id)) {
        persistedTimeEntries = [{
          id: "e2e-actual-generated-from-plan",
          taskId: liveTask.id,
          accountId: liveTask.accountId,
          accountName: liveTask.accountName,
          projectId: liveTask.projectId,
          projectName: liveTask.projectName,
          userId: liveUser.id,
          userDisplayName: liveUser.displayName,
          userEmail: liveUser.email,
          userAvatarUrl: liveUser.avatarUrl,
          workDate: completedBlock.startAt,
          startAt: completedBlock.startAt,
          endAt: completedBlock.endAt,
          timeZone: "Asia/Ho_Chi_Minh",
          minutes: completedBlock.plannedMinutes,
          billable: completedBlock.billable ?? true,
          workType: completedBlock.workType ?? "delivery",
          approvalStatus: "approved",
          note: completedBlock.notes,
          sourcePlanningBlockId: completedBlock.id,
          createdAt: "2026-07-13T03:00:00.000Z",
          updatedAt: "2026-07-13T03:00:00.000Z"
        }];
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(completedBlock) });
      return;
    }

    if (url.pathname === "/api/tasks/planning-blocks/e2e-plan-visible-after-reload" && request.method() === "DELETE") {
      planningDeleteCount += 1;
      persistedPlanningBlocks = [];
      persistedTimeEntries = persistedTimeEntries.map(item => ({ ...item, sourcePlanningBlockId: null }));
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.pathname.includes("/time-entries") && request.method() === "POST") {
      actualPostBodies.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Unexpected actual log" }) });
      return;
    }

    await route.fallback();
  });

  await page.clock.setFixedTime(new Date("2026-07-13T09:00:00.000Z"));
  await page.goto(`/tasks/${liveTask.id}`);
  await expect(page.getByRole("heading", { name: liveTask.title })).toBeVisible();
  await expect(page.getByText("0 phút thực tế", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ghi giờ", exact: true }).click();
  await page.getByRole("dialog", { name: "Ghi nhận & Lên kế hoạch" }).getByRole("button", { name: /Lên kế hoạch dự kiến/ }).click();
  const planningModal = page.getByRole("dialog", { name: "Lên kế hoạch dự kiến" });
  await planningModal.getByPlaceholder("Kế hoạch thực hiện chi tiết...").fill("Kế hoạch hiển thị sau khi tải lại");
  await planningModal.getByRole("button", { name: "Lưu kế hoạch", exact: true }).click();

  await expect(page.getByText("Kế hoạch hiển thị sau khi tải lại", { exact: true })).toBeVisible();
  await expect(page.getByText("Kế hoạch", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("0 phút thực tế", { exact: true })).toBeVisible();
  expect(actualPostBodies).toHaveLength(0);
  expect(planningPostBodies).toHaveLength(1);
  expect(planningPostBodies[0]).toMatchObject({
    userId: liveUser.id,
    plannedMinutes: 60,
    status: "planned",
    notes: "Kế hoạch hiển thị sau khi tải lại"
  });
  expect(planningPostBodies[0].startAt).toBe("2026-07-01T02:00:00.000Z");
  expect(planningPostBodies[0].endAt).toBe("2026-07-01T03:00:00.000Z");
  expect(estimatePatchBodies).toEqual([]);

  await page.getByText("Kế hoạch hiển thị sau khi tải lại", { exact: true }).click();
  await page.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true }).click();
  const completionDialog = page.getByRole("dialog", { name: "Hoàn thành kế hoạch" });
  await expect(completionDialog).toContainText("Thời lượng kế hoạch sẽ được ghi nhận một lần vào giờ thực tế.");
  await completionDialog.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true }).click();

  await expect(page.getByText("1 giờ thực tế", { exact: true })).toBeVisible();
  await expect(page.locator('[data-planning-block-id="e2e-plan-visible-after-reload"]')).toHaveCount(0);
  await expect(page.locator('[data-time-entry-id="e2e-actual-generated-from-plan"]')).toHaveCount(1);
  expect(planningTransitionBodies).toHaveLength(1);
  expect(planningTransitionBodies[0]).toMatchObject({
    status: "completed",
    expectedUpdatedAt: "2026-07-13T02:00:00.000Z",
    reason: "Hoàn thành kế hoạch từ chi tiết công việc"
  });
  expect(actualPostBodies).toHaveLength(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: liveTask.title })).toBeVisible();
  await expect(page.locator('[data-planning-block-id="e2e-plan-visible-after-reload"]')).toHaveCount(0);
  await expect(page.getByText("1 giờ thực tế", { exact: true })).toBeVisible();
  await expect(page.locator('[data-time-entry-id="e2e-actual-generated-from-plan"]')).toHaveCount(1);
  await page.locator('[data-time-entry-id="e2e-actual-generated-from-plan"]').click();
  await expect(page.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true })).toHaveCount(0);
  const actualDetailDialog = page.getByRole("dialog", { name: "Chi tiết giờ đã ghi" });
  await expect(actualDetailDialog.getByRole("button", { name: "Xóa lịch kế hoạch, giữ giờ thực tế", exact: true })).toBeVisible();
  await expect(actualDetailDialog.getByRole("button", { name: "Xóa mục giờ này", exact: true })).toBeVisible();
  await actualDetailDialog.getByRole("button", { name: "Xóa lịch kế hoạch, giữ giờ thực tế", exact: true }).click();
  const deleteScheduleDialog = page.getByRole("dialog", { name: "Xóa mốc kế hoạch" });
  await expect(deleteScheduleDialog).toContainText("Giờ thực tế đã ghi vẫn được giữ lại");
  await deleteScheduleDialog.getByRole("button", { name: "Xóa", exact: true }).click();
  await expect(page.locator('[data-planning-block-id="e2e-plan-visible-after-reload"]')).toHaveCount(0);
  await expect(page.locator('[data-time-entry-id="e2e-actual-generated-from-plan"]')).toHaveCount(1);
  await expect(page.getByText("1 giờ thực tế", { exact: true })).toBeVisible();
  expect(planningDeleteCount).toBe(1);
  expect(actualPostBodies).toHaveLength(0);
  expect(persistedTimeEntries).toHaveLength(1);
  expect(estimatePatchBodies).toEqual([]);
  expect(estimateMinutes).toBe(240);
  expect(taskDetailGetCount).toBeGreaterThanOrEqual(2);
});

test("failed planning completion keeps the persisted row planned and actionable", async ({ page }) => {
  const transitionBodies: Record<string, unknown>[] = [];
  const actualPostBodies: Record<string, unknown>[] = [];
  const plannedBlock = {
    ...buildCalendarPlanningBlock(new Date("2026-07-01T02:00:00.000Z")),
    id: "e2e-plan-completion-failure",
    taskId: liveTask.id,
    title: liveTask.title,
    notes: "Kế hoạch vẫn planned khi backend lỗi",
    updatedAt: "2026-07-13T04:00:00.000Z"
  };

  await page.route("**/api/tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "GET") {
      if (transitionBodies.length >= 2) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Refresh unavailable for regression proof" })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...liveTask,
          loggedMinutes: 0,
          approvedMinutes: 0,
          timeEntries: [],
          planningBlocks: [plannedBlock],
          subtasks: []
        })
      });
      return;
    }

    if (url.pathname === `/api/tasks/planning-blocks/${plannedBlock.id}/transitions` && request.method() === "POST") {
      transitionBodies.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ message: "Planning block was updated by another user" })
      });
      return;
    }

    if (url.pathname.includes("/time-entries") && request.method() === "POST") {
      actualPostBodies.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Unexpected actual log" }) });
      return;
    }

    await route.fallback();
  });

  await page.goto(`/tasks/${liveTask.id}`);
  await expect(page.getByText(plannedBlock.notes, { exact: true })).toBeVisible();
  await page.getByText(plannedBlock.notes, { exact: true }).click();
  await page.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true }).click();
  const completionDialog = page.getByRole("dialog", { name: "Hoàn thành kế hoạch" });
  await completionDialog.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "Chi tiết giờ kế hoạch" }).getByRole("alert")).toHaveText(
    "Kế hoạch đã được cập nhật ở nơi khác. Dữ liệu mới nhất đã được tải lại."
  );
  await expect(page.getByText("Kế hoạch", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true })).toBeVisible();
  await expect(page.getByText("0 phút thực tế", { exact: true })).toBeVisible();
  expect(transitionBodies).toEqual([{
    status: "completed",
    expectedUpdatedAt: plannedBlock.updatedAt,
    reason: "Hoàn thành kế hoạch từ chi tiết công việc"
  }]);
  expect(actualPostBodies).toHaveLength(0);

  await page.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true }).click();
  await page.getByRole("dialog", { name: "Hoàn thành kế hoạch" }).getByRole("button", { name: "Hoàn thành kế hoạch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Chi tiết giờ kế hoạch" }).getByRole("alert")).toHaveText(
    "Kế hoạch đã được cập nhật ở nơi khác nhưng không thể tải dữ liệu mới nhất. Vui lòng tải lại trang."
  );
  await expect(page.getByRole("button", { name: "Hoàn thành kế hoạch", exact: true })).toBeVisible();
  expect(transitionBodies).toHaveLength(2);
  expect(actualPostBodies).toHaveLength(0);
});

test("task planning failure does not issue a separate estimate mutation", async ({ page }) => {
  let estimatePatchCount = 0;
  let planningPostCount = 0;

  await page.route("**/api/tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...liveTask, subtasks: [] })
      });
      return;
    }
    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "PATCH") {
      estimatePatchCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...liveTask, estimateMinutes: 60, subtasks: [] })
      });
      return;
    }
    if (url.pathname === `/api/tasks/${liveTask.id}/planning-blocks` && request.method() === "POST") {
      planningPostCount += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Planning transaction failed" })
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/tasks/${liveTask.id}`);
  await expect(page.getByRole("heading", { name: liveTask.title })).toBeVisible();
  await page.getByRole("button", { name: "Ghi giờ", exact: true }).click();
  await page.getByRole("dialog", { name: "Ghi nhận & Lên kế hoạch" }).getByRole("button", { name: /Lên kế hoạch dự kiến/ }).click();
  const planningModal = page.getByRole("dialog", { name: "Lên kế hoạch dự kiến" });
  await planningModal.getByPlaceholder("Kế hoạch thực hiện chi tiết...").fill("Không đổi estimate khi kế hoạch lỗi");
  await planningModal.getByRole("button", { name: "Lưu kế hoạch", exact: true }).click();

  await expect(page.getByText("Không thể lưu thay đổi vì chưa ghi nhận được trên hệ thống. Vui lòng đăng nhập lại hoặc thử lại khi kết nối ổn định.", { exact: true })).toBeVisible();
  expect(estimatePatchCount).toBe(0);
  expect(planningPostCount).toBe(1);
  await expect(page.getByText("Không đổi estimate khi kế hoạch lỗi", { exact: true })).toHaveCount(0);
});

test("task detail subtasks are loaded, created, and checked through backend tasks", async ({ page }) => {
  let createBody: Record<string, unknown> | undefined;
  let patchBody: Record<string, unknown> | undefined;
  const createdSubtask = {
    ...liveTask,
    id: "e2e-subtask-backend-real",
    parentTaskId: liveTask.id,
    title: "Checklist backend thật",
    description: null,
    taskType: "checklist",
    status: "todo",
    priority: liveTask.priority,
    estimateMinutes: 0,
    loggedMinutes: 0,
    approvedMinutes: 0,
    timeEntries: [],
    statusHistory: []
  };

  await page.route("**/api/tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...liveTask, subtasks: [] })
      });
      return;
    }

    if (url.pathname === "/api/tasks" && request.method() === "POST") {
      createBody = request.postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(createdSubtask)
      });
      return;
    }

    if (url.pathname === `/api/tasks/${createdSubtask.id}` && request.method() === "PATCH") {
      patchBody = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...createdSubtask, status: "done" })
      });
      return;
    }

    await route.fallback();
  });

  await page.goto(`/tasks/${liveTask.id}`);
  await expect(page.getByRole("heading", { name: liveTask.title })).toBeVisible();
  await expect(page.getByText("Khảo sát và ghi nhận yêu cầu chi tiết")).toHaveCount(0);
  await expect(page.getByText("Chưa có subtask nào. Thêm bên dưới!")).toBeVisible();

  await page.getByPlaceholder("Thêm subtask mới...").fill("Checklist backend thật");
  await page.getByRole("button", { name: "Thêm" }).click();

  await expect.poll(() => createBody).toMatchObject({
    accountId: liveTask.accountId,
    projectId: liveTask.projectId,
    stageId: liveTask.stageId,
    parentTaskId: liveTask.id,
    title: "Checklist backend thật",
    taskType: "checklist",
    status: "todo"
  });
  await expect(page.getByText("Checklist backend thật")).toBeVisible();
  await expect(page.getByText("0/1").first()).toBeVisible();

  await page.getByRole("button", { name: "Đánh dấu hoàn tất Checklist backend thật" }).click();

  await expect.poll(() => patchBody).toMatchObject({ status: "done" });
  await expect(page.getByText("1/1").first()).toBeVisible();
});

test("task detail date edits persist canonical start and due dates", async ({ page }) => {
  await page.goto(`/tasks/${liveTask.id}`);
  await expect(page.getByRole("heading", { name: liveTask.title })).toBeVisible();

  await page.getByRole("button", { name: "Chỉnh sửa" }).first().click();
  await page.getByRole("dialog", { name: "Xác nhận chỉnh sửa" }).getByRole("button", { name: "Xác nhận" }).click();

  await page.getByRole("button", { name: /01\/07\/2026/ }).click();
  await page.getByRole("gridcell", { name: "15 thg 7, 2026" }).click();
  await page.getByRole("button", { name: /08\/07\/2026/ }).click();
  await page.getByRole("gridcell", { name: "22 thg 7, 2026" }).click();

  const patchPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === `/api/tasks/${liveTask.id}` && request.method() === "PATCH";
  });

  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await page.getByRole("dialog", { name: "Xác nhận lưu thay đổi" }).getByRole("button", { name: "Xác nhận" }).click();
  const patchBody = (await patchPromise).postDataJSON() as Record<string, unknown>;

  expect(patchBody.plannedStartAt).toBe("2026-07-15T00:00:00.000Z");
  expect(patchBody.dueAt).toBe("2026-07-22T00:00:00.000Z");
  await expect(page.getByText("15/07/2026").first()).toBeVisible();
  await expect(page.getByText("22/07/2026").first()).toBeVisible();
});

test("task detail delete confirmation sends the persisted delete request", async ({ page }) => {
  let deleteCalled = false;

  await page.route(`**/api/tasks/${liveTask.id}**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/tasks/${liveTask.id}` && route.request().method() === "DELETE") {
      deleteCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deleted: true, id: liveTask.id })
      });
      return;
    }

    await route.fallback();
  });

  await page.goto(`/tasks/${liveTask.id}`);
  await expect(page.getByRole("heading", { name: liveTask.title })).toBeVisible();

  await page.getByRole("button", { name: "Xóa công việc", exact: true }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Xóa công việc" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Xóa công việc", exact: true }).click();

  await expect.poll(() => deleteCalled).toBe(true);
  await expect(page.getByText("Không thể xóa công việc vì thao tác xóa chưa có xác nhận từ hệ thống.")).toHaveCount(0);
  await expect(page.getByText("Đã xóa công việc.")).toBeVisible();
});
