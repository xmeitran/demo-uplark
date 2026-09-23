import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Focused E2E for the beta /analytics workspace (spec 33). The analytics API is
 * route-mocked so the suite verifies URL state, honest widget states, stale
 * request handling, pagination reset and drill-down without a live database.
 */

const authUser = {
  name: "Analytics Smoke",
  email: "analytics-smoke@example.com",
  initials: "AS",
  avatarColor: "#2563eb",
  role: "Admin"
};

const DEFINITIONS_VERSION = "wpa-v1.2026-07-15";

function metricValue(key: string, value: number | null, extra: Record<string, unknown> = {}) {
  return { key, state: value === null ? "unavailable" : "available", value, deltaPercent: null, ...extra };
}

function makeSummary(input: { reviewed: number; label: string }) {
  const totalsKeys: Array<[string, number | null]> = [
    ["reviewedApprovedMinutes", input.reviewed],
    ["legacyApprovedMinutes", 0],
    ["submittedMinutes", 600],
    ["rejectedMinutes", 0],
    ["billableRatio", 80],
    ["capacityMinutes", 4800],
    ["actualUtilization", 50],
    ["plannedUtilization", 40],
    ["scheduledMinutes", 300],
    ["allocationMinutes", 1920],
    ["estimateMinutes", 2400],
    ["projectsTouched", 2],
    ["taskCompletionRate", 60],
    ["onTimeCompletionRate", 75],
    ["dueDateCoverage", 50],
    ["estimateVarianceMinutes", input.reviewed - 2400],
    ["medianCycleTimeDays", 2.5],
    ["overdueTasks", 3],
    ["overdueEstimateMinutes", 480],
    ["blockedTasks", 1],
    ["overbookedPeople", 0],
    ["reworkShare", null]
  ];
  return {
    meta: {
      generatedAt: "2026-07-15T04:00:00.000Z",
      asOf: "2026-07-15T04:00:00.000Z",
      range: { from: "2026-06-15T17:00:00.000Z", to: "2026-07-15T17:00:00.000Z" },
      timezone: "Asia/Ho_Chi_Minh",
      grain: "week",
      definitionsVersion: DEFINITIONS_VERSION,
      rowScope: "workspace",
      policy: "founder_gm_full_operational",
      hiddenFields: ["email", "costRate"],
      freshness: "live",
      warnings: [],
      suppressedGroups: 0,
      principal: "Analytics Smoke",
      source: "postgresql",
      filters: {}
    },
    totals: totalsKeys.map(([key, value]) =>
      key === "capacityMinutes" || key === "actualUtilization"
        ? metricValue(key, value, { coverage: { covered: 2, total: 2 } })
        : metricValue(key, value)
    ),
    series: [0, 1, 2, 3].map((index) => ({
      bucketStart: `2026-06-${15 + index * 7}T17:00:00.000Z`,
      bucketLabel: `2026-06-${16 + index * 7}`,
      reviewedApprovedMinutes: input.reviewed / 4,
      legacyApprovedMinutes: 0,
      submittedMinutes: 150,
      billableMinutes: input.reviewed / 5,
      scheduledMinutes: 75,
      allocationMinutes: 480,
      capacityMinutes: 1200,
      tasksCompleted: 3
    })),
    breakdowns: {
      users: [
        {
          id: "usr-a",
          label: `An ${input.label}`,
          kind: "user",
          href: "/users/usr-a",
          metrics: { reviewedApprovedMinutes: input.reviewed / 2, capacityMinutes: 2400, actualUtilization: 50, allocationMinutes: 960, scheduledMinutes: 150, estimateMinutes: 1200, overdueTasks: 1, submittedMinutes: 300 }
        },
        {
          id: "usr-b",
          label: `Bình ${input.label}`,
          kind: "user",
          href: "/users/usr-b",
          metrics: { reviewedApprovedMinutes: input.reviewed / 2, capacityMinutes: 2400, actualUtilization: 50, allocationMinutes: 960, scheduledMinutes: 150, estimateMinutes: 1200, overdueTasks: 2, submittedMinutes: 300 }
        }
      ],
      projects: [
        {
          id: "prj-1",
          label: `Dự án Alpha ${input.label}`,
          kind: "project",
          href: "/projects/prj-1?tab=Dashboard",
          accountLabel: "KH Alpha",
          status: "in_progress",
          metrics: { reviewedApprovedMinutes: input.reviewed, estimateMinutes: 2400, scheduledMinutes: 300, allocationMinutes: 1920, estimateVarianceMinutes: input.reviewed - 2400, taskCompletionRate: 60, onTimeCompletionRate: 75, overdueTasks: 3, blockedTasks: 1, submittedMinutes: 600 }
        }
      ],
      departments: [],
      teams: []
    },
    quality: {
      usersMissingDepartment: 1,
      usersMissingTeam: 0,
      usersMissingCapacity: 0,
      membershipCoverage: { covered: 2, total: 2 },
      unassignedActualMinutes: 0,
      legacyApprovedMinutes: 0,
      excludedTimeEntryRows: 0,
      suppressedGroups: 0,
      workTypeVocabulary: ["delivery"]
    },
    filterOptions: {
      departments: [{ id: "dept-1", label: "Delivery" }],
      teams: [{ id: "team-1", label: "Team CRM" }],
      users: [
        { id: "usr-a", label: "An Analytics" },
        { id: "usr-b", label: "Bình Analytics" }
      ],
      accounts: [{ id: "acc-1", label: "KH Alpha" }],
      projects: [{ id: "prj-1", label: "Dự án Alpha", parentId: "acc-1" }],
      projectStatuses: [{ id: "in_progress", label: "in_progress", count: 1 }],
      taskStatuses: [{ id: "todo", label: "todo", count: 4 }],
      workTypes: [{ id: "delivery", label: "delivery", count: 10 }]
    }
  };
}

