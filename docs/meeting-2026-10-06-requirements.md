# Yêu cầu cập nhật sau buổi demo UpLark CRM — 06/10/2026

## 1. Phạm vi và kết luận chính

Biên bản buổi demo ngày 06/10/2026 chốt bốn vùng: Project Sheet, Timesheet, P&L/Hồ sơ nhân sự và Admin notification. Các phần đã demo mà không có góp ý được giữ nguyên. Tài liệu này tách:

- **Đã chốt nghiệp vụ:** cần dùng làm acceptance criteria.
- **Cần sửa:** có thể đưa vào backlog build.
- **Phụ thuộc/chưa chốt:** chưa được triển khai khi thiếu đầu vào.
- **Cần regression:** không coi trạng thái trong biên bản là bằng chứng runtime.

Nguồn: nội dung buổi họp do người dùng cung cấp, ngày 06/10/2026.

## 2. Quy tắc nghiệp vụ đã chốt

### Project và template

1. Giữ các phần đã build ở Project và Project Detail: filter Status/Client/PIC, list có progress, Project Sheet breakdown theo Milestone, Issue/Blocker có mô tả, risk, owner, phương án xử lý và hạn xử lý.
2. Milestone mở tuần tự. Milestone sau chỉ mở khi milestone trước đạt điểm chốt, gồm task cuối cùng và tài liệu bắt buộc nếu có.
3. Template tạo đúng ba lớp: `Milestone → Stage → Task chính`. Không tạo Subtask trong template; người dùng tự thêm Subtask khi thực thi.
4. Danh mục chuẩn Milestone/Stage/Task phải được team dự án đồng thuận trước khi nạp vào hệ thống.

### Timesheet

1. Giữ view theo nhân sự, dự án và Calendar; giữ filter kỳ báo cáo, phòng ban, nhân sự và nhóm công việc.
2. Ngày nghỉ/ngày lễ cấu hình trong Admin và không cho log work vào ngày bị khóa.
3. Từ tháng 10/2026, kế hoạch tối đa 8 giờ/ngày. Không triển khai OT ở phase này vì chưa kết nối HRM.
4. File Excel export phải có format được chốt một lần, tách sheet theo nhu cầu sử dụng và bỏ các cột ID không cần thiết.
5. Giảm các dashboard/metric không cần thiết trong Timesheet; ưu tiên bảng dữ liệu và thao tác chính.

### P&L và Hồ sơ nhân sự

1. P&L project tính theo toàn bộ thời gian triển khai: ngày bắt đầu đến ngày kết thúc theo kế hoạch/milestone; không bị giới hạn bởi tháng log task.
2. Filter P&L project dùng ngày bắt đầu và ngày kết thúc của project.
3. P&L project chỉ giữ ba lớp hiển thị:
   - Tổng giờ kế hoạch, tổng giờ thực hiện, revenue, chi phí.
   - Danh sách nhân sự tham gia với planned hours và logged hours.
   - Chi tiết log work theo từng ngày trong toàn bộ thời gian project.
4. P&L tổng hỗ trợ kỳ năm, H1, quý và tháng; chỉ tính project đã nghiệm thu và có ngày bắt đầu nằm trong kỳ lọc. Kỳ dài 6–12 tháng phải được hỗ trợ.
5. Phase 1 cho phép nhập chi phí bên ngoài/thủ công để P&L chạy được. Tích hợp lương/HRM/kế toán là hướng dài hạn.
6. Hồ sơ nhân sự hiện giữ Role/Level; Cost Rate bổ sung sau khi chốt NC2.

### Lark notification và automation

1. Lark là kênh nhận cảnh báo; thao tác chính vẫn ở PM.
2. Giữ ba mốc nhắc:
   - Đầu ngày: thiếu task hoặc thiếu log của hôm trước.
   - 14:00: PM/leader nhận danh sách người chưa log và có action gửi nhắc lại.
   - 17:00: nhắc cập nhật Actual và kiểm tra task/log trong ngày.
3. Chỉ thêm khoảng 1–2 automation về tiến độ để tránh spam. Recipient, điều kiện và tần suất phải được chốt trước khi bật production.

## 3. Backlog cần sửa

