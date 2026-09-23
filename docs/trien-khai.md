# Triển khai, CI/CD và rollback

## Phạm vi

Lần nhập source **không triển khai production**, không chuyển domain, không sửa dữ liệu Lark/PostgreSQL và không chuyển quyền sở hữu hệ thống đang chạy. Các mẫu VPS là công cụ kế thừa cần được điều chỉnh bởi người vận hành.

## Workflow

| Workflow | Kích hoạt | Tác dụng |
| --- | --- | --- |
| `ci.yml` | Push main, pull request | Migration/DB/API/unit/build/authenticated smoke trong CI |
| `frontend-ci.yml` | Push main, pull request | Kiểu/unit/build/route smoke |
| `app-images.yml` | Thủ công | Build và đẩy web/api/worker lên GHCR |
| `web-image.yml` | Thủ công | Build/đẩy riêng web |
| `deploy-vps-db.yml` | Thủ công | Khởi động PostgreSQL/Redis trên VPS mục tiêu |
| `deploy-vps-app.yml` | Thủ công | Kiểm tra gate, kéo đúng SHA image và khởi động app |

Tên GHCR luôn chuyển thành chữ thường: `ghcr.io/upbase-dx/lark-partner-crm/<service>`. Quyền đọc repository riêng tư không tự đảm bảo mọi người có quyền kéo package riêng tư.

## Điều kiện trước khi triển khai

1. Chọn rõ VPS/runtime/domain và người có quyền phê duyệt; không tái sử dụng runtime cũ chỉ vì tên giống nhau.
2. Thiết lập biến repository `VPS_RUNTIME_DIR` là đường dẫn tuyệt đối dành cho app này. Workflow dừng nếu thiếu biến, không fallback về máy/thư mục tác giả.
3. Thiết lập secret `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `GHCR_READ_USERNAME`, `GHCR_READ_TOKEN` trong kho secret; tuyệt đối không commit.
4. Rà và ghim SSH host key từ kênh tin cậy. Mẫu kế thừa còn dùng `ssh-keyscan` trong lần kết nối, chưa phải pin danh tính host ngoài băng.
5. Kiểm tra `ops/vps/`, `ops/nginx/` và script deploy; thay domain/cổng/container/network phù hợp để không va chạm dịch vụ khác.
6. Cấu hình HTTPS, CORS, cookie, callback Lark; tắt demo/fallback, dùng password/secret mạnh.
7. Tạo role PostgreSQL runtime tối thiểu riêng với role migration. Compose kế thừa có fallback tài khoản owner; không để fallback này trở thành cấu hình thực.
8. Chạy migration/seed nền có kiểm soát và xác minh backup có thể restore.
9. CI và frontend CI phải pass cho đúng SHA; chạy thủ công publish app images, kiểm tra cả ba image.
10. Chỉ sau phê duyệt vận hành mới chạy deploy đúng tag `sha-<40 ký tự>`. Không dùng `latest` để xác định release.

Các port PostgreSQL/Redis/API/web nên bind loopback, đi qua reverse proxy khi cần công khai. Kho tệp phải dùng volume bền vững có backup; không lưu file người dùng trong container tạm.

## Sau triển khai

Xác minh `/api/health`, `/api/ready`, login, các API không cookie trả lỗi xác thực, role/workspace đúng, upload/download và luồng dự án quan trọng. Kiểm tra revision của web/API/worker và log đã che dữ liệu nhạy cảm. Chỉ chủ tài khoản mới thực hiện UAT đăng nhập Lark.

## Rollback

Ghi lại SHA image cũ, checksum backup, migration đã chạy và vị trí kho tệp trước cutover. Rollback ứng dụng bằng image bất biến đã kiểm chứng; không tự đảo migration hoặc restore database thật khi chưa đánh giá mất dữ liệu/được phê duyệt.

Không kích hoạt bất kỳ workflow deploy nào chỉ để chứng minh source đã push thành công.