function makeBreakdown(summary: ReturnType<typeof makeSummary>, by: string, options: { page?: number } = {}) {
  const page = options.page ?? 1;
  const rows = by === "user" ? summary.breakdowns.users : summary.breakdowns.projects;
  return {
    meta: {
      ...summary.meta,
      by,
      sort: "reviewedApprovedMinutes",
      direction: "desc",
      limit: 25,
      totalRows: rows.length + 25
    },
    rows: rows.map((row) => (page > 1 ? { ...row, id: `${row.id}-p${page}`, label: `${row.label} (trang ${page})` } : row)),
    totals: { reviewedApprovedMinutes: 2400, estimateMinutes: 2400, submittedMinutes: 600, overdueTasks: 3, capacityMinutes: 4800 },
    nextCursor: page === 1 ? "cursor-page-2" : undefined
  };
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function installAnalyticsMocks(page: Page, options: {
  onSummary?: (url: URL, route: Route) => Promise<boolean> | boolean;
  onBreakdown?: (url: URL, route: Route) => Promise<boolean> | boolean;
} = {}) {
  const summary = makeSummary({ reviewed: 2400, label: "" });
  await page.route("**/api/analytics/workforce-projects/summary**", async (route) => {
    const url = new URL(route.request().url());
    if (options.onSummary && (await options.onSummary(url, route))) return;
    await fulfillJson(route, summary);
  });
  await page.route("**/api/analytics/workforce-projects/breakdown**", async (route) => {
    const url = new URL(route.request().url());
    if (options.onBreakdown && (await options.onBreakdown(url, route))) return;
    const by = url.searchParams.get("by") ?? "project";
    const cursor = url.searchParams.get("cursor");
    await fulfillJson(route, makeBreakdown(summary, by, { page: cursor ? 2 : 1 }));
  });
  return summary;
}

type RectSnapshot = { top: number; right: number; bottom: number; left: number; width: number; height: number };

type AnalyticsScrollSnapshot = {
  viewport: { width: number; height: number };
  shell: RectSnapshot;
  main: RectSnapshot;
  sidebar: RectSnapshot | null;
  mobileHeader: RectSnapshot | null;
  mainScrollTop: number;
  mainMaxScrollTop: number;
  mainScrollWidth: number;
  mainClientWidth: number;
  windowScrollY: number;
  rootScrollTop: number;
  bodyScrollTop: number;
  rootScrollWidth: number;
  rootClientWidth: number;
  shellOverflowY: string;
  mainParentOverflowY: string | null;
  mainOverflowY: string;
  mainOverscrollBehaviorY: string;
  shellTransform: string;
  mainTransform: string;
  workbenchTransform: string | null;
  mainPaddingBottom: number;
  bottomContentGap: number | null;
};

function expectClose(actual: number, expected: number, tolerance = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

async function readAnalyticsScrollSnapshot(page: Page): Promise<AnalyticsScrollSnapshot> {
  return page.getByTestId("analytics-main").evaluate((mainElement) => {
    const main = mainElement as HTMLElement;
    const shell = document.querySelector<HTMLElement>('[data-testid="analytics-shell"]');
    if (!shell) throw new Error("analytics shell is missing");
    const sidebar = document.querySelector<HTMLElement>('[data-testid="analytics-desktop-sidebar"] > aside');
    const mobileHeader = document.querySelector<HTMLElement>('[data-testid="analytics-mobile-shell"]');
    const workbench = main.firstElementChild as HTMLElement | null;
    const rect = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height
      };
    };
    const visibleRect = (element: HTMLElement | null) => element && element.getClientRects().length > 0 ? rect(element) : null;
    const mainRect = rect(main);
    const workbenchRect = workbench ? rect(workbench) : null;
    const mainStyle = getComputedStyle(main);

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      shell: rect(shell),
      main: mainRect,
      sidebar: visibleRect(sidebar),
      mobileHeader: visibleRect(mobileHeader),
      mainScrollTop: main.scrollTop,
      mainMaxScrollTop: main.scrollHeight - main.clientHeight,
      mainScrollWidth: main.scrollWidth,
      mainClientWidth: main.clientWidth,
      windowScrollY: window.scrollY,
      rootScrollTop: document.documentElement.scrollTop,
      bodyScrollTop: document.body.scrollTop,
      rootScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: document.documentElement.clientWidth,
      shellOverflowY: getComputedStyle(shell).overflowY,
      mainParentOverflowY: main.parentElement ? getComputedStyle(main.parentElement).overflowY : null,
      mainOverflowY: mainStyle.overflowY,
      mainOverscrollBehaviorY: mainStyle.overscrollBehaviorY,
      shellTransform: getComputedStyle(shell).transform,
      mainTransform: mainStyle.transform,
      workbenchTransform: workbench ? getComputedStyle(workbench).transform : null,
      mainPaddingBottom: Number.parseFloat(mainStyle.paddingBottom) || 0,
      bottomContentGap: workbenchRect ? mainRect.bottom - workbenchRect.bottom : null
    };
  });
}

