# Khắc phục bảo mật dependency — 03/09/2026

## Kết quả và phạm vi

Baseline: `c65376b726a0839094f3e98958a86e86aec3946e`. Audit trước sửa có 4 advisory cao và 2 vừa; production graph có 2 cao và 2 vừa. Sau cập nhật, `pnpm audit:security` báo **không có lỗ hổng đã biết** cho cả hai graph tại thời điểm kiểm tra. Không dùng exception, bỏ qua advisory hoặc giảm ngưỡng audit.

Đây là khắc phục dependency trong source, không phải chứng nhận ứng dụng không còn lỗ hổng và không thay cho triển khai/UAT. Production, dữ liệu thật, Lark, MIT, visibility và các bản nháp chưa commit không bị thay đổi.

## Phiên bản và consumer

| Package | Trước → sau | Đường phụ thuộc và lý do |
| --- | --- | --- |
| nanoid | 3.3.16 → 3.3.18 | PostCSS; giữ dòng CommonJS 3.x, khắc phục vòng lặp size bằng 0. [Advisory](https://github.com/advisories/GHSA-2v37-7h3g-55p8) |
| browserslist | 4.28.4 → 4.28.8 | Autoprefixer; giới hạn cache và xử lý key thống kê đặc biệt. [Cache](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [thống kê](https://github.com/advisories/GHSA-73wf-gq98-2v4g) |
| qs | 6.15.3 → 6.16.0 | Express và body-parser qua Nest; sửa giới hạn mảng comma và round-trip `constructor.isBuffer`. [Giới hạn mảng](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [round-trip](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) |
| deepmerge-ts | 7.1.5 → 8.0.2 | Chỉ override dưới `@prisma/config@6.19.3`; xử lý đồ thị object vòng. [Advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) |

Các override cố định phiên bản trong `package.json`; lockfile ghi integrity. Browserslist kéo theo cập nhật dữ liệu browser/Node và công cụ cập nhật database; không cập nhật Next, React, Nest hoặc Prisma hàng loạt.

## Quyết định tương thích Prisma

Giữ `prisma` và `@prisma/client` tại 6.19.3. Tại thời điểm kiểm tra chưa có bản 6.x mới hơn trên registry sửa dependency này. Override đúng `@prisma/config@6.19.3>deepmerge-ts`, không thay mọi consumer của deepmerge.

Consumer đã kiểm tra chỉ dynamic-import `deepmerge` để truyền làm merger cho c12. Prisma tắt dotenv/rc/remote extension/package-json config tại loader; source CRM không gọi trực tiếp deepmerge. Bản 8 thay đổi deep Map merge, type API và hành vi `deepmergeInto`; các thay đổi đó không được consumer hiện tại sử dụng. Bản 8.0.2 giữ CJS/ESM và hỗ trợ Node từ 16.9, phù hợp Node 22. [Prisma loader](https://github.com/prisma/prisma/blob/6.19.3/packages/config/src/loadConfigFromFile.ts), [thay đổi major](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0), [Node minimum](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.2).

Đây là tổ hợp được dự án kiểm chứng, không phải tuyên bố Prisma upstream đã hỗ trợ override. Khi nâng Prisma hoặc thêm cấu hình experimental/extensions/Map, phải rà lại tương thích và cân nhắc bỏ override khi upstream đã sửa.

## Bằng chứng và giới hạn

- Trước thay dependency: 7 ca regression thất bại đúng triệu chứng của 6 advisory (deepmerge có hai API); 4 ca đọc cấu hình Prisma đạt.
- Sau thay dependency: **12/12 đạt**, gồm 7 ca regression trên cùng code kiểm thử và 5 ca Prisma mặc định/TS/CJS/thiếu file/key không hợp lệ. Fixture seed chỉ là chuỗi giả để kiểm tra readback, không được thực thi.
- Nanoid: yêu cầu sinh ID độ dài 0 kết thúc và ID bình thường đúng độ dài; deepmerge/Into không tràn stack, giữ self-reference và cấu hình nested/array/callback hợp lệ.
- Browserslist: 6 key giống prototype không làm lỗi query; sau 600 query khác nhau, entry cũ bị loại nhưng kết quả không đổi. Đây là phép kiểm tra eviction có giới hạn, không phải stress test bộ nhớ production.
- qs: key thường/bracket/percent-encoded đều tôn trọng giới hạn; hostile constructor round-trip không ném lỗi, query bình thường và Buffer vẫn hợp lệ.
- Node **22.23.2**, pnpm **10.12.4**: frozen install, Prisma generate và validate đạt; core typecheck/test/build không dùng cache **15/15**, lint riêng **7/7**, **277 unit + 25 operation + 52 Chromium E2E** đạt (E2E không retry, dùng backend mock).
- Kiểm tra registry lỗi bằng địa chỉ loopback không phục vụ: audit trả `ECONNREFUSED`, exit 1; không báo audit sạch. Tùy chọn retry truyền qua biến `npm_config_fetch_retries=0` chỉ cho phép thử, không thay cấu hình global.
- Database integration tại máy không chạy vì Docker daemon không sẵn sàng. Product CI có PostgreSQL/Redis cô lập, migration/integration/BFF smoke; xem kết quả đúng commit chứa bản vá ở [GitHub Actions](https://github.com/UpBase-DX/lark-partner-crm/actions), không lấy CI của baseline làm bằng chứng cho lockfile mới.

Test resolve thư viện từ consumer thật, không thêm dependency riêng đã vá chỉ để làm test xanh. Tiến trình con có timeout 10 giây và heap 128 MiB. Không gửi payload đến production.

**Chưa chứng minh đường khai thác từ request CRM**: PostCSS dùng nanoid với độ dài cố định; Browserslist dùng khi build; Prisma config không nhận object vòng từ JSON thông thường; Nest không bật comma parsing và source không gọi qs stringify trực tiếp. Tuy nhiên package có trong production graph/image, nên không gắn nhãn tất cả là dev-only và vẫn vá đầy đủ.

### Giới hạn mới phát hiện khi rà bản vá

Nanoid 3.3.18 vẫn treo khi **khởi tạo custom generator với default size bằng 0 rồi gọi lại với size dương**, ví dụ `customAlphabet('ab', 0)(1)`; `customRandom` có biến thể tương tự. Kiểm tra độc lập trong tiến trình con timeout 1 giây xác nhận điều này. Đây không phải ca yêu cầu output size 0 đã được vá và không nằm trong đường gọi CRM đã kiểm: PostCSS dùng `nanoid/non-secure.nanoid(6)`, không dùng custom generator. Registry hiện chưa có bản 3.x mới hơn.

Do đó kết luận chỉ là **sáu advisory của lockfile đã được cập nhật tới phiên bản được công bố là có bản vá**, không phải đã sửa mọi biến thể của Nanoid. Không thêm private fork hoặc đổi API không được dùng; ghi nhận để rà bản upstream tiếp theo. Không đưa custom generator với size không kiểm soát vào ứng dụng nếu chưa xử lý và kiểm thử biến thể này.

## Chốt CI và rollback

Product CI chạy `pnpm audit:security` (toàn bộ và `--prod`, ngưỡng moderate) cùng `pnpm test:dependency-security` trên push main/PR. Lỗi registry phải làm gate thất bại; không có `continue-on-error` hoặc ignore flags. Chốt này là bước trong CI, chưa tự tạo branch-protection rule hoặc lịch giám sát định kỳ.

Nếu phát hiện hồi quy, dùng commit đảo đúng thay đổi dependency và xác minh lại; không force-push, không sửa migration. Baseline còn advisory không được mặc nhiên coi là bản production an toàn. Deploy/image workflow tiếp tục chỉ chạy thủ công.
