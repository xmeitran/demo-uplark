# Quét cảnh báo đầu ngày (mục 7.5) và tham số (mục 7.6)

## Lượt quét làm gì

`POST /api/internal/alert-scan` (header `x-alert-scan-token`) chạy cho mọi workspace đang hoạt động:

1. Đọc tham số 7.6 của workspace (`SystemParameter`, mặc định theo tài liệu) và danh mục điểm kích hoạt (bật/tắt, tầng thông báo).
2. Với mọi dự án chưa đóng, tính các điểm kích hoạt theo thời gian: NL-03, NL-04, NL-05, TD-01, TD-02, TD-03, TD-06, BRI-04, DL-01; gọi lại quy tắc sổ vấn đề cho BRI-02 và YC-01.
3. Đối chiếu với bản ghi `ProjectWarning`: mở mới hoặc làm mới theo `dedupeKey`, đóng khi điều kiện kết thúc của danh mục đã thỏa. Chạy lại bao nhiêu lần cũng không sinh bản ghi trùng.
4. Gửi thông báo (V-37): mỗi cảnh báo gửi một lần; gửi lại khi mức tăng hoặc quá hạn; báo đóng một lần. Các cảnh báo cùng nhóm trong một lượt gộp thành một tin cho mỗi người nhận.

Ngày nghỉ cuối tuần và ngày nghỉ của workspace thì bỏ qua, trừ khi gọi kèm `?force=1`. Admin chạy tay bằng nút "Quét ngay" ở Admin › Cảnh báo (`POST /api/admin/alert-scan`).

Mã nguồn: `apps/api/src/modules/alerts/` (`alert-evaluators.ts` là phần tính thuần, `alert-scan.ts` là đối chiếu và gửi tin).

## Lên lịch

| Môi trường | Cách chạy |
|---|---|
| VPS (`ops/vps/docker-compose.app.yml`, có worker) | Đặt trong file env dùng chung: `ALERT_SCAN_TOKEN=<chuỗi bí mật>`, `ALERT_SCAN_ENABLED=true`, `ALERT_SCAN_API_URL=http://api:<API_PORT>`, tùy chọn `ALERT_SCAN_TIME=07:30` (giờ Việt Nam). Worker gọi API mỗi ngày một lần từ mốc giờ đó (khóa Redis `alert-scan:<ngày>`), lỗi thì thử lại ở lượt kiểm tra kế tiếp. |
| Render (`render.yaml`, không có worker) | Đặt `ALERT_SCAN_TOKEN` cho service `demo-uplark-api`, rồi dùng một cron bên ngoài (Render Cron Job, GitHub Actions schedule, cron của máy chủ khác) chạy: `ALERT_SCAN_API_URL=https://demo-uplark-api.onrender.com ALERT_SCAN_TOKEN=... node scripts/operations/run-alert-scan.mjs` lúc 07:30 các ngày. |

Không đặt `ALERT_SCAN_TOKEN` thì endpoint từ chối mọi lời gọi; chỉ còn nút "Quét ngay" của Admin.

## Kênh Lark

Tin trong ứng dụng luôn được tạo (chuông thông báo). Lark đi qua một hàm duy nhất `deliverLarkAlert()`:

- Có `LARK_PROJECT_ALERT_WEBHOOK_URL` (custom-bot webhook của nhóm Quản lý dự án, tùy chọn `LARK_PROJECT_ALERT_WEBHOOK_SECRET`): gửi một thẻ cho mỗi nhóm cảnh báo trong lượt quét.
- Không có: không gửi, lịch sử cảnh báo ghi "chưa cấu hình kênh Lark".

Chưa làm: bot riêng cho từng luồng, tạo nhóm chat theo dự án, tin riêng qua Lark.

## Tầng thông báo (điểm chốt 16)

Mỗi điểm kích hoạt có trường `tier`: `push_now` (đẩy ngay, mặc định cho tất cả, đúng hành vi gốc của tài liệu), `daily_digest` (gộp mọi nhóm thành một bản tin cho mỗi người trong lượt quét), `screen_only` (chỉ hiện trên màn hình). Admin đổi ở Admin › Tham số › Danh mục điểm kích hoạt.

## Điểm kích hoạt chưa bật

| Mã | Lý do |
|---|---|
| TD-04 | Chưa có ngày bắt đầu/đóng của stage và thời gian chờ khách để tính SLA |
| TD-05 | Chưa có bản ghi gia hạn stage |
| BRI-05 | Chưa lưu thời điểm gửi hồ sơ cho khách tại điểm chốt |

Hàm tính của ba mã này đã có trong `alert-evaluators.ts` (`evaluateStageSla`, `evaluateStageExtensions`, `evaluateCustomerWait`) và có test; khi có dữ liệu nguồn thì thêm phần nạp dữ liệu trong `alert-scan.ts` và bỏ `disabledReason` trong `packages/contracts/src/system-parameters.ts`.
