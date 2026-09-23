# Cài đặt và chạy cục bộ

## 1. Chuẩn bị

- Node.js 22 và pnpm 10.12.4.
- Docker Engine/Desktop có Docker Compose v2 nếu chưa có PostgreSQL 16 và Redis 7 riêng cho phát triển.
- Quyền đọc repository riêng tư trên GitHub.
- Không sao chép file môi trường, backup hay thông tin đăng nhập của hệ thống thật.

Clone và kiểm tra source theo [README](../README.md). Các lệnh dưới chạy tại thư mục gốc repository, trên Bash/zsh.

## 2. Môi trường riêng

```bash
cp .env.example .env
```

Mở `.env`, đặt mật khẩu phát triển riêng cho PostgreSQL và Redis; cập nhật cùng giá trị trong các URL tương ứng. Không giữ chuỗi `change-me` khi chạy trên môi trường được chia sẻ.

File mẫu dùng web `http://localhost:3003`, API `http://127.0.0.1:4403`, PostgreSQL `127.0.0.1:55438`, Redis `127.0.0.1:56388`. Kiểm tra cổng trống trước khi dùng. Không trỏ đến database/VPS đang vận hành.

```bash
docker compose --env-file .env -f ops/local/docker-compose.yml -p lark-partner-crm-dev up -d
docker compose --env-file .env -f ops/local/docker-compose.yml -p lark-partner-crm-dev ps
```

Compose cục bộ không dùng container name/network cố định của bản VPS. Nếu cổng bận, đổi port và URL trong `.env` đồng bộ; không dừng dịch vụ khác để chiếm cổng.

## 3. Khởi tạo database phát triển

NestJS và các script vận hành không tự nạp mọi biến từ `.env`. Trong mỗi terminal chạy app/script, nạp file do chính bạn cấu hình:

```bash
set -a
source .env
set +a
pnpm db:generate
pnpm db:migrate
pnpm db:verify-critical-tables
pnpm db:seed:foundation
pnpm db:verify-foundation
```

Migration và seed có ghi dữ liệu. `db:seed:foundation` tạo workspace, role, quyền và quản trị viên theo `FOUNDATION_*`; không tạo bộ khách hàng/dự án demo. Xác nhận lại hostname/database trước khi chạy.

`pnpm db:seed:demo` là một lựa chọn riêng cho dữ liệu giả trên database dùng một lần. Không chạy cùng database production; đừng bật `ALLOW_DEMO_SEED_IN_PRODUCTION`.

## 4. Chạy ứng dụng

Terminal API, sau khi nạp `.env`:

```bash
pnpm dev:api
```

Terminal web, sau khi nạp `.env`:

```bash
pnpm dev:frontend
```

Tùy chọn worker, ở terminal riêng đã nạp `.env`:

```bash
pnpm dev:worker
```

Mở [web cục bộ](http://localhost:3003). Kiểm tra [API health](http://127.0.0.1:4403/api/health) và [API readiness](http://127.0.0.1:4403/api/ready). Readiness thất bại nghĩa là dependency chưa sẵn sàng, không phải đã chạy đủ hệ thống.

## 5. Đăng nhập phát triển

Lark SSO cần app Lark, callback đúng domain, identity đã liên kết và role trong workspace; xem [cấu hình](cau-hinh.md).

Snapshot còn luồng đăng nhập demo chỉ dành cho phát triển. Màn hình login kế thừa nhận `khanhv@upbase.asia` / `local-dev` làm thao tác kích hoạt demo, không phải tài khoản/mật khẩu production. API thực tế chọn tài khoản nền theo `FOUNDATION_ADMIN_EMAIL` của môi trường (mẫu là `admin@example.com`). Đây là nợ kỹ thuật đã ghi nhận; không coi cơ chế này là xác thực email/password an toàn. Giữ môi trường dev trong máy riêng, không công khai qua tunnel.

Production phải dùng session phía máy chủ và tắt cả hai cờ demo; tuyệt đối không dùng dữ liệu thật để thử luồng này.

## 6. Dừng môi trường

```bash
docker compose --env-file .env -f ops/local/docker-compose.yml -p lark-partner-crm-dev stop
```

Lệnh này giữ volume để có thể khởi động lại. Không thêm tùy chọn xóa volume nếu chưa xác nhận dữ liệu có thể mất.

## Lỗi thường gặp

- Prisma không kết nối: kiểm tra port, password được URL-encode, database và trạng thái container.
- API báo thiếu biến môi trường: nạp `.env` vào đúng terminal trước khi chạy.
- Đăng nhập demo trả 404/403: kiểm tra môi trường; không bật demo trên production để “sửa” lỗi.
- Lark đăng nhập thành công nhưng không thấy dữ liệu: kiểm tra identity, tenant/workspace và RoleBinding, không cấp quyền quản trị hàng loạt.
- Port bị chiếm: chọn port riêng và sửa cả URL API/BFF/CORS.
- Build/types sau E2E bị nhiễu: Next có thể sinh lại `next-env.d.ts` và `tsconfig.json`; xem diff trước khi commit, không xóa thay đổi của người khác.
