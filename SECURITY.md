# Chính sách bảo mật

## Phạm vi hỗ trợ

Nhánh main là nguồn đang được duy trì trong repository này. Các module beta không có cam kết sẵn sàng production. Chưa có chương trình chứng nhận hoặc kiểm toán bảo mật toàn diện cho bản tiếp nhận.

## Báo cáo vấn đề

Nếu GitHub hiển thị tùy chọn báo cáo lỗ hổng riêng tư, dùng tùy chọn đó. Nếu chưa bật, liên hệ riêng maintainer qua kênh nội bộ của tổ chức để nhận kênh trao đổi an toàn. Không đăng public issue/comment chứa secret, token, dữ liệu khách hàng, log production hoặc hướng dẫn khai thác kèm dữ liệu thật.

Cung cấp revision, module/đường dẫn, điều kiện tái hiện bằng dữ liệu giả, tác động dự kiến và hướng xử lý nếu có. Không cần gửi credential thật để chứng minh lỗi.

## Quy tắc bắt buộc

- Secret để trong kho secret hoặc file môi trường không tracked.
- Luồng demo/dev không được coi là xác thực an toàn; production phải tắt cả hai cờ demo và principal fallback.
- Xác thực session, kiểm tra quyền, workspace và đối tượng ở phía máy chủ.
- Không đưa toàn bộ thông tin dependency/runtime vào endpoint công khai.
- File người dùng cần kiểm tra loại/kích thước, lưu bền vững và chỉ cấp download khi policy/scan cho phép.
- Database kiểm thử phải riêng; migration, seed và import là thao tác có ghi.
- Pin/verify dependency và công cụ vận hành; kiểm tra advisory trước release.
- Quét source/history không bảo đảm tuyệt đối không có secret hoặc lỗ hổng.

## Khi nghi lộ secret

Ngừng dùng và thu hồi/luân chuyển secret qua người có thẩm quyền, xác định nơi đã sao chép, đánh giá truy cập và xử lý lịch sử sau khi được phê duyệt. Chỉ xóa secret khỏi commit mới không loại bỏ nó khỏi lịch sử Git.
