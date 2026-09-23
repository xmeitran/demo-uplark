# Lark Partner CRM

Nền tảng CRM và quản lý vận hành B2B dành cho doanh nghiệp dịch vụ: quản lý khách hàng, dự án, công việc, lịch làm việc, nguồn lực, thời gian thực hiện và kiểm soát triển khai. Ứng dụng hỗ trợ Native Auth dạng mời tham gia, đăng nhập Lark và đồng bộ danh bạ qua lớp tích hợp độc lập.

Tên hiển thị trong ứng dụng là **UpLark Partner CRM**. Repository này tiếp nhận source của **B2B CRM SaaS**; giữ tên package `@b2b-crm/*` để không phá vỡ các import và hợp đồng hiện có. Đây không phải sản phẩm chính thức của Lark.

[Giấy phép MIT](LICENSE) · [Bắt đầu](docs/cai-dat.md) · [Kiến trúc](docs/kien-truc.md) · [Cấu hình](docs/cau-hinh.md) · [Triển khai](docs/trien-khai.md) · [Báo cáo kiểm tra](docs/kiem-tra-source.md)

## Trạng thái và phạm vi

Source canonical được đồng bộ tới revision `e94d7e8d1a0eab2e3b2bf2e327758e3de0fa0f64` ngày 06/09/2026 từ `khanguyen09/b2b-crm-saas`. Lịch sử phát triển và thông báo bản quyền gốc được bảo toàn. Xem [nguồn gốc và thành phần bên thứ ba](NOTICE.md).

Đưa source lên GitHub **không đồng nghĩa đã triển khai một hệ thống mới hoặc đã hoàn tất mọi tính năng**. Repository được giữ riêng tư; việc cấp phép MIT không tự thay đổi quyền truy cập GitHub.

| Nhóm | Trạng thái trong source |
| --- | --- |
| Dashboard, Projects, Calendar, Users, Clients, Settings | Tuyến giao diện được phép hiển thị trong production, yêu cầu phiên đăng nhập theo chính sách ứng dụng |
| Native Auth, Lark SSO, quản trị tài khoản và phiên | Có source API/web, schema, migration và kiểm thử; Native Auth không cho đăng ký công khai, cần cấu hình email/secret đúng môi trường |
| Chi tiết dự án/công việc, milestone/stage, sắp xếp, kế hoạch và nhật ký làm việc | Có source giao diện, API, schema và kiểm thử |
| Timesheet, Analytics, pipeline, đề xuất, tài chính, hỗ trợ và portal | Có source ở trạng thái beta hoặc theo feature gate; không quảng bá là bộ CRM/ERP hoàn chỉnh |
| Mail, chat, knowledge, invoices và các module chưa hỗ trợ | Bị vô hiệu hóa theo manifest tuyến hoặc cần cấu hình nhà cung cấp riêng |

Nguồn xác thực trạng thái tuyến: [production-route-readiness.ts](apps/web/src/lib/production-route-readiness.ts). Phân loại “hiển thị” là chính sách giao diện, không thay thế nghiệm thu nghiệp vụ, bảo mật hoặc tải thực tế.

## Công nghệ

| Thành phần | Công nghệ |
| --- | --- |
| Giao diện và BFF | Next.js 15, React 19, TypeScript, Tailwind CSS 4 |
| API | NestJS 11, Prisma 6 |
| Cơ sở dữ liệu / hàng đợi | PostgreSQL 16, Redis 7 |
| Monorepo | pnpm 10.12.4, Turborepo |
| Kiểm thử | Vitest, Playwright Chromium |
| Vận hành | Docker Compose, Nginx, GitHub Actions, GHCR |

Phiên bản chính xác nằm trong [pnpm-lock.yaml](pnpm-lock.yaml); không cài theo phiên bản mới nhất một cách tùy ý.

## Bắt đầu nhanh

Yêu cầu Node.js 22, pnpm 10.12.4 và Docker Compose nếu cần chạy database/Redis cục bộ.

```bash
git clone https://github.com/UpBase-DX/lark-partner-crm.git
cd lark-partner-crm
pnpm install --frozen-lockfile
pnpm db:generate
pnpm typecheck
pnpm test
pnpm build
```

Các lệnh trên xác minh source; chưa khởi tạo tài khoản, database hoặc SSO. Vì repository riêng tư, tài khoản GitHub cần được cấp quyền trước khi clone.

Để chạy ứng dụng đầy đủ, làm theo [hướng dẫn cài đặt](docs/cai-dat.md): dùng database riêng, áp dụng migration, nạp dữ liệu nền và chạy API/web. Không dùng database production để thử nghiệm.

