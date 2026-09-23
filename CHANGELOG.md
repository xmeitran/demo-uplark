# Lịch sử thay đổi

## 2026-09-07 — Đồng bộ source mới nhất ngày 06/09

- Hợp nhất đầy đủ năm commit canonical tới `e94d7e8d1a0eab2e3b2bf2e327758e3de0fa0f64`, bảo toàn lịch sử của cả source gốc và repository tổ chức.
- Bổ sung Native Auth dạng mời tham gia, quản trị tài khoản/phiên/MFA, giữ Lark SSO và chốt origin tin cậy phía sau reverse proxy.
- Cập nhật các luồng CRM, Project/Milestone/Task, nhật ký làm việc, Timesheet beta, Analytics, responsive UI, tiền VNĐ và font Be Vietnam Pro.
- Bổ sung ba migration mới và bộ kiểm thử Auth/CRM/analytics tương ứng; giữ dependency đã vá, regression bảo mật và audit gate của repository tổ chức.
- Cập nhật README, mẫu môi trường và tài liệu cấu hình bằng tiếng Việt có dấu. Không nhập Suite Hub đang làm dở, 501 file evidence cục bộ hoặc 3 file ghi chép Lark/Fix Bug đã tracked ở canonical.
- Không publish image, không triển khai production, không đổi visibility private hoặc giấy phép MIT.

## 2026-09-03 — Khắc phục cảnh báo dependency và bổ sung chốt bảo mật

- Cập nhật có giới hạn: nanoid 3.3.18, browserslist 4.28.8, qs 6.16.0 và deepmerge-ts 8.0.2 riêng dưới `@prisma/config@6.19.3`.
- Giữ Prisma/client 6.19.3, không thay đổi schema, API hoặc logic nghiệp vụ; cập nhật dữ liệu hỗ trợ Browserslist theo dependency của bản mới.
- Bổ sung 12 bài kiểm thử bảo mật/tương thích và audit toàn bộ/production graph trên Product CI, không bỏ qua advisory hoặc lỗi registry.
- Bổ sung [báo cáo tiếng Việt](docs/bao-mat-dependency.md) với bằng chứng trước/sau, quyết định override và giới hạn kiểm chứng.
- Không triển khai production; giữ nguyên MIT và repository riêng tư.

## 2026-09-03 — Tiếp nhận source vào UpBase-DX/lark-partner-crm

- Tiếp nhận source đã commit tại `8e363484a32541131ac1ba642e8597bd4a1d0511`, bảo toàn lịch sử và MIT gốc.
- Bổ sung README và tài liệu tiếng Việt: cài đặt, cấu hình, kiến trúc, kiểm thử, triển khai, đóng góp, bảo mật, nguồn gốc và báo cáo kiểm tra.
- Bổ sung metadata repository/giấy phép trong package.json, giữ tên package hiện tại.
- Tách cấu hình database phát triển cô lập khỏi mẫu VPS kế thừa.
- Chuyển publish app images sang thủ công, chuẩn hóa GHCR thành chữ thường và yêu cầu runtime deploy tường minh.
- Không triển khai production, không thay visibility, không nhập database hoặc các phần chưa commit tại máy nguồn.

Các thay đổi nghiệp vụ trước lần tiếp nhận được giữ trong lịch sử Git; nội dung tiếng Anh của commit cũ không bị viết lại.
