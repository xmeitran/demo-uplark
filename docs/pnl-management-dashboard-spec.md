# Spec: PM P&L Management Dashboard

## Objective

Xây dựng lại toàn bộ tab `/pnl` thành màn điều hành dành cho Project Manager/Founder. Màn hình phải trả lời nhanh bốn câu hỏi:

1. Danh mục project đang tạo ra doanh thu và biên lợi nhuận thế nào?
2. Project nào đang vượt kế hoạch giờ/chi phí hoặc có nguy cơ tụt margin?
3. Số liệu nào chưa đủ tin cậy vì còn logwork chờ duyệt, thiếu cost rate hoặc thiếu baseline?
4. Tôi cần mở project nào để xử lý tiếp theo?

Thiết kế ưu tiên bảng ngoại lệ và hành động quản lý; chỉ giữ visual nào giúp phát hiện xu hướng hoặc variance. Không giữ các chart/metric chỉ để trang trông “nhiều dữ liệu”.

## Assumptions

1. P&L tiếp tục là màn nội bộ, chỉ người có quyền xem tài chính mới thấy số tiền.
2. Tiền tệ mặc định là VND, nhưng dữ liệu phải giữ currency theo project.
3. `plannedRevenueAmount`, `plannedCostAmount`, `approvedLaborMinutes`, `actualLaborCostAmount`, `directCostAmount`, `writeOffAmount`, `totalCostAmount`, `grossMarginAmount` là nguồn tài chính chuẩn từ backend.
4. P&L theo kỳ phải được tính cùng một kỳ ở backend; frontend không tự ghép hai dataset khác phạm vi để tạo số liệu tổng hợp.
5. Earned Value (PV/EV/AC, CPI/SPI) chưa đủ dữ liệu chuẩn trong schema hiện tại, nên chưa đưa vào KPI chính. Chỉ thêm khi có baseline time-phased và quy tắc EV được xác nhận.
6. Giai đoạn đầu không thêm ngân sách/forecast thủ công mới; forecast chỉ hiển thị khi có nguồn dữ liệu rõ ràng, còn thiếu thì ghi “Chưa có forecast”.

## Capability map

| Module | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `pnl-data-contract` | API response thống nhất theo kỳ, nguồn dữ liệu và data quality | DB hiện có |
| `pnl-executive-overview` | KPI tối thiểu, health summary, exceptions | `pnl-data-contract` |
| `pnl-portfolio-table` | Bảng project có variance và next action | `pnl-data-contract`, overview |
| `pnl-project-drilldown` | Chi tiết project theo người/task/reconciliation | `pnl-data-contract` |
| `pnl-governance` | trạng thái kỳ, lock/reopen, rebuild allocation, export | `pnl-data-contract`, permissions |

Build order: `pnl-data-contract` → `pnl-executive-overview` → `pnl-portfolio-table` → `pnl-project-drilldown` → `pnl-governance`.

## Proposed information architecture

### 1. Header and filters

- Tiêu đề: `P&L Control Center`.
- Kỳ báo cáo là filter bắt buộc, mặc định kỳ hiện tại.
- Bộ lọc: Client, Project, Owner/PIC, trạng thái P&L, chỉ xem ngoại lệ.
- Hiển thị status kỳ: Open / Locked / Reopened và timestamp dữ liệu.
- Có một nút Export Excel dùng đúng filter hiện tại.
- Filter lưu trên URL để mở detail rồi quay lại không mất ngữ cảnh.

### 2. Executive summary

Chỉ giữ các chỉ số quản lý sau:

- Doanh thu ghi nhận/kế hoạch.
- Tổng cost thực tế và cost dự kiến nếu có nguồn.
- Gross margin và margin %.
- Plan hour vs approved P&L hour, kèm variance %.
- Số project cần hành động.

Mỗi card có `value`, `basis/source`, và tooltip công thức. Không hiển thị “0” nếu dữ liệu chưa có; dùng `Chưa có dữ liệu` hoặc `Chưa đủ điều kiện`.

### 3. Needs attention

Bảng ngoại lệ đứng trước các chi tiết:

- Margin risk: margin dưới ngưỡng cấu hình hoặc âm.
- Over plan: approved/logged hour vượt baseline.
- Pending reconciliation: còn giờ chờ duyệt/phân loại.
- Missing financial setup: thiếu revenue, planned cost, cost rate hoặc baseline.
- Period locked/reopened cần hành động governance.

Mỗi dòng có: project, loại ngoại lệ, mức độ, impact tiền/giờ, owner, next action, link mở đúng P&L detail.

### 4. Portfolio table

Bảng là vùng làm việc chính, không dùng card grid cho từng project.

Cột mặc định:

`Project / Client | Owner | Project status | Revenue | Actual cost | Gross margin | Margin % | Plan h | P&L h | Variance | Data quality | Next action`

- Sort mặc định theo severity rồi impact giảm dần.
- Có density compact và sticky header.
- Row click mở detail nhưng giữ nguyên filter URL.
- Có empty state theo từng trường hợp: không có project, không có quyền, API lỗi, hoặc dữ liệu kỳ chưa sẵn sàng.