## Cấu trúc repository

```text
apps/
  web/                  Giao diện Next.js và BFF
  api/                  API NestJS theo miền nghiệp vụ
  worker/               Worker Redis và đồng bộ danh bạ
packages/
  contracts/            Hợp đồng TypeScript dùng chung
  ui-tokens/            Token giao diện dùng chung
prisma/
  migrations/           Lịch sử migration PostgreSQL
  schema.prisma         Mô hình dữ liệu
  seed-foundation.ts    Dữ liệu nền, không phải khách hàng mẫu
  seed.ts               Dữ liệu demo, không dùng cho production
ops/
  local/                Database/Redis phát triển cô lập
  vps/                  Mẫu vận hành VPS kế thừa
  nginx/                Mẫu reverse proxy kế thừa
scripts/operations/     Công cụ kiểm tra, đồng bộ và triển khai
docs/                   Tài liệu tiếng Việt và đặc tả liên quan
.github/workflows/      Kiểm thử, đóng gói và triển khai chủ động
```

## Lệnh thường dùng

| Lệnh | Mục đích |
| --- | --- |
| `pnpm dev:api` | Chạy API ở chế độ phát triển |
| `pnpm dev:frontend` | Chạy web trên cổng cô lập 3003; có thể dùng script cổng 3000/3002 khi cần |
| `pnpm dev:worker` | Chạy worker; đồng bộ danh bạ mặc định tắt |
| `pnpm db:generate` | Sinh Prisma client từ schema |
| `pnpm db:migrate` | Áp dụng migration vào `DATABASE_URL` đã chọn — có ghi dữ liệu |
| `pnpm db:seed:foundation` | Khởi tạo role/workspace/quản trị viên — có ghi dữ liệu |
| `pnpm typecheck`, `pnpm test`, `pnpm build` | Kiểm tra kiểu, unit test và build |
| `pnpm lint` | Kiểm tra kiểu TypeScript; hiện chưa có bộ ESLint độc lập |
| `pnpm test:integration` | Kiểm thử tích hợp, chỉ dùng database kiểm thử riêng |
| `pnpm test:e2e:route-smoke` | Kiểm thử tuyến bằng trình duyệt |
| `pnpm audit:security` | Chốt CI: audit toàn bộ và production graph, chặn từ mức vừa trở lên |
| `pnpm test:dependency-security` | Kiểm thử lỗi dependency và tương thích cấu hình Prisma |

## An toàn và vận hành

- Không commit `.env`, khóa Lark/SSH, session/token, backup, dữ liệu khách hàng, nhật ký thật hoặc kết quả kiểm thử chứa thông tin cá nhân.
- `.env.example` chỉ chứa giá trị mẫu. Mọi môi trường thực phải thay mật khẩu, domain, quản trị viên và secret riêng.
- Production phải tắt `CRM_DEMO_AUTH_ENABLED`, `CRM_ENABLE_DEMO_SESSION`, `CRM_ENABLE_DIRECT_LARK_SESSION` và `CRM_ALLOW_PRINCIPAL_FALLBACK`.
- Giữ ổn định `CRM_AUTH_ENCRYPTION_KEY`; không tái tạo khóa trong các lần cập nhật image thông thường.
- Không coi ẩn menu là kiểm soát quyền; API phải xác thực session và workspace.
- Không chạy `db:push` hoặc seed demo trên production.
- Việc push source chỉ chạy CI. Đóng gói image và triển khai đều cần kích hoạt thủ công; lần đồng bộ này không chuyển hệ thống đang chạy sang repository mới.

Chi tiết: [bảo mật](SECURITY.md), [cấu hình](docs/cau-hinh.md), [kiểm thử](docs/kiem-thu.md), [triển khai và rollback](docs/trien-khai.md).

## Đóng góp và giấy phép

Đọc [CONTRIBUTING.md](CONTRIBUTING.md) trước khi gửi thay đổi và [CHANGELOG.md](CHANGELOG.md) để xem thay đổi của bản tiếp nhận source.

Source thuộc phạm vi giấy phép được phân phối theo [MIT](LICENSE), giữ nguyên thông báo bản quyền `Copyright (c) 2026 khanguyen`. Văn bản MIT chuẩn bằng tiếng Anh là bản giấy phép; tài liệu tiếng Việt chỉ giải thích cách dùng. Dependency, logo, thương hiệu và tài nguyên bên ngoài có điều kiện riêng, xem [NOTICE.md](NOTICE.md) và [MIT của Open Source Initiative](https://opensource.org/license/mit).