| ID | Phạm vi | Yêu cầu | Phụ thuộc | Acceptance chính |
|---|---|---|---|---|
| CS1 | Timesheet export | Tách nhiều sheet, bỏ ID, sửa theo comment format của anh Hải | Comment Excel | Export mở được, mỗi sheet đúng mục đích, không phải tách tay |
| CS2 | Timesheet | Giới hạn kế hoạch tối đa 8 giờ/ngày từ tháng 10 | Không | Không tạo/cập nhật được plan vượt 8h/ngày; dữ liệu tháng 9 cũ giữ nguyên |
| CS3 | Project template | Tạo đến Task chính theo danh mục chuẩn | Team đồng thuận catalog | Tạo project sinh đủ Milestone → Stage → Task, không tự sinh Subtask |
| CS4 | P&L project | Tổng hợp toàn bộ thời gian project, đổi filter sang start/end date | Không | Project có log ngoài tháng hiện tại vẫn được tính đúng trong phạm vi project |
| CS5 | P&L project | Rebuild layout theo TN9 và hiển thị revenue/cost | Không | Có đủ 3 lớp dữ liệu; revenue/cost khớp nguồn |
| CS6 | P&L tổng | Chuẩn hóa tổng, thêm filter năm/H1/quý/tháng, chỉ project nghiệm thu bắt đầu trong kỳ | Cần chốt eligibility/status | Tổng chỉ gồm project đủ điều kiện và reconcile với project detail |
| CS7 | P&L cost | Nhập cost rate tháng và tự tính chi phí nhân sự | NC2 | Rate có effective month; cost xuất hiện đúng P&L và không join bằng tên |
| CS8 | Admin P&L config | Chỉ giữ chi phí khác; bỏ salary/transport nếu lương thưởng nằm ở HR | NC2 | Schema UI/API khớp nguồn chi phí đã chốt, không có field gây nhập trùng |

## 4. Nghiên cứu bắt buộc trước khi sửa

### NC1 — AI import Excel/ảnh → project template

- Đánh giá effort, độ tin cậy và chi phí vận hành.
- Đầu vào có thể là Excel hoặc ảnh; output dự kiến gồm Milestone, Stage/Task, ngày, PIC.
- Đối tượng dùng: Admin tạo template nhanh hoặc end user tạo project khi không có template phù hợp.
- Phải có preview/edit/confirm trước khi tạo dữ liệu thật.
- Phase 1 chỉ làm nếu effort/pilot chấp nhận được; nếu không, đưa sang phase sau.
- Hạn phản hồi: hết ngày 07/10/2026.

### NC2 — Nguồn và vị trí nhập chi phí

Chọn một trong hai phương án sau trước CS7/CS8:

- **PA1:** nhập lương/thưởng/cost rate theo tháng ở Hồ sơ nhân sự; chi phí khác ở Admin.
- **PA2:** để sẵn boundary cho HRM/payroll; phase hiện tại nhập tất cả chi phí ở Admin.

Tiêu chí chọn: không phải migration lại khi kết nối payroll/HRM/kế toán; có effective date, lịch sử, RBAC/masking và audit.

### NC3 — Automation tiến độ

Chốt tối đa 1–2 automation ngoài ba mốc Timesheet hiện có:

- Quy tắc task/milestone/project chậm.
- Recipient: PM, leader, owner hay nhóm nào.
- Tần suất: theo ngày, milestone hoặc tuần.
- Có gửi owner khi Issue/Blocker mới hay không.
- Có link vào đúng project/task/issue và có dedupe để không spam.

## 5. Thứ tự triển khai đề xuất

1. **P0 — chốt đầu vào:** nhận catalog Milestone → Stage → Task; chốt format Excel export; quyết định NC2.
2. **P1 — dữ liệu nền:** CS2 giới hạn 8h/ngày; CS3 template sinh Task; chuẩn hóa P&L source/eligibility/currency.
3. **P1 — P&L:** CS4 → CS5 → CS6, sau đó CS7 → CS8.
4. **P2 — notification:** hoàn thiện NC3, thêm automation tiến độ có rule và dedupe.
5. **P2 — AI import:** hoàn tất NC1 và chỉ đưa vào phase 1 khi có kết luận effort/quality rõ ràng.

## 6. Điểm cần xác minh trước khi tuyên bố hoàn thành

- Biên bản ghi một số đầu việc “Hoàn thành”, nhưng cần kiểm tra lại trên local và production bằng route, role và dataset thật.
- Không dùng tên người để join P&L/Timesheet; dùng stable user/project/task/log IDs.
- Không tự cap log work hoặc P&L theo 8h nếu chưa phân biệt rõ validation kế hoạch và chính sách OT/accounting.
- Xác định rõ `Project Status`, `Acceptance` và ngày bắt đầu nào là source of truth cho P&L tổng.
- Kiểm tra notification thật ở Lark; toast màu xanh trên Admin chỉ là xác nhận UI sau khi API trả thành công.
- Các thay đổi live về Milestone/Stage/Task, notification recipient hoặc cost data cần xác nhận đúng scope ngay trước mutation.

