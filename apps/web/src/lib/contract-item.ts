/**
 * Hạng mục hợp đồng — contract line item (rules 2, D-22): the one label map every screen and export uses.
 * Mirrors apps/api/src/modules/delivery-handoff/contract-item.ts — keep both tables identical.
 */
export const CONTRACT_ITEM_FIELD_LABEL = "Hạng mục hợp đồng";
export const CONTRACT_ITEM_TYPE_LABELS = { FIXED_PRICE: "Trọn gói", TIME_AND_MATERIAL: "Theo giờ", INTERNAL: "Nội bộ" } as const;
export const CONTRACT_ITEM_TYPE_PENDING_LABEL = "Chờ phân loại";
export const CONTRACT_ITEM_KIND_LABELS = { ROOT: "HĐ gốc", APPENDIX: "Phụ lục", CHANGE_REQUEST: "Yêu cầu thay đổi" } as const;
/** D-07: shown before a project has any line item. */
export const NO_CONTRACT_ITEM_LABEL = "Chưa có hạng mục";

const options = <T extends Record<string, string>>(labels: T) => (Object.keys(labels) as Array<keyof T & string>).map((value) => ({ value, label: labels[value] }));
export const CONTRACT_ITEM_TYPE_OPTIONS = options(CONTRACT_ITEM_TYPE_LABELS);
export const CONTRACT_ITEM_KIND_OPTIONS = options(CONTRACT_ITEM_KIND_LABELS);
