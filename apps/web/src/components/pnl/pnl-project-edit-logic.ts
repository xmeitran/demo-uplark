export function projectValueActionLabel(amount: number | null) {
  return amount === null ? "Nhập doanh thu" : "Sửa doanh thu";
}

export function projectValueSubmitDisabled(amount: number | null, current: number | null, reasonRequired: boolean, reason: string) {
  return amount === null || amount === current || (reasonRequired && !reason.trim());
}
