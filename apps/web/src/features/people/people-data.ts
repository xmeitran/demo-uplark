export type PersonStatus = "Active" | "On leave" | "On Hold" | "Inactive";

export type CostRateHistoryItem = {
  effectiveFrom: string;
  hourlyCostRate: number;
  active: boolean;
};

export type PeopleProfile = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
  department: string;
  level: "L1" | "L2" | "L3" | "L4" | "L5";
  employmentType: "Full-time" | "Part-time" | "Freelance" | "Intern";
  manager: string;
  status: PersonStatus;
  userId: string;
  rateCategory: string;
  hourlyCostRate: number;
  effectiveFrom: string;
  overtimeHours: number;
  planHours: number;
  actualHours: number;
  pnlHours: number;
  rateHistory: CostRateHistoryItem[];
};

export const PEOPLE_PROFILES: PeopleProfile[] = [
  { id:"u-01", name:"Trần Văn Minh", initials:"VM", color:"#2563eb", role:"Project Manager", department:"Delivery", level:"L3", employmentType:"Full-time", manager:"Nguyễn Hoàng Long", status:"Active", userId:"u-01", rateCategory:"Delivery · PM", hourlyCostRate:520000, effectiveFrom:"01/07/2026", overtimeHours:12, planHours:640, actualHours:612, pnlHours:581, rateHistory:[{effectiveFrom:"01/07/2026",hourlyCostRate:520000,active:true},{effectiveFrom:"01/01/2026",hourlyCostRate:480000,active:false},{effectiveFrom:"01/09/2025",hourlyCostRate:430000,active:false}] },
  { id:"u-02", name:"Lê Ngọc Anh", initials:"NA", color:"#7c3aed", role:"Business Analyst", department:"Consulting", level:"L2", employmentType:"Full-time", manager:"Nguyễn Hoàng Long", status:"Active", userId:"u-02", rateCategory:"Consulting · BA", hourlyCostRate:410000, effectiveFrom:"01/05/2026", overtimeHours:8, planHours:520, actualHours:486, pnlHours:462, rateHistory:[{effectiveFrom:"01/05/2026",hourlyCostRate:410000,active:true},{effectiveFrom:"01/01/2026",hourlyCostRate:390000,active:false}] },
  { id:"u-03", name:"Phạm Thanh Tùng", initials:"TT", color:"#059669", role:"Developer", department:"Engineering", level:"L3", employmentType:"Full-time", manager:"Trần Văn Minh", status:"Active", userId:"u-03", rateCategory:"Engineering · Dev", hourlyCostRate:460000, effectiveFrom:"01/07/2026", overtimeHours:10, planHours:480, actualHours:452, pnlHours:429, rateHistory:[{effectiveFrom:"01/07/2026",hourlyCostRate:460000,active:true},{effectiveFrom:"01/01/2026",hourlyCostRate:430000,active:false}] },
  { id:"u-04", name:"Hoàng Thu Hà", initials:"TH", color:"#db2777", role:"QA Engineer", department:"Quality", level:"L2", employmentType:"Full-time", manager:"Trần Văn Minh", status:"Active", userId:"u-04", rateCategory:"Quality · QA", hourlyCostRate:360000, effectiveFrom:"01/01/2026", overtimeHours:5, planHours:360, actualHours:318, pnlHours:302, rateHistory:[{effectiveFrom:"01/01/2026",hourlyCostRate:360000,active:true}] },
  { id:"u-05", name:"Đỗ Nhật Nam", initials:"NN", color:"#d97706", role:"Support", department:"Customer Success", level:"L1", employmentType:"Full-time", manager:"Lê Ngọc Anh", status:"On leave", userId:"u-05", rateCategory:"Customer Success · Support", hourlyCostRate:280000, effectiveFrom:"15/03/2026", overtimeHours:0, planHours:240, actualHours:180, pnlHours:171, rateHistory:[{effectiveFrom:"15/03/2026",hourlyCostRate:280000,active:true},{effectiveFrom:"01/09/2025",hourlyCostRate:250000,active:false}] }
];

export function formatVnd(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
}

export function formatHours(value: number) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value)} h`;
}

export function statusClass(status: PersonStatus) {
  if (status === "Active") return "bg-emerald-50 text-emerald-700";
  if (status === "On leave") return "bg-amber-50 text-amber-700";
  if (status === "On Hold") return "bg-slate-100 text-slate-600";
  return "bg-red-50 text-red-700";
}
