/**
 * Message builders of the bots in table 7.5 ("Bot và kênh nhận"). Pure: typed input in, Lark card out.
 * The document fixes the bots, their channels and their triggers but not the wording, so the wording here is ours;
 * names and values follow the glossary (D-36). Routing lives in lark-integration.service.ts.
 *
 *   Bot                    Channel                                         Builders
 *   Khởi tạo dự án         nhóm nội bộ                                     projectCreatedCard
 *   Hồ sơ chuyển tiếp      nhóm xét duyệt, đăng lại nhóm nội bộ            handoffSubmittedCard, handoffResultCard, handoffReviewOverdueCard
 *   Xác nhận khách hàng    nhóm khách hàng (hết lượt nhắc: nhóm nội bộ)    customerConfirmationRequestCard, customerConfirmationReminderCard
 *   Trạng thái dự án       nhóm nội bộ                                     statusProposalCard, statusProposalDecidedCard, statusProposalReminderCard
 *   Sổ vấn đề dự án        nhóm nội bộ, gắn PM và BD phụ trách             issueLogCard
 *   Cảnh báo dự án         nhóm nội bộ của dự án / nhóm Quản lý dự án      projectAlertCard
 *   Nhắc việc hằng ngày    tin riêng — cards built by the worker (apps/worker/src/lark-task-reminders.ts)
 */
import { ISSUE_LOG_SEVERITY_LABELS, ISSUE_LOG_TYPE_LABELS, PROJECT_GATE_CATALOGUE, type ProjectGateCode } from "@b2b-crm/contracts";
import type { LarkCard } from "./lark-client";

export const LARK_BOTS = {
  projectInit: "Khởi tạo dự án",
  handoff: "Hồ sơ chuyển tiếp",
  customerConfirmation: "Xác nhận khách hàng",
  projectStatus: "Trạng thái dự án",
  issueLog: "Sổ vấn đề dự án",
  projectAlert: "Cảnh báo dự án",
  dailyReminder: "Nhắc việc hằng ngày"
} as const;

export interface ProjectRef {
  id: string;
  code: string;
  name: string;
  accountName?: string | null;
}

const mention = (openIds: readonly (string | null | undefined)[] = []) => [...new Set(openIds.filter(Boolean))].map((openId) => `<at id=${openId}></at>`).join(" ");
const day = (value: Date | string | null | undefined) => (value ? new Date(new Date(value).getTime() + 7 * 3_600_000).toISOString().slice(0, 10).split("-").reverse().join("/") : "chưa có");
const projectLine = (project: ProjectRef) => `**Dự án:** ${project.name} (${project.code})${project.accountName ? ` · Khách hàng: ${project.accountName}` : ""}`;
const gateName = (code: string) => `${code}${PROJECT_GATE_CATALOGUE[code as ProjectGateCode] ? ` – ${PROJECT_GATE_CATALOGUE[code as ProjectGateCode].name}` : ""}`;

/** V-36 "thao tác nằm trên hệ thống PM": every card ends with one link back; lines that are empty are dropped. */
function card(title: string, color: string, lines: Array<string | false | null | undefined>, link?: { text: string; url: string }): LarkCard {
  return {
    config: { wide_screen_mode: true },
    header: { template: color, title: { tag: "plain_text", content: title } },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: lines.filter(Boolean).join("\n") } },
      ...(link ? [{ tag: "action", actions: [{ tag: "button", type: "primary", text: { tag: "plain_text", content: link.text }, url: link.url }] }] : [])
    ]
  };
}

/** The markdown body of a card, for specs and for the delivery log. */
export function cardText(message: LarkCard): string {
  return String((message.elements[0] as any)?.text?.content ?? "");
}

export const projectUrl = (origin: string, projectId: string, hash = "") => `${origin.replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}${hash}`;

// --- Group names (V-02). The document does not fix a format: "[Nội bộ] / [Khách hàng] <khách hàng> - <dự án>". ---

export function projectGroupName(kind: "internal" | "customer", project: ProjectRef): string {
  const subject = [project.accountName, project.name].filter(Boolean).join(" - ");
  return `${kind === "internal" ? "[Nội bộ]" : "[Khách hàng]"} ${subject}`.slice(0, 100);
}

// --- Khởi tạo dự án → nhóm nội bộ ---

export function projectCreatedCard(input: { project: ProjectRef; createdByName?: string | null; picName?: string | null; frameworkLabel?: string | null; memberNames: string[]; hasCustomerGroup: boolean; url: string }): LarkCard {
  return card(`Khởi tạo dự án: ${input.project.name}`, "blue", [
    projectLine(input.project),
    input.picName && `**PIC:** ${input.picName}`,
    input.createdByName && `**Người tạo:** ${input.createdByName}`,
    input.frameworkLabel && `**Khung milestone:** ${input.frameworkLabel}`,
    `**Thành viên (${input.memberNames.length}):** ${input.memberNames.join(", ") || "chưa có"}`,
    `**Nhóm khách hàng:** ${input.hasCustomerGroup ? "đã tạo — chỉ dùng để gửi yêu cầu xác nhận cho khách" : "chưa tạo được, PM tạo lại trên trang dự án"}`,
    "Sổ vấn đề của dự án đang trống. Blocker, Risk và Issue ghi vào sổ, không chỉ trao đổi trong nhóm."
  ], { text: "Mở dự án", url: input.url });
}

