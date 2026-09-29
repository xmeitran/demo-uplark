const DEPARTMENT_LABELS: Record<string, string> = {
  CDS: "Chuyển đổi số",
  CDS_PROJECT_MANAGER: "Project Manager",
  CDS_PM: "Project Manager",
  PROJECT_MANAGER: "Project Manager",
  PMO: "Project Manager",
  PM: "Project Manager",
  CDS_CUSTOMER_SUCCESS: "Customer Success",
  CUSTOMER_SUCCESS: "Customer Success",
  CS: "Customer Success",
  CSM: "Customer Success",
  CDS_DX_ENABLER: "DX Enabler",
  DX_ENABLER: "DX Enabler",
  DX: "DX Enabler",
  CDS_BUSINESS_DEVELOPMENT: "Business Development",
  BUSINESS_DEVELOPMENT: "Business Development",
  CDS_SALES: "Business Development",
  BD: "Business Development",
  CDS_MARKETING_B2B: "Marketing B2B",
  MARKETING_B2B: "Marketing B2B"
};

export function formatDepartmentLabel(value?: string | null, fallback = "Chưa phân loại") {
  const code = value?.trim();
  if (!code) return fallback;
  return DEPARTMENT_LABELS[code.toUpperCase()] ?? code;
}
