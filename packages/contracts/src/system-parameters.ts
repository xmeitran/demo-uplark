/**
 * "Nguyên tắc nền tảng hệ thống PM" 7.6 (configuration parameters) and 7.5 (trigger catalogue, V-33…V-38).
 * Pure data + validation shared by API, worker and web. Storage and the scan live in the API.
 */

// ---------------------------------------------------------------------------
// 7.6 — parameters
// ---------------------------------------------------------------------------

export type SystemParameterKind = "number" | "select" | "times" | "date" | "number_map";

export interface SystemParameterDef<V = unknown> {
  key: string;
  label: string;
  unit: string;
  kind: SystemParameterKind;
  defaultValue: V;
  /** Rule / trigger codes that read it ("Dùng cho"). */
  usedBy: string;
  /** "Người chốt". */
  decidedBy: string;
  /** "Template ghi đè": a milestone template may override it. The override itself is not built yet. */
  templateOverridable: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** times only: the exact number of entries (the reminder has three fixed slots). */
  count?: number;
  /** number_map only: the fixed set of entries. */
  entries?: ReadonlyArray<{ key: string; label: string }>;
  hint?: string;
}

function def<V>(value: SystemParameterDef<V>) {
  return value;
}

/** Every parameter of 7.6 with the document's default, plus the cut-over date of section 9. */
export const SYSTEM_PARAMETERS = {
  standardDayHours: def<number>({ key: "standardDayHours", label: "Giờ chuẩn một ngày", unit: "giờ", kind: "number", defaultValue: 8, usedBy: "D-13, NL-05, TD-03", decidedBy: "BD Lead", templateOverridable: false, min: 0.5, max: 24 }),
  hoursUsedThresholdPercent: def<number>({ key: "hoursUsedThresholdPercent", label: "Mức giờ đã dùng bắt đầu xét", unit: "% giờ dự kiến", kind: "number", defaultValue: 80, usedBy: "TD-01, TD-03", decidedBy: "Dx Director, PM", templateOverridable: true, min: 1, max: 1000 }),
  progressGapPoints: def<number>({ key: "progressGapPoints", label: "Khoảng lệch cho phép giữa khối lượng xong và thời gian đã trôi", unit: "điểm phần trăm", kind: "number", defaultValue: 10, usedBy: "TD-03", decidedBy: "Dx Director, PM", templateOverridable: true, min: 0, max: 100 }),
  progressMeasure: def<string>({
    key: "progressMeasure", label: "Cách đo khối lượng đã xong", unit: "", kind: "select", defaultValue: "completed_subtask_estimate", usedBy: "TD-03", decidedBy: "Dx Director, PM", templateOverridable: false,
    options: [{ value: "completed_subtask_estimate", label: "Giờ dự kiến của các sub-task đã hoàn thành (không dùng giờ đã ghi)" }],
    hint: "Tài liệu chỉ cho phép một cách đo."
  }),
  plannedNoLogWorkingDays: def<number>({ key: "plannedNoLogWorkingDays", label: "Số ngày sub-task có kế hoạch mà chưa có giờ log", unit: "ngày làm việc", kind: "number", defaultValue: 2, usedBy: "NL-04", decidedBy: "PM", templateOverridable: true, min: 0, max: 60, integer: true }),
  customerResponseWorkingDays: def<number>({ key: "customerResponseWorkingDays", label: "Hạn phản hồi của khách", unit: "ngày làm việc", kind: "number", defaultValue: 3, usedBy: "V-14, BRI-05", decidedBy: "BD Lead, PM", templateOverridable: true, min: 0, max: 60, integer: true }),
  customerResponseG4WorkingDays: def<number>({ key: "customerResponseG4WorkingDays", label: "Hạn phản hồi của khách tại G4", unit: "ngày làm việc", kind: "number", defaultValue: 1, usedBy: "V-14, BRI-05", decidedBy: "BD Lead, PM", templateOverridable: true, min: 0, max: 60, integer: true }),
  customerReminderMaxCount: def<number>({ key: "customerReminderMaxCount", label: "Số lần nhắc tối đa trong nhóm khách hàng", unit: "lần", kind: "number", defaultValue: 2, usedBy: "V-14", decidedBy: "BD Lead, PM", templateOverridable: false, min: 0, max: 10, integer: true, hint: "Hết số lần này bot chỉ còn nhắc trong nhóm nội bộ." }),
  handoffReviewWorkingHours: def<number>({ key: "handoffReviewWorkingHours", label: "Hạn duyệt hồ sơ chuyển tiếp", unit: "giờ làm việc", kind: "number", defaultValue: 24, usedBy: "V-15, BRI-04", decidedBy: "PM", templateOverridable: true, min: 1, max: 24 * 30 }),
  statusProposalConfirmWorkingDays: def<number>({ key: "statusProposalConfirmWorkingDays", label: "Hạn xác nhận đề xuất trạng thái", unit: "ngày làm việc", kind: "number", defaultValue: 2, usedBy: "V-20", decidedBy: "PM", templateOverridable: true, min: 0, max: 60, integer: true }),
  stageExtensionAbnormalCount: def<number>({ key: "stageExtensionAbnormalCount", label: "Số lần gia hạn stage bị coi là bất thường", unit: "lần", kind: "number", defaultValue: 2, usedBy: "TD-05", decidedBy: "PM", templateOverridable: true, min: 1, max: 20, integer: true }),
  newRequestClassifyWorkingDays: def<number>({ key: "newRequestClassifyWorkingDays", label: "Hạn phân loại yêu cầu mới", unit: "ngày làm việc", kind: "number", defaultValue: 1, usedBy: "V-26", decidedBy: "PM", templateOverridable: false, min: 0, max: 60, integer: true }),
  pendingHoursWorkingDays: def<number>({ key: "pendingHoursWorkingDays", label: "Hạn xử lý giờ log Chờ xử lý", unit: "ngày làm việc", kind: "number", defaultValue: 10, usedBy: "DL-01, mục 9", decidedBy: "PM", templateOverridable: false, min: 0, max: 120, integer: true }),
  reminderTimes: def<string[]>({ key: "reminderTimes", label: "Mốc nhắc trong ngày", unit: "giờ:phút", kind: "times", defaultValue: ["08:30", "14:00", "17:00"], usedBy: "V-05", decidedBy: "PM", templateOverridable: false, count: 3, hint: "Ba mốc theo thứ tự: kế hoạch đầu ngày, nhắc lại cho PM, giờ thực tế cuối ngày. Dùng chung với mục Nhắc Lark." }),
  pnlCloseGate: def<string>({
    key: "pnlCloseGate", label: "Mốc đóng P&L dự án", unit: "", kind: "select", defaultValue: "G7", usedBy: "D-25, D-27, mục 3.4", decidedBy: "BD Lead, PM", templateOverridable: false,
    options: [{ value: "G7", label: "G7 (nghiệm thu)" }],
    hint: "Hệ thống mới biết vị trí của stage so với G7."
  }),
  effectiveDate: def<string | null>({ key: "effectiveDate", label: "Ngày áp dụng quy tắc mới", unit: "ngày", kind: "date", defaultValue: null, usedBy: "Mục 9", decidedBy: "PM, Dx Director", templateOverridable: false, hint: "Chưa chốt ngày cụ thể: để trống thì chưa áp dụng mốc chuyển đổi." })
} as const;