### 5. Project P&L detail

Detail chỉ hiển thị khi chọn project:

- Summary tài chính: revenue, cost, margin, margin %.
- Control summary: plan h, P&L h, pending, excluded, variance.
- Reconciliation rõ công thức `logwork = included + pending + excluded`.
- Bảng cost theo người và cost rate.
- Bảng task/leaf task có plan, actual, P&L, variance và status.
- Timeline/biểu đồ ngày chỉ là phần phụ có thể mở rộng, không nằm above-the-fold.
- Link xử lý: mở project, xem time entries, xử lý kỳ hoặc reforecast nếu có quyền.

### 6. Governance and export

- Hiển thị kỳ và trạng thái lock rõ ràng.
- Người có quyền phù hợp thấy action `Rebuild allocations`, `Lock period`, `Reopen` với reason.
- Export Excel gồm summary, exceptions, portfolio, reconciliation và detail của filter hiện tại.
- Không cho action chỉnh sửa nếu kỳ đã khóa.

## Data/API changes

Tạo contract response mới, additive và typed, ví dụ `PnlDashboardResponse`:

```ts
type PnlDashboardResponse = {
  data: {
    period: { key: string; start: string; end: string; status: "OPEN" | "LOCKED" | "REOPENED"; generatedAt: string };
    totals: {
      revenue: number;
      actualCost: number;
      forecastCost?: number;
      grossMargin: number;
      grossMarginPercent?: number;
      planMinutes: number;
      pnlMinutes: number;
      pendingMinutes: number;
      exceptionCount: number;
    };
    exceptions: PnlException[];
    projects: PnlProjectControlRow[];
  };
  meta: { source: "postgresql"; rowScope: string; dataQuality: "complete" | "partial" | "unavailable" };
};
```

Backend must apply `period`, `projectId`, `accountId`, `ownerUserId`, `status`, and `exceptionsOnly` consistently. A project row must include source/basis fields so UI never presents derived values as official values.

## Remove or demote from current UI

- Expense six-group cards from overview.
- Daily chart and person/day matrix from overview; move to project detail secondary sections.
- Duplicate/verbose KPI cards that repeat the same hour totals.
- Placeholder/demo values or silent fallback when P&L API is unavailable.
- The duplicated page title currently present in the workbench.

## Code style and boundaries

- Keep financial formulas in API/domain selectors, not in JSX.
- UI components receive typed view models and render explicit unavailable states.
- Preserve existing permission checks; never reveal money fields based only on frontend role state.
- Reuse existing `MoneyAmount`, `CrmSelect`, `AppShell`, export and permission helpers.
- Do not change unrelated Timesheet, Project, or P&L configuration screens in this slice.

## Testing strategy

- Unit: aggregation, variance, margin, severity ordering, data-quality classification, period boundaries.
- API: one response for a period with included/pending/excluded entries; permission denial; locked period behavior.
- Web: filter URL persistence, empty/error/partial states, row-to-detail navigation, hidden financial values for unauthorized users.
- Runtime: local browser smoke test for `/pnl`, filtering, detail, back navigation, and Excel export.

Commands:

```bash
pnpm --filter @b2b-crm/contracts typecheck
pnpm --filter @b2b-crm/api test -- resource-controls
pnpm --filter @b2b-crm/web typecheck
pnpm --filter @b2b-crm/web build
git diff --check
```

## Success criteria

- PM can identify the top projects requiring action in under one screen without reading every chart.
- All overview totals are computed from the same selected period and show their data basis.
- Portfolio rows expose revenue, cost, margin, hour variance, data quality, owner, and next action.
- Clicking a row opens the correct detail and returning preserves filters/period.
- No misleading zero/demo values appear when API data is unavailable or incomplete.
- Existing P&L permission boundaries, export, lock/reopen, and reconciliation behavior remain intact.

## Open questions

1. Margin risk threshold: use one workspace-configured percentage, or separate warning/critical thresholds?
2. Forecast: should phase one show `Chưa có forecast`, or should we derive ETC from remaining planned hours × current blended cost rate?
3. Default overview scope: all projects visible to the user, or only active projects?

## Research basis

- PMI describes management displays around planned value, actual cost, earned value, variance, and milestone context: [Monitoring Performance Against Baseline](https://www.pmi.org/learning/library/monitoring-performance-against-baseline-10416).
- Oracle’s project cost variance dashboard centers on planned, actual, and variance by task, explicitly for project managers: [Project Cost Variance Dashboard](https://docs.oracle.com/en/cloud/saas/project-management/26a/fapca/project-cost-variance-dashboard.html).
- Portfolio dashboard guidance emphasizes planned vs actual/forecast, at-risk projects, and resource/health exceptions rather than many decorative charts: [Smartsheet Project Portfolio Dashboards](https://www.smartsheet.com/content/project-portfolio-dashboards), [Portfolio Hub PMO Reporting](https://portfoliohub.io/blog/portfolio-dashboard).
