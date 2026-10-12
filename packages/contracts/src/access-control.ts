/**
 * "Hai loại tài khoản: Admin và User" + mục 7.7 "Quyền xem và sửa" of Nguyên tắc nền tảng hệ thống PM.
 * The single source for: which roles exist, which account type each gives, and who may do what.
 * API and web both read this file; nothing else should hard-code "role X is an Admin".
 */

export type AccountType = "ADMIN" | "USER";
export type AccountViewMode = "admin" | "user";

/** Business roles the document names. One account holds at most one (the document defines no multi-role account). */
export type BusinessRoleCode = "PM" | "DX_DIRECTOR" | "BD_LEAD" | "BD" | "DX" | "PQA" | "CS" | "FINANCE_ADMIN";

export interface RoleCatalogueEntry {
  code: string;
  /** Label as the document writes it. */
  label: string;
  accountType: AccountType;
  /** business = a role of the document, picked in Users › "Vai trò nghiệp vụ"; technical = a code that predates the document. */
  kind: "business" | "technical";
  /** Technical codes this role also counts as, so every existing check on those codes keeps working. */
  implies: readonly string[];
  /** For a technical code: the business role it is equivalent to. */
  equivalentTo?: string;
  note?: string;
}

export const ROLE_CATALOGUE: readonly RoleCatalogueEntry[] = [
  { code: "PM", label: "PM", accountType: "ADMIN", kind: "business", implies: ["WORKSPACE_ADMIN", "DELIVERY_LEAD"] },
  { code: "DX_DIRECTOR", label: "Dx Director", accountType: "ADMIN", kind: "business", implies: ["WORKSPACE_ADMIN"], note: "Leader" },
  { code: "BD_LEAD", label: "BD Lead", accountType: "ADMIN", kind: "business", implies: ["WORKSPACE_ADMIN", "SALES_OWNER"], note: "Leader" },
  { code: "BD", label: "BD", accountType: "USER", kind: "business", implies: ["SALES_OWNER"] },
  { code: "DX", label: "Dx", accountType: "USER", kind: "business", implies: ["WORKSPACE_USER"] },
  { code: "PQA", label: "PQA", accountType: "USER", kind: "business", implies: ["WORKSPACE_USER"] },
  { code: "CS", label: "CS", accountType: "USER", kind: "business", implies: ["WORKSPACE_USER"] },
  { code: "FINANCE_ADMIN", label: "Kế toán", accountType: "USER", kind: "business", implies: [],
    note: "Không nằm trong bảng loại tài khoản; Phụ lục C thay bước 'Kế toán xác nhận đã thu' bằng PM, nên xếp User." },
  { code: "FOUNDER_GM", label: "Founder/GM", accountType: "ADMIN", kind: "technical", implies: [], equivalentTo: "Admin toàn quyền (không có trong tài liệu)" },
  { code: "WORKSPACE_ADMIN", label: "Workspace Admin", accountType: "ADMIN", kind: "technical", implies: [], equivalentTo: "Admin toàn quyền (không có trong tài liệu)" },
  { code: "DELIVERY_LEAD", label: "Delivery Lead", accountType: "USER", kind: "technical", implies: [], equivalentTo: "PM, chưa có loại tài khoản Admin" },
  { code: "SALES_OWNER", label: "Sales Owner", accountType: "USER", kind: "technical", implies: [], equivalentTo: "BD" },
  { code: "WORKSPACE_USER", label: "Workspace User", accountType: "USER", kind: "technical", implies: [], equivalentTo: "Dx / PQA / CS" },
];

const CATALOGUE_BY_CODE = new Map(ROLE_CATALOGUE.map((entry) => [entry.code, entry]));

