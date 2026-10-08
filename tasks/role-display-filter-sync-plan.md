# Implementation Plan: Đồng bộ Role/System role và bộ lọc nhân sự

## Overview

Chuẩn hóa cách hệ thống hiển thị Role nghiệp vụ và System role cho các nguồn dữ liệu nhân sự dùng chung, để Users, People, Timesheet, reviewer milestone, Accounts, Resource management và Dashboard không còn hiển thị mã role thô hoặc nhãn khác nhau.

## Architecture Decisions

- Role nghiệp vụ dùng đúng 6 nhãn: Customer success, Project Manager, DX enabler, Business development, Marketing B2B, Chưa gán.
- System role dùng đúng 3 nhãn: Founder/GM, Workspace Admin, Workspace User.
- Mã quyền nội bộ cũ vẫn được giữ ở backend/policy để bảo toàn authorization; chỉ chuẩn hóa lớp display/filter của nhân sự.
- Department vẫn giữ ở các báo cáo vận hành cần dimension phòng ban như Timesheet/Analytics; không dùng Department làm Role nghiệp vụ.
- API directory bổ sung `resourceDisplayRole` theo kiểu additive để các client có đủ dữ liệu mà không phá contract cũ.

## Task List

### Phase 1: Shared contract and directory data

- [x] Task 1: Đưa danh sách Role nghiệp vụ và normalizer dùng chung vào contracts/UI helper.
- [x] Task 2: Bổ sung resource display role vào workspace directory API và chuẩn hóa dữ liệu cũ khi đọc.

### Phase 2: Employee-facing consumers

- [x] Task 3: Đồng bộ mapper/filter cho workspace user selector, Timesheet và milestone reviewer.
- [x] Task 4: Đồng bộ hiển thị Role trong Accounts, Resource management và Dashboard.

### Checkpoint: Identity display consistency

- [x] Role filter chỉ còn 6 nhãn nghiệp vụ.
- [x] System role không lẫn với Role nghiệp vụ.
- [x] Không còn raw `SALES_OWNER`/`DELIVERY_LEAD`/`WORKSPACE_ADMIN` trong các màn hình nhân sự.

### Phase 3: Verification

- [x] Focused unit tests cho normalizer và directory mapper.
- [x] Web/API typecheck.
- [x] Smoke check Users, People và project/reviewer selectors trên local.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Mã role cũ vẫn cần cho policy | Authorization sai nếu xóa mã | Giữ nguyên role code backend, chỉ đổi display/filter |
| Dữ liệu resource profile cũ không khớp nhãn mới | Filter bị lệch | Normalize khi đọc và khi ghi |
| Department là dimension báo cáo hợp lệ | Xóa nhầm filter Timesheet/Analytics | Chỉ bỏ Department khỏi directory/profile Role UI |
