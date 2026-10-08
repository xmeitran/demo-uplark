# Implementation Plan: Timesheet UX/UI theo biên bản rà soát

## Overview

Đưa `/timesheet` về đúng bố cục trong tài liệu `[PMS] BIÊN BẢN RÀ SOÁT GIAO DIỆN BẢN DEMO`: một màn quản lý theo nhân sự/dự án, bảng là trọng tâm, bỏ các biểu đồ trùng hoặc không có yêu cầu BRD, chuẩn hóa trạng thái và mở chi tiết theo dòng.

## Task List

### Phase 1: Timesheet information architecture
- [x] Task 1: Gộp view quản lý Timesheet, bỏ tab Theo ngày & theo tuần khỏi UI và chuyển lưới ngày × nhân sự vào màn tháng.
- [x] Task 2: Rút gọn KPI/bộ lọc và bảng nhân sự; gộp Ngày trống vào bảng, bỏ cột Giờ thiếu/Chi tiết.

### Checkpoint: Timesheet core
- [x] Typecheck và test web pass.
- [x] `/timesheet` desktop/mobile không còn các chart bị yêu cầu bỏ.

### Phase 2: Project sheet and status consistency
- [x] Task 3: Bỏ chart Kanban/biểu đồ rỗng trên view dự án; giữ bảng dự án, cây Milestone → Stage → Task và readiness.
- [x] Task 4: Chuẩn hóa nhãn trạng thái Task/Project và highlight dữ liệu vượt kế hoạch.
- [x] Task 5: Mở drill-down Time Log nguồn từ tổng giờ ở Project/Milestone/Stage/Task và bổ sung route “Giờ của tôi”.
- [x] Task 6: Nối hierarchy từ `/api/tasks` để không còn gom mọi task vào tên giả “Time log”.

### Checkpoint: Project sheet
- [x] Typecheck, test và build pass.
- [x] View dự án mặc định gập theo Milestone/Stage, chỉ mở Milestone đang chạy.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| API live vẫn trả trạng thái cũ | UI có thể hiển thị khác tài liệu | Chuẩn hóa ở presentation layer, giữ nguyên raw value trong data layer |
| Dữ liệu thiếu estimate | KPI/biểu đồ cũ có thể rỗng | Hiển thị rõ “Chưa có dữ liệu”, không bịa số |
| Xóa tab làm hỏng deep link cũ | Link lưu trước đây không mở đúng | Giữ fallback `daily` về view tháng trong workbench |

## Open Questions

- “Giờ của tôi” đã được tách thành route `/timesheet/me`, nhưng vẫn dùng cùng workbench và scope `self` để không nhân đôi logic/API.

## Phase 3: Đối chiếu hai biên bản bổ sung (2026-09-29)

- [x] Task 7: Thêm dải cảnh báo đầu trang cho Timesheet/Project Sheet từ dữ liệu live.
- [x] Task 8: Bỏ các chart Kanban/biểu đồ rỗng khỏi Project Sheet, giữ bảng và checklist nghiệp vụ.
- [x] Task 9: Mặc định chỉ mở Milestone đang chạy; các Milestone/Stage khác gập được.
- [x] Task 10: Chuẩn hóa các nhãn đánh giá dữ liệu và cảnh báo vượt kế hoạch theo wireframe.

### Checkpoint: Biên bản bổ sung
- [x] Unit tests và typecheck pass.
- [x] Build frontend pass.
- [x] Runtime smoke check `/timesheet`, `/timesheet/me`, `?view=project`.

### Remaining scope from the two documents

- Alert strip is now live-data driven for missing logs, overdue/blocked tasks and over-plan projects; the full 16-trigger configuration screen and workflow-gate mutations remain a separate backend slice.
- Project/Timesheet drill-downs now open source Time Log rows. Lark document links, transition-dossier gates, Activity audit expansion, P&L permission review and planning-lock history are not changed in this UI slice.

## Constraints

- Giữ nguyên shell/tab điều hướng hiện có theo yêu cầu trước của người dùng; chỉ gỡ các khối được biên bản đánh dấu không có nghiệp vụ tương ứng.
- Không thay đổi dữ liệu live hoặc gửi tin nhắn Lark trong slice này.