// --- Hồ sơ chuyển tiếp → nhóm xét duyệt, đăng lại nhóm nội bộ ---

export function handoffSubmittedCard(input: { project: ProjectRef; gateCode: string; submittedByName?: string | null; submittedAt: Date; reviewHours: number; approverOpenIds?: string[]; url: string }): LarkCard {
  return card(`Hồ sơ chuyển tiếp ${input.gateCode} chờ duyệt`, "orange", [
    mention(input.approverOpenIds),
    projectLine(input.project),
    `**Điểm chốt:** ${gateName(input.gateCode)}`,
    `**Người nộp:** ${input.submittedByName ?? "chưa rõ"} · ${day(input.submittedAt)}`,
    `Hạn duyệt: ${input.reviewHours} giờ làm việc kể từ lúc nộp.`
  ], { text: "Duyệt hồ sơ", url: input.url });
}

const HANDOFF_RESULTS: Record<string, { label: string; color: string }> = {
  approved: { label: "Chấp nhận", color: "green" },
  conditional: { label: "Chấp nhận có điều kiện", color: "yellow" },
  rejected: { label: "Từ chối", color: "red" }
};

export function handoffResultCard(input: { project: ProjectRef; gateCode: string; decision: string; decidedByName?: string | null; reason?: string | null; awaitingCustomer: boolean; url: string }): LarkCard {
  const result = HANDOFF_RESULTS[input.decision] ?? { label: input.decision, color: "grey" };
  return card(`Kết quả duyệt ${input.gateCode}: ${result.label}`, result.color, [
    projectLine(input.project),
    `**Điểm chốt:** ${gateName(input.gateCode)}`,
    `**Người duyệt:** ${input.decidedByName ?? "chưa rõ"}`,
    input.reason && `**${input.decision === "rejected" ? "Lý do và phần làm lại" : "Tồn đọng"}:** ${input.reason}`,
    input.awaitingCustomer && "Bước tiếp theo: chờ khách hàng xác nhận."
  ], { text: "Mở điểm chốt", url: input.url });
}

/** V-15: one reminder after the review deadline, naming the Dx Director. */
export function handoffReviewOverdueCard(input: { project: ProjectRef; gateCode: string; submittedAt: Date; reviewHours: number; directorOpenIds?: string[]; url: string }): LarkCard {
  return card(`Hồ sơ ${input.gateCode} quá ${input.reviewHours} giờ làm việc chưa có kết quả`, "red", [
    mention(input.directorOpenIds),
    projectLine(input.project),
    `**Điểm chốt:** ${gateName(input.gateCode)} · nộp ${day(input.submittedAt)}`,
    "Bot chỉ nhắc một lần; sau đó hồ sơ thành cảnh báo BRI-04."
  ], { text: "Duyệt hồ sơ", url: input.url });
}

// --- Xác nhận khách hàng → nhóm khách hàng (V-14) ---

export function customerConfirmationRequestCard(input: { project: ProjectRef; gateCode: string; dueAt?: Date | null; responseWorkingDays: number; pmName?: string | null }): LarkCard {
  return card(`Đề nghị xác nhận: ${PROJECT_GATE_CATALOGUE[input.gateCode as ProjectGateCode]?.name ?? input.gateCode}`, "blue", [
    `Kính gửi Quý khách hàng${input.project.accountName ? ` ${input.project.accountName}` : ""},`,
    `Hồ sơ **${gateName(input.gateCode)}** của dự án **${input.project.name}** đã được duyệt nội bộ và cần Quý khách xác nhận.`,
    `**Hạn phản hồi:** ${day(input.dueAt)} (${input.responseWorkingDays} ngày làm việc).`,
    `Quý khách xác nhận bằng cách trả lời trong nhóm này, hoặc gửi email/biên bản cho ${input.pmName ? `PM ${input.pmName}` : "PM dự án"}.`
  ]);
}

/** `toCustomer` false = the customer-group reminders are used up; the reminder goes to the internal group only. */
export function customerConfirmationReminderCard(input: { project: ProjectRef; gateCode: string; dueAt?: Date | null; reminderNumber: number; maxCustomerReminders: number; toCustomer: boolean; pmOpenIds?: string[]; url?: string }): LarkCard {
  if (input.toCustomer) {
    return card(`Nhắc xác nhận (${input.reminderNumber}/${input.maxCustomerReminders}): ${PROJECT_GATE_CATALOGUE[input.gateCode as ProjectGateCode]?.name ?? input.gateCode}`, "orange", [
      `Kính gửi Quý khách hàng${input.project.accountName ? ` ${input.project.accountName}` : ""},`,
      `Hồ sơ **${gateName(input.gateCode)}** của dự án **${input.project.name}** đang chờ Quý khách xác nhận.`,
      `**Hạn phản hồi:** ${day(input.dueAt)}.`
    ]);
  }
  return card(`Khách chưa xác nhận ${input.gateCode}`, "red", [
    mention(input.pmOpenIds),
    projectLine(input.project),
    `**Điểm chốt:** ${gateName(input.gateCode)} · hạn phản hồi ${day(input.dueAt)}`,
    `Đã nhắc đủ ${input.maxCustomerReminders} lần trong nhóm khách hàng; từ đây chỉ nhắc nội bộ. PM/BD liên hệ khách và tải bằng chứng xác nhận lên hệ thống.`
  ], input.url ? { text: "Ghi nhận xác nhận", url: input.url } : undefined);
}

