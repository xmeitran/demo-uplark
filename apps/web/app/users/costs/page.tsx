import { Suspense } from "react";
import { StaffCostsPage } from "@/components/pnl/staff-monthly-costs";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Mục 6.7 — Hồ sơ nhân sự › Chi phí theo tháng (chỉ nhóm quyền chi phí; the API answers 403 to anyone else). */
export default function StaffCostsRoute() {
  return <Suspense fallback={null}><StaffCostsPage /></Suspense>;
}
