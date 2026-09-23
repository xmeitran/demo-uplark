# Báo cáo kiểm tra source — cập nhật 07/09/2026

## Kết luận

**Candidate đồng bộ dùng toàn bộ source đã commit mới nhất ngày 06/09, giữ repository riêng tư/MIT và chờ đủ kiểm thử trước khi push; đây không phải chứng nhận sẵn sàng triển khai production.**

Đích: `UpBase-DX/lark-partner-crm`. Source canonical: `khanguyen09/b2b-crm-saas` tại `e94d7e8d1a0eab2e3b2bf2e327758e3de0fa0f64`. Baseline tổ chức: `bdb72aee15d0f97749caceee5a884baa39388d59`. Candidate được tạo bằng merge có lịch sử trong worktree cô lập; không gộp source của ứng dụng donor cũ thành một ứng dụng khác.

## Nguồn đã đối chiếu

| Bản nguồn | Kết quả |
| --- | --- |
| Checkout canonical `b2b-crm-saas` | Tracked sạch tại `e94d7e8`; 501 file evidence chưa tracked và 3 file ghi chép Lark/Fix Bug đã tracked được loại khỏi snapshot tổ chức |
| Bản recovery | HEAD `0125a7f`, sạch nhưng sau canonical 11 commit; không dùng làm nguồn |
| Repository tổ chức | `origin/main=bdb72ae`; checkout thường có 60 file tracked sửa và 4 file Suite Hub chưa tracked, được giữ nguyên và không dùng làm candidate |
| Candidate cô lập | Merge `upstream/main=e94d7e8` vào baseline tổ chức; chỉ bốn file cấu hình/tài liệu/lockfile cần giải quyết xung đột |

“Toàn bộ source” là toàn bộ cây **ứng dụng** đã commit của `e94d7e8`, cộng tài liệu/cấu hình xuất bản của repository tổ chức; không phải gom mọi file trên máy. Timesheet/Analytics đã commit trong canonical được nhập, nhưng vẫn giữ trạng thái beta/feature gate. Suite Hub local, 501 file chưa tracked và 3 ghi chép vận hành Lark/Fix Bug đã tracked không thuộc snapshot.

## Nội dung source mới ngày 06/09

- Native Auth dạng mời tham gia, password/MFA/action token, quản lý phiên và tài khoản; giữ Lark SSO.
- Chốt origin/callback tin cậy phía sau reverse proxy và fixture auth loopback cho CI.
- Sửa các luồng tạo dự án, thành viên/PIC, milestone, phân công task và ghi thời gian.
- Bổ sung Timesheet beta, Workforce Analytics/export, tiền VNĐ, responsive UI và Be Vietnam Pro.
- Bổ sung migration resource capacity workspace scope, project create receipt và native auth lifecycle.
- Giữ dependency-security regression/audit của repository tổ chức ở phiên bản đã vá mới hơn canonical.

## Phạm vi và bảo toàn

- Candidate trước merge commit có **504 file tracked** và bảo toàn **108 commit tổ tiên** từ hai nhánh; merge commit sẽ là commit thứ 109 trong lịch sử hợp nhất. Thống kê 417 file/100 commit/1.071 blob là bằng chứng của lần tiếp nhận ban đầu ngày 03/09, không phải snapshot hiện tại.
- Bảo toàn lịch sử Git và MIT gốc; không force-push, sửa tác giả hoặc viết lại commit cũ.
- Không nhập file môi trường thật, database/backup, file khách hàng hoặc product-memory nội bộ.
- Không triển khai VPS, không sửa hạ tầng/secret, không đổi visibility và không gọi tài nguyên Lark.

## Kiểm tra rò rỉ và giấy phép

Quét cây tracked/lịch sử bằng Git object inventory, mẫu private key/provider token/JWT, secret assignment và kiểm tra tay các hit. Không phát hiện credential literal theo các mẫu này. Các hit assignment được phân loại là placeholder, credential CI cô lập, fixture hoặc đọc biến môi trường.

Đây là **quét heuristic, không bảo đảm tuyệt đối**; gitleaks/trufflehog không có sẵn trong môi trường kiểm tra. Email tổ chức, tên fixture và domain cũ vẫn có trong source/lịch sử. Chúng không được dùng như cấu hình thật và phải được rà soát riêng trước khi chuyển repository công khai.