// --- Trạng thái dự án → nhóm nội bộ (V-17, V-20) ---

export interface StatusProposalInput { project: ProjectRef; fromLabel: string; proposedLabel: string; basis: string; url: string }

export function statusProposalCard(input: StatusProposalInput & { deciderOpenIds?: string[]; confirmWorkingDays: number }): LarkCard {
  return card(`Đề xuất chuyển trạng thái: ${input.proposedLabel}`, "blue", [
    mention(input.deciderOpenIds),
    projectLine(input.project),
    `**Trạng thái:** ${input.fromLabel} → **${input.proposedLabel}**`,
    `**Căn cứ:** ${input.basis}`,
    `PIC hoặc PM xác nhận trong ${input.confirmWorkingDays} ngày làm việc.`
  ], { text: "Xác nhận trên hệ thống", url: input.url });
}

export function statusProposalDecidedCard(input: StatusProposalInput & { decision: "confirmed" | "declined"; decidedByName?: string | null; reason?: string | null }): LarkCard {
  const confirmed = input.decision === "confirmed";
  return card(confirmed ? `Dự án chuyển sang ${input.proposedLabel}` : `Đề xuất ${input.proposedLabel} bị từ chối`, confirmed ? "green" : "grey", [
    projectLine(input.project),
    `**Trạng thái:** ${input.fromLabel} → ${input.proposedLabel}`,
    `**${confirmed ? "Người xác nhận" : "Người từ chối"}:** ${input.decidedByName ?? "chưa rõ"}`,
    input.reason && `**Lý do:** ${input.reason}`
  ], { text: "Mở dự án", url: input.url });
}

export function statusProposalReminderCard(input: StatusProposalInput & { deciderOpenIds?: string[]; confirmWorkingDays: number }): LarkCard {
  return card(`Đề xuất ${input.proposedLabel} quá ${input.confirmWorkingDays} ngày làm việc chưa xác nhận`, "orange", [
    mention(input.deciderOpenIds),
    projectLine(input.project),
    `**Trạng thái:** ${input.fromLabel} → **${input.proposedLabel}**`,
    `**Căn cứ:** ${input.basis}`,
    "Bot chỉ nhắc một lần; sau đó đề xuất thành cảnh báo."
  ], { text: "Xác nhận trên hệ thống", url: input.url });
}

// --- Sổ vấn đề dự án → nhóm nội bộ, gắn PM và BD phụ trách ---

export type IssueLogEvent = "created" | "severity_changed" | "escalated";
const ISSUE_EVENT_TITLES: Record<IssueLogEvent, string> = { created: "Bản ghi mới trong sổ vấn đề", severity_changed: "Đổi mức ảnh hưởng", escalated: "Chuyển cấp" };

export function issueLogCard(input: { project: ProjectRef; event: IssueLogEvent; code: string; type: string; severity: string; description: string; ownerName?: string | null; dueAt?: Date | null; escalationLabel?: string | null; note?: string | null; mentionOpenIds?: string[]; url: string }): LarkCard {
  const typeLabel = (ISSUE_LOG_TYPE_LABELS as Record<string, string>)[input.type] ?? input.type;
  const severityLabel = (ISSUE_LOG_SEVERITY_LABELS as Record<string, string>)[input.severity] ?? input.severity;
  return card(`${ISSUE_EVENT_TITLES[input.event]}: ${input.code}`, input.event === "created" ? "blue" : "red", [
    mention(input.mentionOpenIds),
    projectLine(input.project),
    `**${typeLabel} ${input.code}** · Mức ảnh hưởng: **${severityLabel}**`,
    input.description.length > 300 ? `${input.description.slice(0, 300)}…` : input.description,
    `**Người chịu trách nhiệm:** ${input.ownerName ?? "chưa có"} · **Hạn xử lý:** ${day(input.dueAt)}`,
    input.event === "escalated" && `**Chuyển cấp tới:** ${input.escalationLabel ?? "cấp trên"}`,
    input.note && `**Ghi chú:** ${input.note}`
  ], { text: "Mở sổ vấn đề", url: input.url });
}

// --- Cảnh báo dự án ---

export function projectAlertCard(input: { title: string; body: string; url: string }): LarkCard {
  return card(input.title, "red", [input.body], { text: "Mở trên hệ thống PM", url: input.url });
}
