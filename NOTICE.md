# Nguồn gốc, bản quyền và thành phần bên thứ ba

## Source ứng dụng

Bản tiếp nhận ban đầu dựa trên repository `khanguyen09/b2b-crm-saas`, SHA `8e363484a32541131ac1ba642e8597bd4a1d0511`; source canonical hiện được đồng bộ tới `e94d7e8d1a0eab2e3b2bf2e327758e3de0fa0f64`. Source đã tự xác định đây là sản phẩm B2B CRM SaaS độc lập; `lark-partner-crm-erp` là nguồn tham khảo lịch sử, không được nhập chồng thành ứng dụng thứ hai.

Giữ nguyên thông báo `Copyright (c) 2026 khanguyen` và văn bản [MIT](LICENSE). Repository đích thuộc tổ chức UpBase-DX không tự động thay đổi tác giả/bản quyền nguồn. Tên package được giữ để tương thích.

## Dependency

Dependency có giấy phép riêng. Manifest khai báo trực tiếp nằm tại package.json ở root, apps và packages; lockfile ghim phiên bản thực tế. Tài liệu này không thay thế license của từng dependency và không phải SBOM đã kiểm toán đầy đủ.

Các thư viện/framework chính gồm Next.js, React, NestJS, Prisma, ioredis, Tailwind CSS, Recharts, dnd-kit, Lucide và Framer Motion. Khi phân phối bản build/container cần giữ notice/license bắt buộc của dependency đã đóng gói.

## Thương hiệu và tài nguyên ngoài source

- Tên Lark, UpBase và các nhãn hiệu liên quan không được coi là tài sản tự động cấp phép lại theo MIT.
- `apps/web/src/components/app-brand.tsx` tham chiếu logo UpBase tại CDN Webflow.
- `apps/web/src/components/shopify-runtime.tsx` sử dụng tài nguyên Polaris bên ngoài.
- Các font, ảnh, avatar, URL demo/CDN khác có điều kiện sử dụng của nguồn tương ứng.

MIT áp dụng cho source thuộc phạm vi cấp phép của dự án, không phải tuyên bố quyền phân phối lại mọi logo/ảnh hoặc quyền sử dụng thương hiệu. Khi tái sử dụng ngoài tổ chức, xác minh quyền hoặc thay bằng tài sản được phép.

## Không bao gồm

File môi trường thật, database, backup, file khách hàng, credential Lark/GitHub/VPS và ghi chép vận hành nội bộ không thuộc bộ source phân phối. Lịch sử source có thể giữ email tác giả/fixture và domain cũ; đó không phải hướng dẫn sử dụng identity hay hạ tầng thật.
