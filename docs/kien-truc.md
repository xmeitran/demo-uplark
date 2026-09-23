# Kiến trúc và bản đồ source

## Tổng quan

Dự án dùng monorepo, với API dạng modular monolith: nhiều miền nghiệp vụ trong cùng ứng dụng NestJS, không phải mỗi thư mục là một microservice. Web Next.js có giao diện và lớp BFF chuyển tiếp API, quản lý cookie/session ở biên trình duyệt. Worker là tiến trình riêng dùng Redis.

PostgreSQL là nguồn dữ liệu nghiệp vụ chính. Lark là nhà cung cấp đăng nhập/danh bạ và adapter tích hợp; không thay thế mô hình tenant/workspace của CRM.

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `apps/web/app` | Trang, layout, route handler BFF |
| `apps/web/src/components` | Thành phần giao diện và workspace |
| `apps/web/src/lib` | Session, proxy, chính sách tuyến, tiện ích |
| `apps/api/src/modules/identity-access` | Session, Lark OAuth, người dùng, role và quyền |
| `apps/api/src/modules/tenant-workspace` | Ngữ cảnh tenant/workspace |
| `apps/api/src/modules/sales-crm` | Account/Contact và nghiệp vụ CRM |
| `apps/api/src/modules/delivery-handoff` | Dự án, milestone/stage/task, lịch và giờ làm |
| `apps/api/src/modules/resource-controls` | Nguồn lực, phân bổ và kiểm soát dự án |
| `apps/api/src/modules/workforce-analytics` | Phân tích nguồn lực/dự án còn beta |
| `apps/api/src/modules/proposal-governance` | Đề xuất và luồng phê duyệt |
| `apps/api/src/modules/finance-signal` | Lịch thanh toán và tín hiệu tài chính |
| `apps/api/src/modules/customer-experience` | Ticket/hỗ trợ |
| `apps/api/src/modules/artifact-mgmt` | Tệp, phiên bản, quyền tải |
| `apps/worker`, `scripts/operations/lark-cds-sync.mjs` | Lập lịch, khóa và đồng bộ danh bạ |
| `packages/contracts` | Kiểu/hợp đồng chia sẻ web và API |
| `prisma/schema.prisma`, `prisma/migrations` | Schema và migration có phiên bản |

Sự tồn tại của module không chứng minh vòng đời nghiệp vụ đã hoàn chỉnh. Xem [trạng thái tuyến](../apps/web/src/lib/production-route-readiness.ts).

## Biên tin cậy

1. Trình duyệt gửi cookie phiên đến Next.js.
2. BFF chuyển yêu cầu đến API nội bộ theo `CRM_API_INTERNAL_URL`.
3. API giải quyết principal/session, kiểm tra role/workspace và quyền trên đối tượng.
4. Prisma đọc/ghi PostgreSQL; lớp tích hợp gọi Lark khi đã cấu hình.
5. Worker chỉ đồng bộ danh bạ khi cờ tính năng được bật chủ động.

Không tin role, email, workspace hoặc “principal” do client tự khai. Cần kiểm chứng các phép đọc/ghi chéo workspace bằng integration test; ẩn menu hoặc dùng TypeScript không thay thế kiểm soát quyền phía máy chủ.

## Mô hình dữ liệu chính

- `TenantWorkspace` và session/role binding mang ngữ cảnh sở hữu dữ liệu.
- `Account` → `Contact` / `Project`.
- `Project` → `ProjectMilestone` → `ProjectStage` → `ProjectTask`.
- Task có kế hoạch (`TaskPlanningBlock`), giờ làm thực tế (`TaskTimeEntry`), bình luận, tệp và lịch sử.
- Kế hoạch, estimate và giờ làm thực tế là các khái niệm riêng; không cộng kế hoạch vào thực tế.
- File và quyền tải cần kiểm tra cùng scope, trạng thái quét và thời hạn grant.

## Các quyết định của bản tiếp nhận

- Giữ `@b2b-crm/*`, migration và source nghiệp vụ đã commit để tránh đổi hợp đồng không cần thiết.
- Giữ upstream history và bản quyền; repository tổ chức dùng tên `lark-partner-crm`.
- Không nhập file môi trường, database/backup và product-memory vận hành.
- Không gộp các thay đổi chưa commit Timesheet/Analytics/giờ làm trong checkout nguồn.
- Chỉ CI chạy trên push. Publish image/deploy phải được kích hoạt chủ động.
