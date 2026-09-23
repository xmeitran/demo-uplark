# Hướng dẫn đóng góp

Cảm ơn bạn tham gia phát triển Lark Partner CRM.

## Trước khi sửa

Đọc [README](README.md), [kiến trúc](docs/kien-truc.md), [trạng thái source](docs/kiem-tra-source.md). Tạo nhánh riêng từ main; ghi rõ mục tiêu, use case, tiêu chí chấp nhận và phần không làm. Không gộp thay đổi đang làm dở của người khác.

## Quy ước

- Dùng TypeScript, giữ package scope `@b2b-crm/*` và module nghiệp vụ hiện có.
- Tài liệu và mô tả thay đổi viết tiếng Việt có dấu, tên API/identifier giữ nhất quán.
- Không hard-code secret, dữ liệu khách hàng, email/ID thật vào fixture mới; dùng `example.com` và định danh giả.
- Không bỏ kiểm tra quyền/workspace hoặc cờ chặn beta để làm test pass.
- Thay đổi schema phải có migration được review và kế hoạch tương thích.
- Không chỉnh dependency/lockfile ngoài phạm vi; cài bằng frozen lockfile trước.
- Không đưa build/cache/backup, ảnh chụp dữ liệu thật hay log nhạy cảm vào commit.

## Kiểm tra trước pull request

Chạy các lệnh trong [kiểm thử](docs/kiem-thu.md). Mô tả test đã chạy và test chưa chạy, ảnh hưởng dữ liệu/API/quyền, rollout/rollback nếu cần. Kiểm tra diff, danh sách staged files và lỗi khoảng trắng.

Commit nên ngắn gọn, ví dụ `docs: bổ sung hướng dẫn cấu hình Lark` hoặc `fix: giữ đúng phạm vi workspace khi đọc dự án`. Không force-push nhánh dùng chung khi chưa thống nhất.

## Giấy phép

Phần đóng góp vào source thuộc phạm vi MIT được gửi theo [LICENSE](LICENSE). Không đóng góp mã/tài sản mà bạn không có quyền phân phối. Giữ thông báo bản quyền và ghi nguồn/licensing của dependency, logo hoặc nội dung bên thứ ba trong [NOTICE](NOTICE.md).