function expectAnalyticsScrollBounded(
  snapshot: AnalyticsScrollSnapshot,
  baseline: AnalyticsScrollSnapshot,
  layout: "desktop" | "mobile"
) {
  expect(snapshot.mainMaxScrollTop).toBeGreaterThan(0);
  expectClose(snapshot.mainScrollTop, snapshot.mainMaxScrollTop);
  expect(snapshot.windowScrollY).toBe(0);
  expect(snapshot.rootScrollTop).toBe(0);
  expect(snapshot.bodyScrollTop).toBe(0);
  expect(snapshot.rootScrollWidth - snapshot.rootClientWidth).toBeLessThanOrEqual(1);
  expect(snapshot.mainScrollWidth - snapshot.mainClientWidth).toBeLessThanOrEqual(1);
  expect(snapshot.shellOverflowY).toBe("hidden");
  expect(snapshot.mainParentOverflowY).toBe("hidden");
  expect(snapshot.mainOverflowY).toBe("auto");
  expect(snapshot.mainOverscrollBehaviorY).toBe("none");
  expect(snapshot.shellTransform).toBe("none");
  expect(snapshot.mainTransform).toBe("none");
  expect(snapshot.workbenchTransform).toBe("none");

  expectClose(snapshot.shell.top, 0);
  expectClose(snapshot.shell.bottom, snapshot.viewport.height);
  expectClose(snapshot.shell.height, snapshot.viewport.height);
  expectClose(snapshot.main.bottom, snapshot.shell.bottom);
  expectClose(snapshot.shell.top, baseline.shell.top);
  expectClose(snapshot.shell.bottom, baseline.shell.bottom);
  expectClose(snapshot.shell.height, baseline.shell.height);
  expectClose(snapshot.main.top, baseline.main.top);
  expectClose(snapshot.main.bottom, baseline.main.bottom);
  expectClose(snapshot.main.height, baseline.main.height);

  expect(snapshot.bottomContentGap).not.toBeNull();
  expectClose(snapshot.bottomContentGap!, snapshot.mainPaddingBottom, 2);
  expectClose(snapshot.bottomContentGap!, baseline.bottomContentGap!, 2);

  if (layout === "desktop") {
    expect(snapshot.sidebar).not.toBeNull();
    expect(snapshot.mobileHeader).toBeNull();
    expectClose(snapshot.sidebar!.top, snapshot.shell.top);
    expectClose(snapshot.sidebar!.bottom, snapshot.shell.bottom);
    expectClose(snapshot.sidebar!.height, snapshot.shell.height);
    expectClose(snapshot.sidebar!.top, baseline.sidebar!.top);
    expectClose(snapshot.sidebar!.bottom, baseline.sidebar!.bottom);
  } else {
    expect(snapshot.sidebar).toBeNull();
    expect(snapshot.mobileHeader).not.toBeNull();
    expectClose(snapshot.mobileHeader!.bottom, snapshot.main.top);
    expectClose(snapshot.mobileHeader!.bottom, baseline.mobileHeader!.bottom);
  }
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:3003").origin;
  await context.addCookies([
    {
      name: "lcrm_session",
      value: "analytics-smoke-session",
      url: origin,
      httpOnly: false,
      secure: origin.startsWith("https:"),
      sameSite: "Strict"
    }
  ]);
  await page.addInitScript((user) => {
    window.localStorage.clear();
    window.localStorage.setItem("crm_auth_user", JSON.stringify(user));
  }, authUser);
  await page.route("**/api/auth/me", async (route) => {
    await fulfillJson(route, {
      subjectType: "internal_user",
      subjectId: "usr-analytics",
      displayName: authUser.name,
      email: authUser.email,
      roleCodes: ["FOUNDER_GM"],
      workspaceId: "twk-foundation"
    });
  });
});

