# Implementation Plan: Guided Project Todo Tree

## Goal

Chuẩn hóa project thành một todo tree có thể điều hành xuyên suốt:

`Project → Milestone → Stage → Task → Subtask`

Project template phải tạo được cả task mẫu; người dùng có thể chỉnh sửa task và thêm subtask trực tiếp trong Project Detail. Project cũ không có task vẫn phải mở và vận hành bình thường.

## Current findings

- Prisma đã có `ProjectTask.stageId` và `ProjectTask.parentTaskId` với quan hệ `parentTask/subtasks`; không cần thêm bảng subtask.
- API đã có CRUD task và hỗ trợ `parentTaskId`, nhưng `CreateProjectInput`/`CreateProjectMilestoneInput` chưa mô tả task trong stage.
- Create Project hiện chỉ seed Milestone → Stage.
- AI import hiện trả về Milestone → Stage, cần mở rộng parser/preview để nhận diện Task → Subtask khi nguồn có dữ liệu.
- Project Detail đã tải task và có modal Add/Edit Task, nhưng cần hiển thị cây và hành động Add Subtask theo parent task.

## Architecture decisions

1. Dùng `ProjectTask.parentTaskId` cho subtask, giữ đúng một cấp subtask trong UI hiện tại; backend không làm mất khả năng recursive nếu dữ liệu cũ đã có sâu hơn.
2. Task luôn thuộc Stage; subtask kế thừa `projectId`, `stageId`, `accountId` từ task cha và không xuất hiện như task top-level.
3. Template payload có dạng `milestones[].stages[].tasks[].subtasks[]`; các field task là additive/optional để không phá template cũ.
4. Tiến độ hiển thị lấy leaf work items làm nguồn chính: task có subtask sẽ tính theo subtask, task không có subtask tính theo chính task.
5. Không tự động tạo task cho project cũ trong migration; chỉ project mới/template mới seed task. Người dùng vẫn có thể bổ sung task/subtask thủ công.

## Delivery slices

### Slice 1 — Contracts and seed persistence

- Mở rộng contracts cho `ProjectTaskTemplateInput` và nested tasks/subtasks.
- Normalize/validate template, chống parent task sai stage và chống trùng thứ tự.
- Khi tạo project, tạo milestone/stage trước, sau đó tạo task và subtask trong cùng transaction.
- Giữ payload cũ không có tasks chạy như hiện tại.

Acceptance criteria:

- Tạo project từ template nested lưu đủ 4 tầng.
- Template cũ chỉ có milestone/stage vẫn tạo project thành công.
- Không thể tạo subtask trỏ sang task khác stage/project.

### Slice 2 — Template and AI import

- Mở rộng template lưu/preview để trả task/subtask.
- AI/rule parser nhận các cột phổ biến như `Milestone`, `Stage`, `Task`, `Subtask`, `Parent`, `Work item`, kể cả file flat hoặc nhiều sheet.
- Preview trong popup hiển thị số lượng milestone/stage/task/subtask và cho phép sửa trước khi áp dụng.

Acceptance criteria:

- File chỉ có milestone/stage vẫn preview như cũ.
- File có task/subtask tạo được draft nested và không làm mất các node cha.
- Khi apply draft, popup tạo project gửi đúng nested payload.

### Slice 3 — Project Detail tree UX

- Hiển thị Milestone → Stage → Task → Subtask trong Tasks/Project Sheet.
- Thêm action `+ Subtask` trên task cha; form tái sử dụng field task, tự khóa Stage/parent.
- Cho phép expand/collapse, edit, transition và delete theo đúng parent.
- Hiển thị count/progress leaf work items và cảnh báo task cha có subtask chưa hoàn tất.

Acceptance criteria:

- Người dùng thêm được subtask từ task cụ thể và thấy ngay dưới task đó sau reload.
- Edit/delete subtask không làm mất task cha hoặc task cùng stage.
- Project cũ không có subtask vẫn giữ layout gọn và thao tác Add Task bình thường.

### Slice 4 — Tests and regression

- Unit test normalize nested template và create transaction mapping.
- API test nested create + invalid cross-stage parent.
- Web typecheck/build và smoke test popup import → apply → Project Detail → Add Subtask.
- Kiểm tra các màn Timesheet/P&L vẫn nhận đúng task leaf và parent metadata.

## Risks

| Risk | Mitigation |
|---|---|
| Dữ liệu cũ có task không có stage | Giữ nhóm `Unassigned`, không tự gán sai stage |
| Task cha có time log nhưng thêm subtask | Giữ log cũ, chỉ dùng leaf rule cho progress mới |
| File import có cấu trúc không chuẩn | Fallback flat rows + warning, không silently drop dữ liệu |
| Tạo project thất bại giữa cây | Tạo toàn bộ trong một transaction |

## Verification checklist

- [ ] API contracts/typecheck
- [ ] Prisma/runtime query không cần migration ngoài thay đổi schema (xác nhận bằng generate/typecheck)
- [ ] Unit/API tests nested tree
- [ ] Web typecheck/build
- [ ] Local browser smoke test