export type SystemParameterKey = keyof typeof SYSTEM_PARAMETERS;
export type SystemParameterValues = { [K in SystemParameterKey]: (typeof SYSTEM_PARAMETERS)[K]["defaultValue"] };
export const SYSTEM_PARAMETER_KEYS = Object.keys(SYSTEM_PARAMETERS) as SystemParameterKey[];

export function isSystemParameterKey(key: string): key is SystemParameterKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_PARAMETERS, key);
}

export function systemParameterDefaults(): SystemParameterValues {
  return Object.fromEntries(SYSTEM_PARAMETER_KEYS.map((key) => [key, structuredClone(SYSTEM_PARAMETERS[key].defaultValue)])) as SystemParameterValues;
}

function checkNumber(definition: SystemParameterDef, raw: unknown, label = definition.label): number {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}: phải là một số.`);
  if (definition.integer && !Number.isInteger(value)) throw new Error(`${label}: phải là số nguyên.`);
  if (definition.min !== undefined && value < definition.min) throw new Error(`${label}: không nhỏ hơn ${definition.min}.`);
  if (definition.max !== undefined && value > definition.max) throw new Error(`${label}: không lớn hơn ${definition.max}.`);
  return value;
}

/** Returns the normalized value or throws an Error with a Vietnamese message. */
export function validateSystemParameter<K extends SystemParameterKey>(key: K, raw: unknown): SystemParameterValues[K] {
  if (!isSystemParameterKey(key)) throw new Error(`Tham số "${String(key)}" không có trong danh mục.`);
  const definition = SYSTEM_PARAMETERS[key] as SystemParameterDef;
  const done = (value: unknown) => value as SystemParameterValues[K];
  switch (definition.kind) {
    case "number":
      return done(checkNumber(definition, raw));
    case "select":
      if (!definition.options?.some((option) => option.value === raw)) throw new Error(`${definition.label}: giá trị "${String(raw)}" không hợp lệ.`);
      return done(raw);
    case "times": {
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) throw new Error(`${definition.label}: cần từ 1 đến 12 mốc giờ.`);
      if (definition.count && raw.length !== definition.count) throw new Error(`${definition.label}: cần đúng ${definition.count} mốc giờ.`);
      const times = raw.map((item) => String(item).trim());
      if (times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error(`${definition.label}: mỗi mốc theo dạng HH:MM.`);
      if (new Set(times).size !== times.length) throw new Error(`${definition.label}: các mốc không được trùng nhau.`);
      return done([...times].sort());
    }
    case "date": {
      if (raw === null || raw === "") return done(null);
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00.000Z`))) throw new Error(`${definition.label}: ngày theo dạng YYYY-MM-DD.`);
      return done(raw);
    }
    case "number_map": {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${definition.label}: cần đủ giá trị cho từng bước.`);
      const source = raw as Record<string, unknown>;
      const allowed = new Set(definition.entries!.map((entry) => entry.key));
      const unknown = Object.keys(source).find((entryKey) => !allowed.has(entryKey));
      if (unknown) throw new Error(`${definition.label}: bước "${unknown}" không có SLA.`);
      return done(Object.fromEntries(definition.entries!.map((entry) => [entry.key, checkNumber(definition, source[entry.key], `${definition.label} (${entry.key})`)])));
    }
  }
}

export interface SystemParameterItem {
  key: SystemParameterKey;
  label: string;
  unit: string;
  kind: SystemParameterKind;
  value: unknown;
  defaultValue: unknown;
  isDefault: boolean;
  usedBy: string;
  decidedBy: string;
  templateOverridable: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  options?: ReadonlyArray<{ value: string; label: string }>;
  count?: number;
  entries?: ReadonlyArray<{ key: string; label: string }>;
  hint?: string;
  updatedAt?: string;
  updatedByUserId?: string;
  updatedByName?: string;
}

// ---------------------------------------------------------------------------
// 7.5 — trigger catalogue and notification rules
// ---------------------------------------------------------------------------

/** Decision 16: push now / daily digest / on-screen only. The base behaviour of the document is "push_now" for every trigger. */
export const ALERT_TIERS = ["push_now", "daily_digest", "screen_only"] as const;
export type AlertTier = (typeof ALERT_TIERS)[number];
export const ALERT_TIER_LABELS: Record<AlertTier, string> = { push_now: "Đẩy ngay", daily_digest: "Bản tin trong ngày", screen_only: "Chỉ hiện trên màn hình" };

export const ALERT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = { low: "Thấp", medium: "Trung bình", high: "Cao", critical: "Nghiêm trọng" };

export type AlertGroup = "NL" | "TD" | "BRI" | "DL";
export const ALERT_GROUP_LABELS: Record<AlertGroup, string> = { NL: "Nhân lực", TD: "Tiến độ", BRI: "Blocker / Risk / Issue", DL: "Dữ liệu" };

/** In-app recipients. "owner" = the person the warning record names; "pm" = the project's PM; "admins" = Dx Director / BD Lead (workspace admin roles). */
export type AlertRecipient = "owner" | "pm" | "admins";

export interface AlertTriggerDef {
  code: string;
  group: AlertGroup;
  name: string;
  /** "Kích hoạt khi". */
  condition: string;
  /** "Đọc từ". */
  readsFrom: string;
  /** "Kết thúc khi". */
  closesWhen: string;
  /** How it is evaluated: on the change itself, or by the daily scan. */
  mode: "event" | "scan" | "event+scan";
  severity: AlertSeverity;
  recipients: readonly AlertRecipient[];
  tier: AlertTier;
  enabled: boolean;
  /** Why a trigger is switched off (its data source does not exist yet). */
  disabledReason?: string;
}

function trigger(value: Omit<AlertTriggerDef, "group" | "tier" | "enabled" | "recipients"> & Partial<Pick<AlertTriggerDef, "tier" | "enabled" | "recipients">>): AlertTriggerDef {
  return { tier: "push_now", enabled: !value.disabledReason, recipients: ["owner", "pm", "admins"], ...value, group: value.code.split("-")[0] as AlertGroup };
}

export const ALERT_TRIGGERS: readonly AlertTriggerDef[] = [
  trigger({ code: "NL-01", name: "Thay đổi thành viên", condition: "Thành viên được thêm, bị xóa hoặc bị thay thế", readsFrom: "Trạng thái", closesWhen: "Phân công thay thế được xác nhận", mode: "event", severity: "medium" }),
  trigger({ code: "NL-02", name: "Đổi trạng thái tham gia", condition: "Dự án đổi trạng thái làm đổi trạng thái tham gia của thành viên", readsFrom: "Trạng thái", closesWhen: "PM đã rà task đang mở", mode: "event", severity: "medium" }),
  trigger({ code: "NL-03", name: "Thiếu người phụ trách", condition: "Milestone, stage hoặc task đang chạy không có người phụ trách", readsFrom: "Kế hoạch", closesWhen: "Đã gán người phụ trách", mode: "event+scan", severity: "high" }),
  trigger({ code: "NL-04", name: "Có kế hoạch, chưa có giờ log", condition: "Sub-task có kế hoạch quá số ngày làm việc cho phép vẫn chưa có giờ log", readsFrom: "Kế hoạch, thực tế", closesWhen: "Có giờ log hoặc kế hoạch được sửa có duyệt", mode: "scan", severity: "medium" }),
  trigger({ code: "NL-05", name: "Vượt quỹ giờ chuẩn", condition: "Tổng giờ kế hoạch của một người trên các dự án đang chạy vượt quỹ giờ chuẩn của kỳ", readsFrom: "Kế hoạch", closesWhen: "Hết vượt", mode: "scan", severity: "medium" }),
  trigger({ code: "TD-01", name: "Giờ đã ghi vượt ngưỡng", condition: "Giờ đã ghi trên giờ dự kiến của task hoặc stage vượt ngưỡng", readsFrom: "Kế hoạch, thực tế", closesWhen: "Kế hoạch mới được duyệt", mode: "scan", severity: "medium" }),
  trigger({ code: "TD-02", name: "Task quá hạn", condition: "Sub-task hoặc task chuyển Quá hạn", readsFrom: "Trạng thái", closesWhen: "Hoàn thành hoặc hạn mới được duyệt", mode: "scan", severity: "medium" }),
  trigger({ code: "TD-03", name: "Nguy cơ chậm", condition: "(A) giờ đã dùng vượt ngưỡng và khối lượng xong tụt sau nhịp thời gian; (B) khối lượng xong tụt sau nhịp thời gian; (C) khối lượng còn lại vượt năng lực còn lại", readsFrom: "Kế hoạch, thực tế, trạng thái", closesWhen: "Hết điều kiện trong 2 ngày làm việc liên tiếp", mode: "scan", severity: "high" }),
  trigger({ code: "TD-04", name: "Stage vượt SLA", condition: "Stage vượt SLA mà chưa đóng, không tính thời gian chờ khách", readsFrom: "Kế hoạch, trạng thái", closesWhen: "Stage đóng hoặc gia hạn được duyệt", mode: "scan", severity: "high" }),
  trigger({ code: "TD-05", name: "Gia hạn stage bất thường", condition: "Stage được duyệt gia hạn từ lần thứ hai", readsFrom: "Kế hoạch", closesWhen: "PM xác nhận", mode: "event", severity: "medium" }),
  trigger({ code: "TD-06", name: "Đổi kế hoạch chưa duyệt", condition: "Giờ dự kiến hoặc timeline của task bị đề xuất đổi mà chưa được duyệt", readsFrom: "Kế hoạch", closesWhen: "Thay đổi được duyệt hoặc hoàn lại", mode: "scan", severity: "medium" }),
  trigger({ code: "BRI-01", name: "Vấn đề mới", condition: "Có Blocker, Risk hoặc Issue mới", readsFrom: "Trạng thái", closesWhen: "Đã xử lý hoặc Chấp nhận", mode: "event", severity: "medium" }),
  trigger({ code: "BRI-02", name: "Vấn đề quá hạn", condition: "Vấn đề quá hạn xử lý", readsFrom: "Trạng thái", closesWhen: "Đã xử lý hoặc Chấp nhận", mode: "event+scan", severity: "high" }),
  trigger({ code: "BRI-03", name: "Vấn đề mức cao nhất", condition: "Mức ảnh hưởng nâng lên cao nhất, hoặc ảnh hưởng cam kết với khách", readsFrom: "Trạng thái", closesWhen: "Đã xử lý hoặc Chấp nhận", mode: "event", severity: "critical" }),
  trigger({ code: "BRI-04", name: "Hồ sơ chuyển tiếp chờ duyệt quá hạn", condition: "Hồ sơ chuyển tiếp quá hạn duyệt chưa có kết quả", readsFrom: "Trạng thái", closesWhen: "Có kết quả duyệt", mode: "scan", severity: "high" }),
  trigger({ code: "BRI-05", name: "Khách quá hạn phản hồi", condition: "Khách quá hạn phản hồi tại G1, G2, G4 hoặc G7", readsFrom: "Trạng thái", closesWhen: "Khách xác nhận", mode: "scan", severity: "high" }),
  trigger({ code: "DL-01", name: "Giờ Chờ xử lý quá hạn", condition: "Giờ log ở Chờ xử lý quá hạn xử lý, tính cả giờ Pre-sale", readsFrom: "Thực tế", closesWhen: "Giờ được xử lý", mode: "scan", severity: "medium" })
];

export type AlertTriggerCode = string;

/** Admin overrides per trigger code (V-38: configured at Admin › Cảnh báo). */
export type AlertTriggerOverrides = Record<string, { enabled?: boolean; tier?: AlertTier }>;

/** The catalogue with the workspace's overrides applied. A trigger without a data source can never be switched on. */
export function resolveAlertTriggers(overrides: AlertTriggerOverrides = {}): AlertTriggerDef[] {
  return ALERT_TRIGGERS.map((item) => {
    const override = overrides[item.code] ?? {};
    return {
      ...item,
      tier: (ALERT_TIERS as readonly string[]).includes(override.tier as string) ? (override.tier as AlertTier) : item.tier,
      enabled: item.disabledReason ? false : typeof override.enabled === "boolean" ? override.enabled : item.enabled
    };
  });
}

export function alertTriggerOf(typeCode: string, triggers: readonly AlertTriggerDef[] = ALERT_TRIGGERS): AlertTriggerDef | undefined {
  return triggers.find((item) => item.code === typeCode);
}

export function validateAlertTriggerOverride(code: string, raw: unknown): { enabled?: boolean; tier?: AlertTier } {
  const definition = alertTriggerOf(code);
  if (!definition) throw new Error(`Điểm kích hoạt "${code}" không có trong danh mục.`);
  const input = (raw ?? {}) as { enabled?: unknown; tier?: unknown };
  const result: { enabled?: boolean; tier?: AlertTier } = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new Error("Trạng thái bật/tắt không hợp lệ.");
    if (input.enabled && definition.disabledReason) throw new Error(`${code} chưa bật được: ${definition.disabledReason}`);
    result.enabled = input.enabled;
  }
  if (input.tier !== undefined) {
    if (!(ALERT_TIERS as readonly unknown[]).includes(input.tier)) throw new Error("Tầng thông báo không hợp lệ.");
    result.tier = input.tier as AlertTier;
  }
  return result;
}

export interface AdminWarningItem {
  id: string;
  projectId: string;
  projectName: string;
  projectCode?: string;
  typeCode: string;
  triggerName: string;
  group?: AlertGroup;
  severity: string;
  title: string;
  detail?: string;
  status: string;
  ownerUserId?: string;
  ownerName?: string;
  dueAt?: string;
  overdue: boolean;
  openedAt: string;
  closedAt?: string;
  closeReason?: string;
}

export interface AlertScanResult {
  workspaceId: string;
  scannedAt: string;
  projects: number;
  opened: Record<string, number>;
  refreshed: Record<string, number>;
  closed: Record<string, number>;
  skipped: Array<{ code: string; reason: string }>;
  notifications: { inApp: number; lark: string };
}
