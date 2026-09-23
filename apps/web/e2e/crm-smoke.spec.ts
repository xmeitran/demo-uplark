import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installPublicAuthSessionFixture } from "./fixtures/public-auth-session";

const seriousConsoleTypes = new Set(["error"]);
const ignoredConsolePatterns = [
  /Download the React DevTools/i
];

async function markWindowForSilentRefresh(page: Page, label: string) {
  const marker = `${label}-${Date.now()}-${Math.random()}`;
  await page.evaluate((value) => {
    (window as typeof window & { __crmSilentRefreshMarker?: string }).__crmSilentRefreshMarker = value;
  }, marker);
  return marker;
}

async function expectSilentRefresh(page: Page, marker: string) {
  await expect.poll(async () => page.evaluate((expected) => {
    const win = window as typeof window & { __crmSilentRefreshMarker?: string };
    return {
      hasRouteLoader: Boolean(document.querySelector(".silent-top-loader,.route-state-shell")),
      markerPersisted: win.__crmSilentRefreshMarker === expected
    };
  }, marker)).toEqual({
    hasRouteLoader: false,
    markerPersisted: true
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

function crmNavLink(page: Page, name: string) {
  return page.getByLabel("Khu vực CRM").getByRole("link", { exact: true, name });
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const messages: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (!seriousConsoleTypes.has(message.type())) return;
    if (ignoredConsolePatterns.some((pattern) => pattern.test(text))) return;
    messages.push(`${message.type()}: ${text}`);
  });

  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error.message}`);
  });

  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  const fixture = await installPublicAuthSessionFixture(context, baseURL);
  if (!fixture.available) {
    if (process.env.CRM_E2E_REQUIRE_AUTH === "1") {
      throw new Error(fixture.reason);
    }
    test.skip(true, fixture.reason);
    return;
  }

  test.info().annotations.push({
    type: "console-watch",
    description: "Fails on browser console errors and uncaught page errors."
  });

  (page as typeof page & { __crmConsoleMessages?: string[] }).__crmConsoleMessages = messages;
});

test.afterEach(async ({ page }) => {
  const messages = (page as typeof page & { __crmConsoleMessages?: string[] }).__crmConsoleMessages ?? [];
  expect(messages, messages.join("\n")).toEqual([]);
});

test("accounts route shows scoped customer account workspace", async ({ page }) => {
  await page.goto("/accounts");

  await expect(page.getByRole("heading", { name: "Khách hàng", exact: true })).toBeVisible();
  await expect(page.getByText("Khách hàng đang quản lý")).toBeVisible();
  await expect(page.getByRole("button", { name: /Tạo khách hàng/i })).toBeVisible();
  await expect(page.getByText("Cần đăng nhập Lark")).toHaveCount(0);
  await expect(page.getByText("Session is missing, revoked or expired")).toHaveCount(0);
});

test("pipeline route shows opportunity table and workflow actions", async ({ page }) => {
  await page.goto("/pipeline");

  await expect(page.getByRole("heading", { name: "Cơ hội", exact: true })).toBeVisible();
  await expect(page.getByText("Tạo lead mới", { exact: true })).toBeVisible();
  await expect(page.getByText("Không gian cơ hội")).toHaveCount(0);
  await expect(page.getByText("Cơ hội bán hàng")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tạo lead" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ghi nhận lead" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tạo cơ hội" })).toHaveCount(0);
  await expect(page.locator(".pipeline-global-actions .pipeline-command-button")).toHaveCount(1);
  await expect(page.locator(".pipeline-global-actions .pipeline-command-button.primary")).toHaveText("Tạo lead");

  const seededOpportunity = page.getByRole("button", { name: /CRM\/ERP phase 1/i }).first();
  if (await seededOpportunity.count()) {
    await expect(seededOpportunity).toBeVisible();
    await expect(page.getByRole("button", { name: /Managed services expansion/i }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Giai đoạn" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Danh sách cơ hội bán hàng" })).toBeVisible();
    await expect(page.getByLabel("Danh sách cơ hội bán hàng").getByText("Cần xử lý: Chưa có hoạt động tiếp theo")).toBeVisible();
    await expect(page.locator(".shopify-desktop-table .pipeline-row-actions").first()).toBeVisible();
    await expect(page.locator(".shopify-desktop-table .pipeline-row-action")).toHaveCount(6);
    await expect(page.locator(".shopify-desktop-table .pipeline-row-actions s-button")).toHaveCount(0);
  }

  await page.getByRole("button", { name: "Tạo lead" }).click();
  const visiblePipelineModal = page.locator(".pipeline-create-modal:visible");
  await expect(visiblePipelineModal).toBeVisible();
  await expect(visiblePipelineModal.locator("s-select, select, s-text-field, s-email-field, s-text-area, s-checkbox")).toHaveCount(0);
  await expect(visiblePipelineModal.locator(".pipeline-field-label")).toContainText([
    "Khách hàng",
    "Người liên hệ",
    "Email",
    "Nỗi đau / nhu cầu",
    "Mức phù hợp",
    "Ngân sách",
    "Thời điểm",
    "Người quyết định"
  ]);
  await expect(visiblePipelineModal.locator(".pipeline-field-helper")).toHaveCount(0);
  await visiblePipelineModal.getByLabel("Ngân sách").fill("240000000");
  await expect(visiblePipelineModal.getByLabel("Ngân sách")).toHaveValue("240.000.000");

  const modalMetrics = await page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll(".pipeline-create-modal")).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const actions = modal?.querySelector(".pipeline-modal-actions");
    const introIcon = modal?.querySelector(".pipeline-modal-icon");
    const introSvg = modal?.querySelector(".pipeline-modal-icon svg");
    const actionRect = actions?.getBoundingClientRect();
    const iconRect = introIcon?.getBoundingClientRect();
    const svgRect = introSvg?.getBoundingClientRect();
    const modalRect = modal?.getBoundingClientRect();

    return {
      iconCenterDeltaX: Math.abs(((iconRect?.left ?? 0) + (iconRect?.width ?? 0) / 2) - ((svgRect?.left ?? 0) + (svgRect?.width ?? 0) / 2)),
      iconCenterDeltaY: Math.abs(((iconRect?.top ?? 0) + (iconRect?.height ?? 0) / 2) - ((svgRect?.top ?? 0) + (svgRect?.height ?? 0) / 2)),
      modalBottom: Math.round(modalRect?.bottom ?? 0),
      modalTop: Math.round(modalRect?.top ?? 0),
      actionsTop: Math.round(actionRect?.top ?? 0),
      overflow: document.body.scrollWidth - document.documentElement.clientWidth
    };
  });

  expect(modalMetrics.modalTop).toBeGreaterThanOrEqual(0);
  expect(modalMetrics.actionsTop).toBeLessThan(modalMetrics.modalBottom);
  expect(modalMetrics.iconCenterDeltaX).toBeLessThanOrEqual(1);
  expect(modalMetrics.iconCenterDeltaY).toBeLessThanOrEqual(1);
  expect(modalMetrics.overflow).toBeLessThanOrEqual(0);
});

test("mobile shell uses drawer navigation without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pipeline");

  await expect(page.getByRole("button", { name: "Mở menu" })).toBeVisible();
  await expect(page.locator(".shopify-mobile-brand").getByText("Cơ hội")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Mở menu" }).click();
  await expect(crmNavLink(page, "Tổng quan")).toBeVisible();
  await expect(crmNavLink(page, "Cơ hội")).toHaveAttribute("aria-current", "page");
  await expect(crmNavLink(page, "Khách hàng")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Mở menu" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("priority routes share white canvas and calm motion foundation", async ({ page }) => {
  const routes = ["/", "/accounts", "/tasks", "/proposals", "/finance"];

  for (const route of routes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route, { waitUntil: "networkidle" });
    await expectNoHorizontalOverflow(page);

    const desktopFoundation = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const nav = document.querySelector(".shopify-local-nav");
      const navStyle = nav ? getComputedStyle(nav) : null;

      return {
        accent: root.getPropertyValue("--accent").trim(),
        bodyBackgroundColor: body.backgroundColor,
        bodyBackgroundImage: body.backgroundImage,
        canvas: root.getPropertyValue("--canvas").trim(),
        hasLegacyFinancePlaceholder: document.body.textContent?.includes("Finance & Commercial Control") ?? false,
        motionBase: root.getPropertyValue("--motion-base").trim(),
        motionFast: root.getPropertyValue("--motion-fast").trim(),
        navBackgroundColor: navStyle?.backgroundColor ?? "",
        navBackgroundImage: navStyle?.backgroundImage ?? "",
        uppercaseTransforms: Array.from(
          document.querySelectorAll(".shopify-nav-group-label,.kpi-label,.proposal-kicker,.business-kicker,.finance-eyebrow")
        ).filter((node) => getComputedStyle(node as HTMLElement).textTransform === "uppercase").length
      };
    });

    expect(desktopFoundation.canvas.toLowerCase()).toBe("#f8fafc");
    expect(desktopFoundation.bodyBackgroundColor).toBe("rgb(248, 250, 252)");
    expect(desktopFoundation.bodyBackgroundImage).toBe("none");
    if (desktopFoundation.navBackgroundImage) {
      expect(desktopFoundation.navBackgroundImage).toContain("linear-gradient");
    }
    expect(desktopFoundation.accent.toLowerCase()).toBe("#2563eb");
    expect(desktopFoundation.motionFast).toBe("140ms");
    expect(desktopFoundation.motionBase).toBe("180ms");
    expect(desktopFoundation.uppercaseTransforms).toBe(0);
    if (route === "/finance") {
      expect(desktopFoundation.hasLegacyFinancePlaceholder).toBe(false);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/finance");
  await expect(page.getByRole("heading", { name: "Tài chính & Công nợ" })).toBeVisible();
  const reducedMotion = await page.evaluate(() => {
    const navLink = document.querySelector(".shopify-nav-links a") as HTMLElement | null;
    const progress = document.querySelector(".finance-progress-track span") as HTMLElement | null;
    const navStyle = navLink ? getComputedStyle(navLink) : null;
    const progressStyle = progress ? getComputedStyle(progress) : null;

    return {
      navTransition: navStyle?.transitionDuration ?? "",
      progressTransition: progressStyle?.transitionDuration ?? ""
    };
  });

  expect(reducedMotion.navTransition).toBe("0s");
  if (reducedMotion.progressTransition) {
    expect(reducedMotion.progressTransition).toBe("0s");
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

test("pipeline detail keeps handoff readiness responsive", async ({ page }) => {
  await page.goto("/pipeline");
  const seededOpportunity = page.getByRole("button", { name: /CRM\/ERP phase 1/i }).first();
  test.skip(await seededOpportunity.count() === 0, "Alpha opportunity seed is not available in the connected backend.");
  await seededOpportunity.click();

  await expect(page.getByRole("heading", { name: "CRM/ERP phase 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quay lại danh sách" })).toBeVisible();
  await expect(page.getByText("Quay lại Cơ hội")).toHaveCount(0);
  await expect(page.getByText("Tóm tắt thương vụ")).toBeVisible();
  await expect(page.getByText("Tiến trình bán hàng")).toBeVisible();
  await expect(page.locator(".opportunity-hero-meta").getByText(/Phụ trách:/)).toBeVisible();
  await expect(page.locator(".opportunity-hero-meta").getByText(/Nguồn: Tạo từ lead/)).toBeVisible();
  await expect(page.getByText("Timeline cơ hội")).toBeVisible();
  await expect(page.locator(".opportunity-readiness-card strong", { hasText: "Sẵn sàng bàn giao" })).toBeVisible();
  await expect(page.locator(".opportunity-stage-step small").filter({ hasText: /Xong|Từ/ }).first()).toBeVisible();
  const initialStageText = await page.locator(".opportunity-title-stack").textContent();
  if (initialStageText?.includes("Thua")) {
    await expect(page.getByText("BD đã xác nhận thua")).toBeVisible();
    await expect(page.getByText("Deal đã thua nên không bàn giao triển khai.")).toBeVisible();
    await expect(page.locator(".opportunity-summary-block").getByText("0%")).toBeVisible();
    await expect(page.getByText("policy_scoped_stage_update")).toHaveCount(0);
  } else {
    await expect(page.getByText("0/4 sẵn sàng").first()).toBeVisible();
    await expect(page.getByText(/bàn giao.*điều kiện/i).first()).toBeVisible();
    const handoffButton = page.getByRole("button", { name: "Chưa thể bàn giao" });
    if (await handoffButton.count()) {
      await expect(handoffButton).toBeDisabled();
    } else {
      await expect(page.getByRole("button", { name: "Thắng deal" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Thua deal" })).toBeVisible();
    }
  }
  const initialEditButton = page.getByRole("button", { name: "Sửa cơ hội" });
  await expect(initialEditButton).toBeVisible();
  await expect(page.locator(".opportunity-detail-metrics .opportunity-custom-field")).toHaveCount(0);
  let confirmDialog = page.getByRole("dialog").filter({ hasText: "Bật chế độ sửa?" });
  if (await initialEditButton.isDisabled()) {
    await expect(page.getByText("Deal đã chốt.")).toBeVisible();
  } else {
    await initialEditButton.click();
    await expect(confirmDialog).toBeVisible();
    await page.getByRole("button", { name: "Bắt đầu sửa" }).click();
    await expect(page.getByText("Đang sửa, cần xác nhận lưu.")).toBeVisible();
    await expect(page.locator(".opportunity-custom-field", { hasText: "Tên cơ hội" }).locator("input")).toBeEnabled();
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    confirmDialog = page.getByRole("dialog").filter({ hasText: "Xác nhận lưu thay đổi" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Hủy", exact: true }).click();
  }
  await expect(page.locator(".opportunity-detail s-text-field, .opportunity-detail s-date-field, .opportunity-detail s-select, .opportunity-detail s-text-area, .opportunity-detail s-checkbox")).toHaveCount(0);

  await page.getByRole("tab", { name: /Hoạt động/ }).click();
  const activityDateTrigger = page.locator(".opportunity-activity-panel .opportunity-date-trigger");
  await expect(activityDateTrigger).toBeVisible();
  await activityDateTrigger.click();
  await expect(page.locator(".opportunity-calendar-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".opportunity-calendar-popover")).toHaveCount(0);

  await page.getByRole("tab", { name: "Tín hiệu tài chính" }).click();
  await expect(page.getByText("Cập nhật lịch thu")).toBeVisible();
  await expect(page.getByText("Bằng chứng thanh toán")).toBeVisible();
  await expect(page.getByRole("button", { name: "Thêm mốc thu" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Đính kèm bằng chứng" })).toBeDisabled();
  await expect(page.locator(".opportunity-finance-panel").getByText("Lịch thu Alpha CRM/ERP phase 1").first()).toBeVisible();
  await expect(page.locator(".opportunity-finance-panel").getByText("Thanh toán kickoff", { exact: true })).toBeVisible();

  await expect.poll(async () => page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.getByRole("tab", { name: "Tổng quan" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".opportunity-readiness-card strong", { hasText: "Sẵn sàng bàn giao" })).toBeVisible();

  const mobileMetrics = await page.evaluate(() => {
    const contextPanel = document.querySelector(".opportunity-context-card")?.getBoundingClientRect();
    return {
      contextWidth: Math.round(contextPanel?.width ?? 0),
      overflow: document.body.scrollWidth - document.documentElement.clientWidth
    };
  });

  expect(mobileMetrics.contextWidth).toBeGreaterThan(320);
  expect(mobileMetrics.overflow).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Quay lại danh sách" }).click();
  await page.getByRole("button", { name: /Managed services expansion/i }).first().click();
  await expect(page.locator(".opportunity-stage-step").nth(0).locator("small")).toContainText(/Xong trước|Xong/);
  await expect(page.locator(".opportunity-stage-step").nth(1).locator("small")).toContainText(/Xong/);
  await expect(page.locator(".opportunity-stage-step").nth(2).locator("small")).toContainText(/Từ/);
  await expect(page.locator(".opportunity-stage-duration:not(.empty)").first()).toBeVisible();
  const progressAlignment = await page.locator(".opportunity-stage-progress").evaluate((root) => {
    const line = root.querySelector(".opportunity-stage-line")?.getBoundingClientRect();
    const activeLine = root.querySelector(".opportunity-stage-line.active")?.getBoundingClientRect();
    const dots = Array.from(root.querySelectorAll(".opportunity-stage-dot")).map((node) => node.getBoundingClientRect());
    const duration = root.querySelector(".opportunity-stage-duration:not(.empty)")?.getBoundingClientRect();
    const currentDot = dots[2];

    return {
      activeLineEndDelta: activeLine && currentDot ? Math.abs(activeLine.right - (currentDot.left + currentDot.width / 2)) : 999,
      durationInsideProgress: duration ? duration.left >= root.getBoundingClientRect().left && duration.right <= root.getBoundingClientRect().right : false,
      lineDotCenterDelta: line && dots.length ? Math.max(...dots.map((dot) => Math.abs(line.top + line.height / 2 - (dot.top + dot.height / 2)))) : 999
    };
  });
  expect(progressAlignment.lineDotCenterDelta).toBeLessThanOrEqual(2);
  expect(progressAlignment.activeLineEndDelta).toBeLessThanOrEqual(2);
  expect(progressAlignment.durationInsideProgress).toBe(true);
  await page.getByRole("button", { name: "Sửa cơ hội" }).click();
  confirmDialog = page.getByRole("dialog").filter({ hasText: "Bật chế độ sửa?" });
  await expect(confirmDialog).toBeVisible();
  await page.getByRole("button", { name: "Bắt đầu sửa" }).click();
  await expect(page.locator(".opportunity-custom-field", { hasText: "Tên cơ hội" }).locator("input")).toBeEnabled();
  await expect(page.locator(".opportunity-detail-metrics .opportunity-custom-field", { hasText: "Phụ trách" }).locator("button")).toBeEnabled();
  const ownerDropdown = page.locator(".opportunity-custom-field", { hasText: "Phụ trách" }).locator("button");
  await expect(ownerDropdown).toBeEnabled();
  await ownerDropdown.click();
  await expect(page.getByRole("option", { name: "Founder GM" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Sales Alpha" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".opportunity-custom-field", { hasText: "Ngày vào giai đoạn" }).locator("button")).toBeEnabled();
  await expect(page.locator(".opportunity-custom-field", { hasText: "Ngày việc tiếp theo" }).locator("button")).toBeEnabled();
  await expect(page.locator(".opportunity-custom-field", { hasText: "Việc tiếp theo" }).locator("input")).toBeEnabled();
  await expect(page.locator(".opportunity-custom-field", { hasText: "Giai đoạn" }).first().locator("button")).toBeEnabled();
  await expect(page.locator(".opportunity-custom-field", { hasText: "Xác suất (%)" }).locator("input")).toBeEnabled();
  await expect(page.locator(".opportunity-custom-field", { hasText: "Nguồn cơ hội" }).locator("button")).toBeEnabled();
  await expect(page.locator(".opportunity-detail-metrics .pipeline-field", { hasText: "Giá trị" }).locator("input")).toBeEnabled();
  await page.getByRole("button", { name: "Hủy sửa" }).click();
  await expect(page.getByRole("button", { name: "Thắng deal" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Thua deal" })).toBeEnabled();
  await page.getByRole("button", { name: "Thắng deal" }).click();
  confirmDialog = page.getByRole("dialog").filter({ hasText: "Thắng deal này?" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText("Lý do thắng", { exact: true })).toBeVisible();
  await expect(confirmDialog.getByRole("button", { name: "Xác nhận thắng deal" })).toBeDisabled();
  await confirmDialog.getByRole("button", { name: /Lý do thắng: Chưa chọn/ }).click();
  await expect(page.getByRole("option", { name: "Khách hàng đã xác nhận" })).toBeVisible();
  await page.getByRole("option", { name: "Khách hàng đã xác nhận" }).click();
  await expect(confirmDialog.getByRole("button", { name: "Xác nhận thắng deal" })).toBeEnabled();
  await confirmDialog.getByRole("button", { name: "Hủy", exact: true }).click();
  await page.getByRole("button", { name: "Thua deal" }).click();
  confirmDialog = page.getByRole("dialog").filter({ hasText: "Thua deal này?" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText("Lý do thua", { exact: true })).toBeVisible();
  await expect(confirmDialog.getByRole("button", { name: "Xác nhận thua deal" })).toBeDisabled();
  await confirmDialog.getByRole("button", { name: /Lý do thua: Chưa chọn/ }).click();
  await expect(page.getByRole("option", { name: "Chưa khớp ngân sách" })).toBeVisible();
  await page.getByRole("option", { name: "Chưa khớp ngân sách" }).click();
  await expect(confirmDialog.getByRole("button", { name: "Xác nhận thua deal" })).toBeEnabled();
  await confirmDialog.getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(page.getByText("Thua deal này?")).toHaveCount(0);
});

test("task detail route shows operational task context", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tasks");
  test.skip(await page.getByText("Run delivery kickoff").count() === 0, "Alpha task seed is not available in the connected backend.");
  await page.goto("/tasks/task-alpha-kickoff?principal=founder");

  await expect(page.getByRole("heading", { name: "Chi tiết công việc" })).toBeVisible();
  await expect(page.getByText("Run delivery kickoff")).toBeVisible();
  await expect(page.getByText("Mô tả công việc")).toBeVisible();
  await expect(page.getByText("Giờ làm đã ghi")).toBeVisible();
  await expect(page.getByText("Timeline trạng thái")).toBeVisible();
  await expect(page.getByText("Bình luận", { exact: true })).toBeVisible();
  await expect(page.getByText("Thông tin công việc")).toBeVisible();
  await expect(page.getByRole("button", { name: /Đổi trạng thái/i })).toBeVisible();

  const desktopMetrics = await page.evaluate(() => {
    const layout = document.querySelector(".task-detail-layout");
    const hero = document.querySelector(".task-detail-hero-main");
    const sidebar = document.querySelector(".task-detail-sidebar");
    const sideCard = document.querySelector(".task-detail-side-card");

    return {
      columns: layout ? getComputedStyle(layout).gridTemplateColumns.split(" ").length : 0,
      hasHero: Boolean(hero),
      kpiCards: document.querySelectorAll(".task-detail-progress-card").length,
      sidebarWidth: Math.round(sidebar?.getBoundingClientRect().width ?? 0),
      sideEditIcons: sideCard?.querySelectorAll(".edit-pencil-hover").length ?? -1,
      overflow: document.body.scrollWidth - document.documentElement.clientWidth
    };
  });

  expect(desktopMetrics.columns).toBeGreaterThanOrEqual(2);
  expect(desktopMetrics.hasHero).toBe(true);
  expect(desktopMetrics.kpiCards).toBe(3);
  expect(desktopMetrics.sidebarWidth).toBeGreaterThan(300);
  expect(desktopMetrics.sideEditIcons).toBe(0);
  expect(desktopMetrics.overflow).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tasks/task-beta-discovery?principal=founder");
  await expect(page.getByText("Prepare managed services discovery")).toBeVisible();

  const mobileMetrics = await page.evaluate(() => {
    const layout = document.querySelector(".task-detail-layout");
    return {
      columns: layout ? getComputedStyle(layout).gridTemplateColumns.split(" ").length : 0,
      overflow: document.body.scrollWidth - document.documentElement.clientWidth
    };
  });

  expect(mobileMetrics.columns).toBe(1);
  expect(mobileMetrics.overflow).toBeLessThanOrEqual(0);
});

test("task detail log timesheet modal stays lightweight and aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tasks");
  test.skip(await page.getByText("Prepare managed services discovery").count() === 0, "Beta task seed is not available in the connected backend.");
  await page.goto("/tasks/task-beta-discovery?principal=founder");

  await page.getByRole("button", { name: /Ghi thời gian/i }).click();
  const dialog = page.getByRole("dialog", { name: "Ghi nhận thời gian" });
  await expect(dialog).toBeVisible();

  await expect(dialog.locator("select")).toHaveCount(0);
  await expect(dialog.locator('input[type="date"]')).toHaveCount(0);

  await dialog.locator(".task-date-trigger").click();
  await expect(dialog.getByRole("dialog", { name: /Ngày làm việc calendar/i })).toBeVisible();

  const desktopMetrics = await page.evaluate(() => {
    const shell = document.querySelector(".task-modal-shell.log-work") as HTMLElement | null;
    const trigger = shell?.querySelector(".task-date-trigger") as HTMLElement | null;
    const calendar = shell?.querySelector(".task-calendar-popover") as HTMLElement | null;
    const shellRect = shell?.getBoundingClientRect();
    const triggerRect = trigger?.getBoundingClientRect();
    const calendarRect = calendar?.getBoundingClientRect();
    return {
      calendarBottom: Math.round(calendarRect?.bottom ?? 0),
      calendarTop: Math.round(calendarRect?.top ?? 0),
      horizontalOverflow: document.body.scrollWidth - document.documentElement.clientWidth,
      shellWidth: Math.round(shellRect?.width ?? 0),
      triggerBottom: Math.round(triggerRect?.bottom ?? 0),
      viewportHeight: window.innerHeight
    };
  });

  expect(desktopMetrics.shellWidth).toBeLessThanOrEqual(600);
  expect(desktopMetrics.calendarTop).toBeGreaterThanOrEqual(desktopMetrics.triggerBottom);
  expect(desktopMetrics.calendarBottom).toBeLessThanOrEqual(desktopMetrics.viewportHeight);
  expect(desktopMetrics.horizontalOverflow).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  const mobileMetrics = await page.evaluate(() => {
    const shell = document.querySelector(".task-modal-shell.log-work") as HTMLElement | null;
    const calendar = shell?.querySelector(".task-calendar-popover") as HTMLElement | null;
    const shellRect = shell?.getBoundingClientRect();
    const calendarRect = calendar?.getBoundingClientRect();

    return {
      calendarBottom: Math.round(calendarRect?.bottom ?? 0),
      shellTop: Math.round(shellRect?.top ?? 0),
      viewportHeight: window.innerHeight
    };
  });

  expect(mobileMetrics.shellTop).toBeGreaterThanOrEqual(0);
  expect(mobileMetrics.shellTop).toBeLessThan(mobileMetrics.viewportHeight);
  expect(mobileMetrics.calendarBottom).toBeLessThanOrEqual(mobileMetrics.viewportHeight);
});

test("tasks create modal uses custom controls without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Công việc vận hành", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Danh sách công việc vận hành" })).toBeVisible();

  await page.getByRole("button", { name: /Tạo công việc/i }).click();
  const dialog = page.getByRole("dialog", { name: "Tạo công việc dự án" });
  await expect(dialog).toBeVisible();

  await expect(dialog.locator("select")).toHaveCount(0);
  await expect(dialog.locator('input[type="date"]')).toHaveCount(0);

  await dialog.getByRole("button", { name: /Ưu tiên Vừa/i }).click();
  await expect(dialog.getByRole("listbox", { name: "Ưu tiên" })).toBeVisible();
  await dialog.getByRole("option", { name: /Cao/i }).click();
  await expect(dialog.getByRole("button", { name: /Ưu tiên Cao/i })).toBeVisible();

  await dialog.getByRole("button", { name: /Ngày bắt đầu dd\/mm\/yyyy/i }).click();
  await expect(dialog.getByRole("dialog", { name: /Ngày bắt đầu calendar/i })).toBeVisible();
  await expect(dialog.getByRole("grid", { name: /Ngày bắt đầu calendar grid/i })).toBeVisible();

  const calendarMetrics = await dialog.evaluate((element) => {
    const calendar = element.querySelector(".task-calendar-popover") as HTMLElement | null;
    const trigger = element.querySelector(".task-date-trigger") as HTMLElement | null;
    const titleInput = element.querySelector('input[placeholder="VD: Chuẩn bị dữ liệu kickoff"]') as HTMLElement | null;
    const descriptionInput = element.querySelector("textarea") as HTMLElement | null;
    const customerSelect = element.querySelector(".task-select-control") as HTMLElement | null;
    const calendarRect = calendar?.getBoundingClientRect();
    const triggerRect = trigger?.getBoundingClientRect();

    const overlaps = (target: HTMLElement | null) => {
      if (!calendarRect || !target) return false;
      const rect = target.getBoundingClientRect();
      return calendarRect.left < rect.right && calendarRect.right > rect.left && calendarRect.top < rect.bottom && calendarRect.bottom > rect.top;
    };

    return {
      direction: calendar?.dataset.direction,
      opensAboveTrigger: Math.round(calendarRect?.bottom ?? 0) <= Math.round(triggerRect?.top ?? 0),
      opensBelowTrigger: Math.round(calendarRect?.top ?? 0) >= Math.round(triggerRect?.bottom ?? 0),
      overlapsCustomer: overlaps(customerSelect),
      overlapsDescription: overlaps(descriptionInput),
      overlapsTitle: overlaps(titleInput)
    };
  });

  expect(["down", "up"]).toContain(calendarMetrics.direction);
  if (calendarMetrics.direction === "up") {
    expect(calendarMetrics.opensAboveTrigger).toBe(true);
  } else {
    expect(calendarMetrics.opensBelowTrigger).toBe(true);
  }
  expect(calendarMetrics.overlapsTitle).toBe(false);

  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: /Hạn hoàn tất dd\/mm\/yyyy/i }).click();
  await expect(dialog.getByRole("dialog", { name: /Hạn hoàn tất calendar/i })).toBeVisible();

  const rightDateMetrics = await dialog.evaluate((element) => {
    const shellRect = element.getBoundingClientRect();
    const calendar = element.querySelector(".task-calendar-popover") as HTMLElement | null;
    const calendarRect = calendar?.getBoundingClientRect();

    return {
      calendarInsideLeft: Math.round(calendarRect?.left ?? 0) >= Math.round(shellRect.left),
      calendarInsideRight: Math.round(calendarRect?.right ?? 0) <= Math.round(shellRect.right),
      modalHeight: Math.round(shellRect.height)
    };
  });

  expect(rightDateMetrics.calendarInsideLeft).toBe(true);
  expect(rightDateMetrics.calendarInsideRight).toBe(true);
  expect(rightDateMetrics.modalHeight).toBeLessThanOrEqual(760);

  await expect.poll(async () => page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  const mobileMetrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const escapingControls = Array.from(element.querySelectorAll("button, input, textarea")).filter((node) => {
      const controlRect = (node as HTMLElement).getBoundingClientRect();
      return controlRect.left < rect.left - 1 || controlRect.right > rect.right + 1;
    }).length;

    return {
      height: Math.round(rect.height),
      escapingControls,
      width: Math.round(rect.width)
    };
  });

  expect(mobileMetrics.width).toBeLessThanOrEqual(390);
  expect(mobileMetrics.height).toBeLessThanOrEqual(844);
  expect(mobileMetrics.escapingControls).toBe(0);
});

test("portal route owns its external active state", async ({ page }) => {
  await page.goto("/portal");

  await expect(page.getByRole("heading", { name: "Giao diện khách hàng" })).toBeVisible();
  await expect(crmNavLink(page, "Giao diện khách hàng")).toHaveAttribute("aria-current", "page");
  await expect(crmNavLink(page, "Tổng quan")).not.toHaveAttribute("aria-current", "page");
});

test("resource management reads capacity from API", async ({ page }) => {
  await page.goto("/resource-mgmt");

  await expect(page.getByRole("heading", { name: "Nguồn lực & phân bổ" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Lịch tải nguồn lực theo tuần" }).getByText(/Implementation consultant|Còn trống/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Phân bổ nguồn lực" })).toBeVisible();
});

test("resource management keeps localhost-width layout when Polaris custom elements are unavailable", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1080 });
  await page.route("**/shopifycloud/**", (route) =>
    route.fulfill({
      body: "",
      contentType: "application/javascript",
      status: 200
    })
  );
  await page.goto("/resource-mgmt");

  await expect(page.getByRole("heading", { name: "Nguồn lực & phân bổ" })).toBeVisible();

  const metrics = await page.evaluate(() => {
    const pageHost = document.querySelector("s-page");
    const grid = document.querySelector(".resource-summary-grid");
    const main = document.querySelector(".shopify-app-main");
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const gridRect = grid?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();

    return {
      badgeDisplay: getComputedStyle(document.querySelector("s-badge") as Element).display,
      customPageDefined: Boolean(customElements.get("s-page")),
      gridInsetLeft: Math.round((gridRect?.left ?? 0) - (mainRect?.left ?? 0)),
      gridColumns: gridStyle?.gridTemplateColumns.split(" ").filter(Boolean).length ?? 0,
      gridWidth: Math.round(gridRect?.width ?? 0),
      mainWidth: Math.round(mainRect?.width ?? 0),
      overflow: document.body.scrollWidth - document.documentElement.clientWidth,
      pageDisplay: pageHost ? getComputedStyle(pageHost).display : ""
    };
  });

  expect(["contents", "inline"]).toContain(metrics.pageDisplay);
  expect(metrics.gridInsetLeft).toBe(16);
  expect(metrics.mainWidth).toBeGreaterThanOrEqual(2200);
  expect(metrics.gridWidth).toBeGreaterThanOrEqual(2100);
  expect(metrics.gridColumns).toBe(4);
  expect(metrics.overflow).toBeLessThanOrEqual(0);
  expect(metrics.customPageDefined).toBe(false);
  expect(["flex", "inline-flex"]).toContain(metrics.badgeDisplay);
});

test("project controls reads P&L from API", async ({ page }) => {
  await page.goto("/project-controls");

  await expect(page.getByRole("heading", { name: "Kiểm soát dự án" })).toBeVisible();
  await expect(page.getByText("Dữ liệu dự án đã đồng bộ")).toBeVisible();
  await expect(page.getByRole("table", { name: "Tổng quan tài chính dự án" })).toBeVisible();
});

test("dashboard financial cards do not render fabricated sparklines", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByText("Incoming income")).toBeVisible();
  await expect(page.getByText("Profit from income")).toBeVisible();
  await expect(page.getByTestId("legacy-finance-income-mix")).toBeVisible();
  await expect(page.getByTestId("legacy-finance-profit-mix")).toBeVisible();
  await expect(page.getByTestId("legacy-finance-income-mix").locator("svg")).toHaveCount(0);
  await expect(page.getByTestId("legacy-finance-profit-mix").locator("svg")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("legacy-finance-income-mix")).toBeVisible();
  await expect(page.getByTestId("legacy-finance-profit-mix")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("financial and capacity data labels stay readable on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/project-controls");

  await expect(page.getByRole("heading", { name: "Kiểm soát dự án" })).toBeVisible();
  await expect(page.getByText("Dữ liệu dự án đã đồng bộ")).toBeVisible();
  await expect(page.getByRole("table", { name: "Tổng quan tài chính dự án" })).toBeVisible();
  await expect(page.getByText(/Mục tiêu: 50%|Biên lợi nhuận/i).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Kiểm soát dự án" })).toBeVisible();
  await expect(page.getByText("Dữ liệu dự án đã đồng bộ")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/resource-mgmt");
  await expect(page.getByRole("table", { name: "Lịch tải nguồn lực theo tuần" })).toBeVisible();
  await expect(page.getByText(/\d+(\.\d+)?d \/ \d+(\.\d+)?d/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Nguồn lực & phân bổ" })).toBeVisible();
  await expect(page.getByText(/Dữ liệu nguồn lực đã đồng bộ|Đang dùng dữ liệu dự phòng/i).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("business function routes cover the full operating menu", async ({ page }) => {
  const routes = [
    { heading: "Đề xuất & phê duyệt", nav: "Đề xuất", path: "/proposals", operational: "proposal" },
    { heading: "Dự án triển khai", nav: "Dự án triển khai", path: "/delivery", operational: "delivery" },
    { heading: "Tài chính & Công nợ", nav: "Tài chính", path: "/finance", operational: "finance" },
    { heading: "Hỗ trợ khách hàng", nav: "Hỗ trợ khách hàng", path: "/support", operational: false },
    { heading: "Điều hành", nav: "Điều hành", path: "/management", operational: false }
  ];

  for (const route of routes) {
    await page.goto(route.path);

    await expect(page.getByRole("heading", { level: 1, name: route.heading, exact: true })).toBeVisible();
    await expect(crmNavLink(page, route.nav)).toHaveAttribute("aria-current", "page");
    if (route.operational === "proposal") {
      await expect(page.getByRole("heading", { name: "Gói đề xuất" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sẵn sàng gửi" })).toBeVisible();
    } else if (route.operational === "finance") {
      await expect(page.getByRole("heading", { name: "Lịch thanh toán" })).toBeVisible();
      if (await page.getByRole("table", { name: "Lịch thanh toán tài chính" }).count()) {
        await expect(page.getByRole("table", { name: "Lịch thanh toán tài chính" })).toBeVisible();
      }
    } else if (route.operational === "delivery") {
      await expect(page.getByText("Danh sách dự án triển khai", { exact: true })).toBeVisible();
      await expect(page.getByRole("table", { name: "Danh sách dự án triển khai" })).toBeVisible();
    } else {
      await expect(page.getByText("Điểm kiểm tra sẵn sàng")).toBeVisible();
      await expect(page.getByText("Phạm vi quy trình")).toBeVisible();
      await expect(page.getByRole("table", { name: `${route.heading} workflow coverage` })).toBeVisible();
    }
  }
});

test("finance route renders cash queue and receivables workspace responsively", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/finance");

  await expect(page.getByRole("heading", { name: "Tài chính & Công nợ" })).toBeVisible();
  await expect(page.getByText("Bảng thu tiền cho đội tài chính")).toBeVisible();
  if (await page.getByRole("table", { name: "Lịch thanh toán tài chính" }).count()) {
    await expect(page.getByRole("table", { name: "Lịch thanh toán tài chính" })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Công nợ cần theo dõi" })).toBeVisible();
  if (await page.getByRole("link", { name: "Mở chi tiết" }).count()) {
    await expect(page.getByRole("link", { name: "Mở chi tiết" })).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Lịch thanh toán" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Công nợ cần theo dõi" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("finance schedule detail renders milestone, billing and evidence context", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/finance");
  test.skip(await page.getByText("Alpha CRM/ERP phase 1 payment schedule").count() === 0, "Alpha payment schedule seed is not available in the connected backend.");
  await page.goto("/finance/pay-alpha-phase1");

  await expect(page.getByRole("heading", { name: "Chi tiết tài chính" })).toBeVisible();
  await expect(page.getByText("Alpha CRM/ERP phase 1 payment schedule")).toBeVisible();
  await expect(page.getByText("Tiến độ thu tiền")).toBeVisible();
  await expect(page.getByRole("table", { name: "Danh sách hóa đơn tài chính" })).toBeVisible();
  await expect(page.getByText("Kickoff hóa đơn tài liệu")).toBeVisible();
  await expect(page.getByText("Nhắc công nợ")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ghi nhận thanh toán" })).toBeDisabled();
  await expect(page.getByText(/Khóa tạm thời/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Hóa đơn & thanh toán")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chứng từ" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("proposals route shows responsive deal desk workbench", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/proposals");

  await expect(page.getByRole("heading", { name: "Đề xuất & phê duyệt" })).toBeVisible();
  await expect(page.locator(".proposal-kicker", { hasText: "Hàng đợi đề xuất" })).toBeVisible();
  test.skip(await page.locator(".proposal-package-card").count() === 0, "Proposal package seed is not available in the connected backend.");
  await expect(page.locator(".proposal-package-card").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sẵn sàng gửi" })).toBeVisible();
  await expect(page.getByText("Cổng gửi khách hàng", { exact: true })).toBeVisible();
  await expect(page.getByText("Giá trị đề xuất", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tài liệu bắt buộc" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Yêu cầu phê duyệt" })).toBeVisible();

  const desktopMetrics = await page.evaluate(() => {
    const grid = document.querySelector(".proposal-main-grid");
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
      packages: document.querySelectorAll(".proposal-package-card").length,
      readinessSteps: document.querySelectorAll(".proposal-flow-step").length,
      overflow: document.body.scrollWidth - document.documentElement.clientWidth
    };
  });

  expect(desktopMetrics.columns).toBeGreaterThanOrEqual(2);
  expect(desktopMetrics.packages).toBeGreaterThanOrEqual(1);
  expect(desktopMetrics.readinessSteps).toBe(4);
  expect(desktopMetrics.overflow).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Gói đề xuất" })).toBeVisible();

  const mobileMetrics = await page.evaluate(() => {
    const grid = document.querySelector(".proposal-main-grid");
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
      overflow: document.body.scrollWidth - document.documentElement.clientWidth
    };
  });

  expect(mobileMetrics.columns).toBe(1);
  expect(mobileMetrics.overflow).toBeLessThanOrEqual(0);
});

test("route changes and filters stay silent without document reloads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/accounts");

  let marker = await markWindowForSilentRefresh(page, "accounts-filter");
  await page.locator('input[placeholder="Tìm theo tên hoặc mã..."]').fill("Alpha");
  await expectSilentRefresh(page, marker);

  marker = await markWindowForSilentRefresh(page, "nav-tasks");
  await crmNavLink(page, "Công việc").click();
  await page.waitForURL("**/tasks");
  await expectSilentRefresh(page, marker);

  marker = await markWindowForSilentRefresh(page, "tasks-filter");
  await page.locator('input[placeholder="VD: kickoff, khảo sát, hỗ trợ..."]').fill("kickoff");
  await expectSilentRefresh(page, marker);

  if (await page.getByText("Run delivery kickoff").count()) {
    marker = await markWindowForSilentRefresh(page, "task-detail");
    await page.getByText("Run delivery kickoff").first().click();
    await page.waitForURL(/\/tasks\//);
    await expectSilentRefresh(page, marker);

    marker = await markWindowForSilentRefresh(page, "detail-back");
    await page.getByText("Quay lại công việc").first().click();
    await page.waitForURL("**/tasks*");
    await expectSilentRefresh(page, marker);
  }

  marker = await markWindowForSilentRefresh(page, "nav-pipeline");
  await crmNavLink(page, "Cơ hội").click();
  await page.waitForURL("**/pipeline");
  await expectSilentRefresh(page, marker);

  const menuRoutes = [
    { heading: "Đề xuất & phê duyệt", href: "/proposals", nav: "Đề xuất", url: /\/proposals$/ },
    { heading: "Dự án triển khai", href: "/delivery", nav: "Dự án triển khai", url: /\/delivery$/ },
    { heading: "Tài chính & Công nợ", href: "/finance", nav: "Tài chính", url: /\/finance$/ },
    { heading: "Hỗ trợ khách hàng", href: "/support", nav: "Hỗ trợ khách hàng", url: /\/support$/ },
    { heading: "Điều hành", href: "/management", nav: "Điều hành", url: /\/management$/ },
    { heading: "Phân quyền & truy cập", href: "/policy", nav: "Chính sách", url: /\/policy$/ },
    { heading: "Dữ liệu & tích hợp", href: "/data", nav: "Dữ liệu", url: /\/data$/ },
    { heading: "Giao diện khách hàng", href: "/portal", nav: "Giao diện khách hàng", url: /\/portal$/ },
    { heading: "Nguồn lực & phân bổ", href: "/resource-mgmt", nav: "Nguồn lực", url: /\/resource-mgmt$/ },
    { heading: "Kiểm soát dự án", href: "/project-controls", nav: "Kiểm soát dự án", url: /\/project-controls$/ }
  ];

  for (const route of menuRoutes) {
    marker = await markWindowForSilentRefresh(page, `nav-${route.nav}`);
    await crmNavLink(page, route.nav).click();
    await expect(page).toHaveURL(route.url);
    await expectSilentRefresh(page, marker);
    await expect(page.getByRole("heading", { level: 1, name: route.heading, exact: true })).toBeVisible();
    await expect(crmNavLink(page, route.nav)).toHaveAttribute("aria-current", "page");
  }
});