MIT giữ nguyên `Copyright (c) 2026 khanguyen`. Logo, thương hiệu và tài sản CDN không tự động được cấp lại MIT; xem [NOTICE](../NOTICE.md). Văn bản giấy phép đối chiếu [Open Source Initiative](https://opensource.org/license/mit).

## Evidence thực thi

### Lượt đồng bộ 07/09/2026

| Kiểm tra | Kết quả candidate |
| --- | --- |
| Node/pnpm và frozen lockfile | **Đạt** trên Node 22.23.2, pnpm 10.12.4; gói Node tải từ nodejs.org được đối chiếu SHA-256 |
| Prisma generate / validate | **Đạt**; validate dùng URL PostgreSQL mẫu, không kết nối hoặc ghi database |
| Typecheck / lint / build | **Đạt** toàn bộ workspace; Next.js production build thành công |
| Unit test API / web / worker | **221 + 163 + 6 = 390 đạt** |
| Kiểm thử script vận hành | **25 đạt** |
| Dependency audit / regression | **0 advisory** ở graph đầy đủ và production; **12/12** regression đạt |
| E2E route smoke Chromium | Lượt xác nhận cuối **52/52 đạt**; một lượt trước có 1 lỗi scroll-harness, ca đó đạt **3/3** khi lặp riêng |
| Diff source nghiệp vụ với canonical | **0 file khác** trong `apps/`, `packages/`, `prisma/`; khác biệt chỉ là tài liệu/metadata/workflow an toàn, dependency patch và việc loại ghi chép vận hành |
| Secret/path scan | Không thấy private key, GitHub token hoặc file env/backup/database thật trong staged candidate; `.env.example` chỉ có placeholder |
| Workflow YAML | **7/7** parse hợp lệ; publish image và deploy chỉ cho phép `workflow_dispatch` |
| PostgreSQL/Redis integration | Không chạy cục bộ trong candidate; phải dùng CI cô lập đúng merge SHA trước khi kết luận hoàn tất |

E2E có thể sinh lại `apps/web/next-env.d.ts` và sắp xếp `apps/web/tsconfig.json`; output đó đã được loại khỏi candidate, sau kiểm tra `git diff` không staged là rỗng. Publish image và mọi deploy workflow vẫn chỉ có `workflow_dispatch`.

### Lượt tiếp nhận 03/09/2026 — bằng chứng lịch sử

| Kiểm tra | Kết quả |
| --- | --- |
| Cài dependency từ frozen lockfile | Đã thực hiện trong checkout riêng, không dùng .env production |
| Prisma generate / validate | Đạt |
| Typecheck / build / lint | **Đạt trên Node 22.23.2**: core 15/15 task không dùng cache, lint riêng 7/7 |
| Unit test API / web / worker | **165 + 106 + 6 = 277 đạt** |
| Kiểm thử script vận hành thuần | **25 đạt** |
| E2E route smoke Chromium | **52/52 đạt**, dùng backend mock/dummy loopback |
| PostgreSQL/Redis integration tại máy | Chưa chạy: Docker daemon không sẵn sàng |
| Docker Compose cục bộ | **Đạt** kiểm tra config; không khởi động dịch vụ |
| Sáu workflow YAML | **Đạt** parse cú pháp tại lần tiếp nhận ban đầu; publish/deploy chỉ thủ công |
| Nạp .env.example bằng Bash/zsh | **Đạt** trong môi trường sạch; giá trị có khoảng trắng được đặt trong dấu ngoặc kép |
| GitHub CI sau push | Theo dõi kết quả gắn đúng commit tại [GitHub Actions](https://github.com/UpBase-DX/lark-partner-crm/actions); không dùng kết quả local thay cho trạng thái CI |

Lượt kiểm tra đầu dùng Node 23 của host; lượt xác nhận Node 22 dùng binary chính thức 22.23.2 trong thư mục tạm, kiểm checksum theo nguồn Node.js, không đổi runtime toàn máy. Các bước lint/build cần chạy theo thứ tự để tránh Next xóa/sinh lại type khi TypeScript đang đọc.

E2E đã chứng minh assertion giao diện và xử lý từ chối truy cập; có log kết nối thất bại tới API dummy khi fetch không được mock. Không suy diễn thành “không có lỗi console/server”, integration database thật hoặc SSO Lark thật đã pass.

## Dependency audit — kết quả lịch sử trước khắc phục

Audit ngày kiểm tra báo **4 advisory mức cao, 2 mức vừa**, không có critical theo kết quả trả về. Production dependency graph cũng có **2 mức cao + 2 mức vừa**; không thể gọi toàn bộ vấn đề là “chỉ dev tooling”.

| Dependency trong lockfile | Mức | Bản sửa được advisory công bố | Nguồn |
| --- | --- | --- | --- |
| nanoid 3.3.16 | Cao | 3.3.18 | [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) |
| deepmerge-ts 7.1.5 | Cao | 8.0.0 | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) |
| browserslist 4.28.4 | Hai mức cao | 4.28.7 | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) |
| qs 6.15.3 | Hai mức vừa | 6.16.0 | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) |

Chưa chứng minh đường khai thác từ ứng dụng đối với từng advisory. Lần tiếp nhận giữ lockfile upstream để bảo toàn snapshot, chưa có audit gate. Sau đó đã thực hiện đợt khắc phục riêng ngày 03/09/2026: bốn package được cập nhật có kiểm thử tương thích, audit đầy đủ/production không còn cảnh báo đã biết và Product CI có audit gate. Xem [phiên bản, lý do và evidence mới](bao-mat-dependency.md); bảng trên là lịch sử, không phải trạng thái lockfile hiện hành.

## Thay đổi phục vụ xuất bản

- README/tài liệu tiếng Việt có dấu; metadata repository/license.
- Mẫu môi trường dùng localhost và identity giả, Docker Compose dev riêng.
- Publish image chuyển thủ công; GHCR namespace được chuyển chữ thường.
- Deploy yêu cầu `VPS_RUNTIME_DIR` tường minh, không tự chọn runtime cũ.
- Docker build context loại thêm tmp và output Playwright; Product CI có thêm test script vận hành.

## Các bước còn lại trước production/public

1. Chạy lại audit và toàn bộ gate theo lockfile của release, kể cả sau đợt khắc phục dependency đã ghi nhận.
2. Xác minh integration/SSO/role matrix và các feature beta bằng môi trường được phép.
3. Rà fixture/history và quyền đối với logo/CDN trước khi đổi PUBLIC.
4. Cấu hình lại VPS/domain/host key/role DB/secret, backup và rollback; không chạy mẫu kế thừa nguyên trạng.

## Tham khảo Lark

`lark-cli --version` trả **1.0.69**. Đã tham khảo lark-skills/lark-shared và tài liệu domain để viết cấu hình. Profile/identity: N/A; doctor/auth verification/scope/live operation: không chạy vì không thao tác tài nguyên Lark. Việc này không xác nhận tenant/app thật đã kết nối thành công.