export const BUSINESS_ROLE_CATALOGUE = ROLE_CATALOGUE.filter((entry) => entry.kind === "business");
export const BUSINESS_ROLE_CODES = BUSINESS_ROLE_CATALOGUE.map((entry) => entry.code) as BusinessRoleCode[];
/** Every code whose holder is an Admin account. */
export const ADMIN_ROLE_CODES = ROLE_CATALOGUE.filter((entry) => entry.accountType === "ADMIN").map((entry) => entry.code);
/** "Leader (Dx Director, BD Lead)" — the document uses Leader as a name for these two roles, not as a role of its own. */
export const LEADER_ROLE_CODES = ["DX_DIRECTOR", "BD_LEAD"] as const;
/** 7.7: "PM và Dx Director đổi PIC". Founder/GM and Workspace Admin hold every Admin right. */
const PIC_CHANGE_ROLE_CODES = new Set(["PM", "DX_DIRECTOR", "FOUNDER_GM", "WORKSPACE_ADMIN"]);
/** 7.7: "mặc định PM, BD Lead, Dx Director" hold the cost permission group. */
export const DEFAULT_COST_PERMISSION_ROLE_CODES: readonly string[] = ["PM", "BD_LEAD", "DX_DIRECTOR"];

export function roleCatalogueEntry(code: string) {
  return CATALOGUE_BY_CODE.get(code);
}

export function isBusinessRoleCode(code: unknown): code is BusinessRoleCode {
  return typeof code === "string" && (BUSINESS_ROLE_CODES as string[]).includes(code);
}

/** Held codes plus the technical codes they imply. Unknown codes (COST_*, portal roles) pass through. */
export function expandRoleCodes(heldRoleCodes: readonly string[]): string[] {
  return Array.from(new Set(heldRoleCodes.flatMap((code) => [code, ...(CATALOGUE_BY_CODE.get(code)?.implies ?? [])])));
}

/** Account type is derived from the roles held, never stored. */
export function accountTypeOf(roleCodes: readonly string[]): AccountType {
  return roleCodes.some((code) => CATALOGUE_BY_CODE.get(code)?.accountType === "ADMIN") ? "ADMIN" : "USER";
}

export function isAdminAccount(subject: { roleCodes: readonly string[] }) {
  return accountTypeOf(subject.roleCodes) === "ADMIN";
}

export function businessRoleOf(roleCodes: readonly string[]): BusinessRoleCode | undefined {
  return BUSINESS_ROLE_CODES.find((code) => roleCodes.includes(code));
}

/**
 * Who a matrix line is granted to — always the MINIMUM ("Ghi User thì Admin cũng làm được; ghi Admin thì User không làm được"):
 * USER = any internal account; PROJECT_MEMBER = takes part in the project; PROJECT_PIC = the project's PIC;
 * ADMIN = an Admin account; PM_DX_DIRECTOR = those two Admin roles; COST_* = the cost permission group (CR-10), which is
 * granted per person and is not implied by being Admin (Founder/GM holds all four).
 */
export type PermissionGrant = "USER" | "PROJECT_MEMBER" | "PROJECT_PIC" | "ADMIN" | "PM_DX_DIRECTOR" | "COST_VIEW" | "COST_EDIT" | "COST_APPROVE" | "COST_EXPORT";

const line = (grant: PermissionGrant, rule: string) => ({ grant, rule });

