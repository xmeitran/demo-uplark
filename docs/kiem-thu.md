# Kiểm thử và điều kiện nghiệm thu

## Kiểm tra source

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm audit:security
pnpm test:dependency-security
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm test:project-assignment-membership
pnpm test:lark-directory-sync
```

`typecheck` trong Turborepo phụ thuộc build; vì vậy lần đầu có thể lâu. `lint` hiện chỉ chạy TypeScript, không phải bộ quy tắc ESLint. Một số package chia sẻ chưa có suite riêng; không quy đổi “command thành công” thành độ phủ 100%.

## Tích hợp

`pnpm test:integration` cần PostgreSQL/Redis kiểm thử riêng. Test có thể tạo, cập nhật và dọn dữ liệu fixture. Không dùng connection string từ production hoặc từ tunnel vận hành.

CI `ci.yml` tạo PostgreSQL/Redis service containers, chạy migration, xác minh bảng, seed nền, unit/integration, build và authenticated BFF smoke. Đây là bằng chứng trong môi trường CI, không thay thế UAT với tenant Lark thực.

## Trình duyệt

```bash
pnpm exec playwright install chromium
pnpm test:e2e:route-smoke
```

Route smoke có API mock cho các tương tác phù hợp; kết quả pass không chứng minh database hoặc Lark SSO thật hoạt động. `test:e2e:public-auth:local-demo` là luồng khác, cần database cô lập đã chuẩn bị và tự khởi động API.

Không dùng token/session production làm fixture. Kiểm tra diff sau E2E vì Next có thể sinh lại các file khai báo/config.

## Dependency và CI

`pnpm audit:security` kiểm tra cả graph đầy đủ và `--prod`, chặn từ mức vừa trở lên; Product CI chạy chốt này trên mỗi push `main` và pull request. `pnpm audit:high` vẫn giữ để tương thích lệnh cũ, nhưng không thay thế chốt CI mới. Nếu không thể truy vấn registry, lệnh phải thất bại; không bật `--ignore-registry-errors`, không bỏ qua advisory và không coi là không có lỗ hổng. Không tự chạy `audit fix --force` hay nâng phiên bản hàng loạt để làm xanh báo cáo.

`pnpm test:dependency-security` kiểm tra package được resolve qua chính consumer thực (Prisma, PostCSS, Autoprefixer, Express). Các ca có thể treo chạy trong tiến trình con có timeout và giới hạn bộ nhớ. Bộ này bao gồm cấu hình Prisma mặc định/TypeScript/CommonJS, lỗi cấu hình, input lỗi thư viện và control hợp lệ; không truy cập database hoặc tenant Lark. Xem [báo cáo khắc phục dependency](bao-mat-dependency.md).

CI nguồn chỉ có quyền đọc repository. Publish image có quyền ghi package nhưng phải chạy thủ công. Workflow deploy đòi `VPS_RUNTIME_DIR` cấu hình tường minh và các secret riêng; không được chạy để kiểm thử việc nhập source.

## Evidence và giới hạn

Xem [báo cáo theo ngày](kiem-tra-source.md). Trước mỗi release cần bằng chứng mới: typecheck/unit/build, integration biên workspace, E2E luồng chính, kiểm tra migration/backup/rollback, cấu hình secret và UAT. Không dùng kết quả của release cũ làm chứng nhận cho thay đổi mới.