## 7. Format Excel Timesheet đã nhận

File tham chiếu: `Project_Management_Dashboard_v1.xlsx`.

### Thứ tự và mục đích các sheet

1. **Tổng quan**
   - Hai ô điều kiện: `Từ ngày`, `Đến ngày`.
   - Chỉ số: tổng giờ thực tế, tổng giờ Estimate, tổng số dự án, tổng số nhân sự, tổng số task.
2. **Theo dự án**
   - Tên dự án, mã dự án, client/account, trạng thái project.
   - Tổng giờ thực tế, giờ Estimate, số nhân sự, số task, tỷ lệ so với Estimate.
3. **Theo nhân sự**
   - Nhân sự, vai trò, phòng ban.
   - Tổng giờ, số dự án, số task, ngày làm việc đã log, trung bình giờ/ngày.
4. **Tiến độ theo Ngày**
   - Ngày, tổng số giờ, số nhân sự, số dự án, số task.
5. **Raw Data**
   - Một dòng cho một time entry.
   - Các cột chuẩn: `Ngày`, `User ID`, `Nhân sự`, `Phòng ban`, `Vai trò`, `Project ID`, `Mã dự án`, `Tên dự án`, `Khách hàng / tài khoản`, `Trạng thái dự án`, `Milestone`, `Giai đoạn`, `Task ID`, `Task`, `Trạng thái task`, `Nhóm công việc`, `Tính phí`, `Số phút`, `Số giờ`, `Giờ estimate task`, `Ghi chú`.

### Snapshot dữ liệu trong file mẫu

- Kỳ dữ liệu: 03/09/2026–30/09/2026.
- 201 dòng Raw Data.
- 15 project, 8 nhân sự.
- 738,5 giờ thực tế và 2.016 giờ Estimate ở tổng hợp theo project.
- 130 tên task nhưng 133 Task ID; một số tên task được dùng cho nhiều ID khác nhau. Khi build phải aggregate/join bằng ID, không dùng tên task làm khóa.
- Workbook mẫu là snapshot tĩnh, không có công thức và không có native Excel Table/AutoFilter. Bản export mới nên thêm filter, freeze header và định dạng ngày/số nhưng không được đổi tên sheet/cột đã chốt.

### Mapping sang app

- `Raw Data` lấy từ time entry live, join project/person/task bằng stable ID.
- `Theo dự án` phải lấy đủ project trong phạm vi lọc, kể cả project chưa có log nếu nghiệp vụ yêu cầu hiển thị Estimate/0 actual.
- `Theo nhân sự` lấy theo user ID, không join bằng display name.
- `Tiến độ theo Ngày` aggregate từ Raw Data sau khi áp dụng date range và day-off rule.
- `Tổng quan` phải reconcile với ba sheet tổng hợp và Raw Data; không tạo KPI riêng không truy được về dữ liệu nguồn.

### Quy ước nguồn dữ liệu cho chart

Mỗi chart/khối tổng hợp trong dashboard phải có một sheet dữ liệu riêng làm nguồn. Không dồn toàn bộ dataset vào một sheet rồi để người dùng tự tách thủ công.

- Chart tổng quan: dùng sheet `Tổng quan`.
- Chart theo project: dùng sheet `Theo dự án`.
- Chart theo nhân sự: dùng sheet `Theo nhân sự`.
- Chart theo ngày: dùng sheet `Tiến độ theo Ngày`.
- Drill-down và kiểm tra chi tiết: dùng sheet `Raw Data`.

File mẫu hiện chưa chứa đối tượng chart native; năm sheet hiện tại là các bảng dữ liệu nguồn cho những chart/khối tương ứng. Khi triển khai export, giữ đúng mô hình này và nếu thêm chart thì thêm sheet data riêng, không thay thế bằng một bảng trung gian dùng chung.

## 8. Definition of Done cho nhóm thay đổi này

- API, schema và UI cùng dùng một contract; có migration/backward compatibility nếu cần.
- Có test cho rule 8h/ngày, template hierarchy, P&L date range/eligibility/cost và notification dedupe.
- Có runtime verification trên local; production chỉ kết luận sau khi kiểm tra đúng revision và dữ liệu.
- P&L reconcile: `P&L hours + pending/excluded hours = Logwork hours`, không duplicate Log ID.
- Có audit/reason cho cost adjustment, milestone gate và thay đổi automation.