test("analytics loads KPI, chart summary and detail table from the same dataset", async ({ page }) => {
  await installAnalyticsMocks(page);
  await page.goto("/analytics");

  await expect(page.getByRole("tab", { name: "Tổng quan" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Giờ làm đã duyệt")).toBeVisible();
  await expect(page.getByText("40h", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Năng lực, kế hoạch phân bổ và giờ làm theo thời gian" })).toBeVisible();
  await expect(page.getByText(/\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2} · Giờ Việt Nam/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Dự án Alpha/ }).first()).toBeVisible();
});

test("filter commits update the URL, reset pagination and survive Back/Forward", async ({ page }) => {
  await installAnalyticsMocks(page);
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Bảng chi tiết" })).toBeVisible();

  // Go to page 2 so a cursor exists, then change a filter: cursor must reset.
  await page.getByRole("button", { name: "Trang sau →" }).click();
  await expect(page).toHaveURL(/cursor=/);
  await page.getByRole("button", { name: "Thêm bộ lọc" }).click();
  const advancedFilters = page.getByRole("dialog", { name: "Bộ lọc bổ sung" });
  await advancedFilters.getByRole("button", { name: "Nhân sự", exact: true }).click();
  await advancedFilters.getByRole("option", { name: "An Analytics" }).click();
  await expect(page).not.toHaveURL(/user=/);
  await advancedFilters.getByRole("button", { name: "Áp dụng", exact: true }).click();
  await expect(page).toHaveURL(/user=usr-a/);
  await expect(page).not.toHaveURL(/cursor=/);

  // Switch view: URL carries the view and tab state.
  await page.getByRole("tab", { name: "Nhân lực" }).click();
  await expect(page).toHaveURL(/view=workforce/);

  // Back restores the previous analysis; Forward re-applies it.
  await page.goBack();
  await expect(page).not.toHaveURL(/view=workforce/);
  await expect(page).toHaveURL(/user=usr-a/);
  await page.goForward();
  await expect(page).toHaveURL(/view=workforce/);
  await expect(page.getByRole("tab", { name: "Nhân lực" })).toHaveAttribute("aria-selected", "true");

  // Reset clears the URL back to defaults.
  await page.getByRole("button", { name: "Đặt lại" }).click();
  await expect(page).toHaveURL(/view=workforce(?:&|$)/);
  await expect(page).not.toHaveURL(/user=/);
});

test("stale summary and breakdown responses cannot overwrite newer results", async ({ page }) => {
  let firstSummaryResolve: (() => void) | undefined;
  let firstBreakdownResolve: (() => void) | undefined;
  let summaryStartedResolve: (() => void) | undefined;
  let breakdownStartedResolve: (() => void) | undefined;
  const summaryStarted = new Promise<void>((resolve) => { summaryStartedResolve = resolve; });
  const breakdownStarted = new Promise<void>((resolve) => { breakdownStartedResolve = resolve; });
  const slowLabel = "CHẬM";
  await installAnalyticsMocks(page, {
    onSummary: async (url, route) => {
      if (url.searchParams.get("compare") !== "previous") return false;
      // Delay the compare=previous response; it is superseded before it lands.
      summaryStartedResolve?.();
      await new Promise<void>((resolve) => {
        firstSummaryResolve = () => resolve();
        setTimeout(resolve, 4000);
      });
      await fulfillJson(route, makeSummary({ reviewed: 9600, label: slowLabel })).catch(() => undefined);
      return true;
    },
    onBreakdown: async (url, route) => {
      if (url.searchParams.get("compare") !== "previous") return false;
      breakdownStartedResolve?.();
      await new Promise<void>((resolve) => {
        firstBreakdownResolve = () => resolve();
        setTimeout(resolve, 4000);
      });
      const slowSummary = makeSummary({ reviewed: 9600, label: slowLabel });
      await fulfillJson(route, makeBreakdown(slowSummary, url.searchParams.get("by") ?? "project")).catch(() => undefined);
      return true;
    }
  });

  await page.goto("/analytics");
  await expect(page.getByText("Giờ làm đã duyệt")).toBeVisible();
  await expect(page.getByText("40h", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Dự án Alpha/ }).first()).toBeVisible();

  // Trigger the slow request, then immediately supersede it.
  const compareToggle = page.getByLabel("So sánh với kỳ trước");
  await compareToggle.click();
  await expect(page).toHaveURL(/compare=previous/);
  await Promise.all([summaryStarted, breakdownStarted]);
  await compareToggle.click();
  await expect(page).not.toHaveURL(/compare=previous/);

  await expect(page.getByText("40h", { exact: true }).first()).toBeVisible();
  firstSummaryResolve?.();
  firstBreakdownResolve?.();
  await page.waitForTimeout(300);
  // Neither aborted response may mix its old KPI/table snapshot into the UI.
  await expect(page.getByText("160h", { exact: true })).toHaveCount(0);
  await expect(page.getByText(slowLabel)).toHaveCount(0);
});

test("multi-select supports keyboard draft, apply and focus restoration", async ({ page }) => {
  await installAnalyticsMocks(page);
  await page.goto("/analytics");

  const trigger = page.getByRole("button", { name: "Khách hàng", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const search = page.getByRole("searchbox", { name: "Tìm Khách hàng" });
  await expect(search).toBeFocused();
  await search.fill("KH Alpha");
  await page.keyboard.press("ArrowDown");

  const option = page.getByRole("option", { name: "KH Alpha" });
  const optionCheckbox = option.getByRole("checkbox");
  if (await optionCheckbox.count()) await expect(optionCheckbox).toBeFocused();
  else await expect(option).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page).not.toHaveURL(/account=/);
  await page.getByRole("button", { name: "Áp dụng" }).click();
  await expect(page).toHaveURL(/account=acc-1/);

  const selectedTrigger = page.getByRole("button", { name: "Khách hàng 1", exact: true });
  await selectedTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Khách hàng" })).toHaveCount(0);
  await expect(selectedTrigger).toBeFocused();
});

test("API failure shows an honest error state with per-widget retry, never zeros", async ({ page }) => {
  let failSummary = true;
  await installAnalyticsMocks(page, {
    onSummary: async (_url, route) => {
      if (!failSummary) return false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) });
      return true;
    }
  });

  await page.goto("/analytics");
  await expect(page.getByText("Không tải được dữ liệu phân tích")).toBeVisible();
  await expect(page.getByText("0h", { exact: true })).toHaveCount(0);

  failSummary = false;
  await page.getByRole("button", { name: "Thử lại" }).first().click();
  await expect(page.getByText("40h", { exact: true }).first()).toBeVisible();
});