/** Mục 7.7 line by line, plus the Admin-only operations of the account-type table. Action × grant → allow. */
export const PERMISSION_MATRIX = {
  // 7.7 "User - nhân sự (BD, Dx, PQA, CS)" — Thấy
  "project.view": line("PROJECT_MEMBER", "Dự án mình được phân công"),
  "project.tasks.view": line("PROJECT_MEMBER", "Task của mọi người trong milestone"),
  "warning.view_own": line("USER", "Cảnh báo của chính mình"),
  "project.financials.view": line("COST_VIEW", "Không thấy doanh thu, chi phí, giờ tính P&L"),
  "project.status_proposal.view": line("PROJECT_PIC", "Không thấy đề xuất trạng thái dự án"),
  // 7.7 "User - nhân sự" — Sửa
  "subtask.edit_own": line("USER", "Sub-task của mình"),
  "time_entry.edit_own": line("USER", "Giờ log của mình"),
  "issue.report": line("PROJECT_MEMBER", "Báo vấn đề"),
  "task.create": line("PROJECT_MEMBER", "Thêm task trong cấu hình milestone của dự án mình tham gia (V-03)"),
  "client.create": line("USER", "BD: tạo khách hàng (V-01) — bảng loại tài khoản ghi cho mọi User"),
  "project.create": line("USER", "BD: tạo dự án và dựng khung milestone (V-02) — bảng loại tài khoản ghi cho mọi User"),
  // 7.7 "User - PIC dự án"
  "project.view_full": line("PROJECT_PIC", "Toàn bộ dự án mình phụ trách"),
  "project.status.confirm": line("PROJECT_PIC", "Xác nhận trạng thái"),
  "project.plan.update": line("PROJECT_PIC", "Cập nhật kế hoạch"),
  "gate.submit": line("PROJECT_PIC", "Nộp hồ sơ chuyển tiếp"),
  // 7.7 "Admin - PM, Dx Director, BD Lead"
  "project.view_all": line("ADMIN", "Mọi dự án trong phạm vi quản lý"),
  "warning.view_all": line("ADMIN", "Mọi cảnh báo trong phạm vi quản lý"),
  "admin.tab": line("ADMIN", "Tab Admin"),
  "admin.config.milestone_templates": line("ADMIN", "Template và điểm chốt"),
  "admin.config.alert_thresholds": line("ADMIN", "Ngưỡng cảnh báo"),
  "admin.config.days_off": line("ADMIN", "Ngày nghỉ"),
  "admin.config.lark_reminders": line("ADMIN", "Nhắc Lark"),
  "admin.config.pnl": line("ADMIN", "Thiết lập P&L và kỳ khóa"),
  "admin.audit_history": line("ADMIN", "Lịch sử (audit)"),
  "staff_profile.manage": line("ADMIN", "Hồ sơ nhân sự"),
  "project.pic.change": line("PM_DX_DIRECTOR", "PM và Dx Director đổi PIC"),
  "gate.approve": line("ADMIN", "Duyệt hồ sơ (tab Admin › Approval)"),
  "plan.approve": line("ADMIN", "Duyệt kế hoạch theo các quy tắc V"),
  "issue.classify": line("ADMIN", "Phân loại bản ghi trong sổ vấn đề"),
  // 7.7 "Admin - nhóm quyền chi phí (CR-10)"
  "cost.view": line("COST_VIEW", "Xem dữ liệu chi phí nhân sự, đơn giá, P&L"),
  "cost.edit": line("COST_EDIT", "Sửa"),
  "cost.approve": line("COST_APPROVE", "Duyệt: chốt và mở lại kỳ chi phí"),
  "cost.export": line("COST_EXPORT", "Xuất"),
  // 7.7 closing paragraph
  "view_mode.switch": line("ADMIN", "Admin có cả chế độ người dùng và chế độ quản trị"),
} as const satisfies Record<string, { grant: PermissionGrant; rule: string }>;

export type PermissionAction = keyof typeof PERMISSION_MATRIX;

export interface PermissionSubject {
  /** Effective role codes (held + implied). */
  roleCodes: readonly string[];
  /** Codes as bound in the database; needed only where the document names specific roles. Defaults to roleCodes. */
  heldRoleCodes?: readonly string[];
  /** Takes part in the project in question: member, stage owner, task owner/assignee. */
  isProjectMember?: boolean;
  isProjectPic?: boolean;
}

const COST_GRANT_CODES: Record<string, readonly string[]> = {
  COST_VIEW: ["COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"],
  COST_EDIT: ["COST_EDIT"],
  COST_APPROVE: ["COST_APPROVE"],
  COST_EXPORT: ["COST_EXPORT"],
};

/** The one decision function for the matrix. */
export function can(action: PermissionAction, subject: PermissionSubject): boolean {
  const { grant } = PERMISSION_MATRIX[action];
  const roles = subject.roleCodes;
  if (grant in COST_GRANT_CODES) return roles.includes("FOUNDER_GM") || COST_GRANT_CODES[grant].some((code) => roles.includes(code));
  if (grant === "PM_DX_DIRECTOR") return (subject.heldRoleCodes ?? roles).some((code) => PIC_CHANGE_ROLE_CODES.has(code));
  if (isAdminAccount(subject)) return true;
  if (grant === "ADMIN") return false;
  if (grant === "PROJECT_PIC") return Boolean(subject.isProjectPic);
  if (grant === "PROJECT_MEMBER") return Boolean(subject.isProjectMember || subject.isProjectPic);
  return true;
}