test("forbidden access renders the denial panel instead of empty charts", async ({ page }) => {
  await installAnalyticsMocks(page, {
    onSummary: async (_url, route) => {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "Internal workforce analytics is not available to portal users" }) });
      return true;
    },
    onBreakdown: async (_url, route) => {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "forbidden" }) });
      return true;
    }
  });
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Không có quyền xem phân tích vận hành" })).toBeVisible();
});

test("keyboard drill-down through the detail table reaches the project route", async ({ page }) => {
  await installAnalyticsMocks(page);
  await page.route("**/api/projects/prj-1**", async (route) => {
    await fulfillJson(route, { id: "prj-1", name: "Dự án Alpha" });
  });
  await page.goto("/analytics");

  const projectLink = page.getByRole("link", { name: /Dự án Alpha/ }).first();
  await projectLink.focus();
  await expect(projectLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/prj-1\?tab=Dashboard/);
});

test("mobile 375px keeps evidence visible and moves filters into a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await installAnalyticsMocks(page);
  await page.goto("/analytics");

  await expect(page.getByText("Giờ làm đã duyệt")).toBeVisible();
  const filterTrigger = page.getByRole("button", { name: /Bộ lọc/ });
  await expect(filterTrigger).toBeVisible();
  await filterTrigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Bộ lọc phân tích" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Đóng bộ lọc" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(filterTrigger).toBeFocused();

  // No document-level horizontal overflow at 375px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

for (const scenario of [
  { name: "desktop", layout: "desktop" as const, width: 1440, height: 640 },
  { name: "mobile", layout: "mobile" as const, width: 375, height: 667 }
]) {
  test(`analytics resources keeps its ${scenario.name} scrollport bounded after repeated bottom wheel input`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await installAnalyticsMocks(page);
    await page.goto("/analytics?view=resources&by=user");

    await expect(page.getByRole("tab", { name: "Phân bổ nguồn lực" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Năng lực, kế hoạch phân bổ, lịch và thực tế theo nhân sự" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Bảng chi tiết" })).toBeVisible();

    const main = page.getByTestId("analytics-main");
    await expect.poll(async () => main.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await main.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(async () => {
      const snapshot = await readAnalyticsScrollSnapshot(page);
      return Math.abs(snapshot.mainScrollTop - snapshot.mainMaxScrollTop) <= 1;
    }).toBe(true);

    const baseline = await readAnalyticsScrollSnapshot(page);
    expectAnalyticsScrollBounded(baseline, baseline, scenario.layout);

    await main.hover();
    for (const deltaY of [1800, 1800, 40, 40, 40, 40, 40, 40, 40, 40]) {
      await page.mouse.wheel(0, deltaY);
      await expect.poll(async () => {
        const snapshot = await readAnalyticsScrollSnapshot(page);
        return Math.abs(snapshot.mainScrollTop - snapshot.mainMaxScrollTop) <= 1;
      }).toBe(true);
      expectAnalyticsScrollBounded(await readAnalyticsScrollSnapshot(page), baseline, scenario.layout);
    }
  });
}
