import { describe, expect, it } from "vitest";
import {
  cardText, customerConfirmationReminderCard, customerConfirmationRequestCard, handoffResultCard, handoffReviewOverdueCard, handoffSubmittedCard, issueLogCard,
  projectAlertCard, projectCreatedCard, projectGroupName, statusProposalCard, statusProposalDecidedCard, statusProposalReminderCard
} from "./lark-templates";

const project = { id: "prj-1", code: "ACME-01", name: "HRM Suite", accountName: "ACME" };
const url = "https://pm.example.com/projects/prj-1";
const title = (card: { header: { title: { content: string } } }) => card.header.title.content;
const button = (card: { elements: any[] }) => card.elements[1]?.actions?.[0];

describe("Lark message templates (table 7.5)", () => {
  it("names the two project groups", () => {
    expect(projectGroupName("internal", project)).toBe("[Nội bộ] ACME - HRM Suite");
    expect(projectGroupName("customer", project)).toBe("[Khách hàng] ACME - HRM Suite");
    expect(projectGroupName("internal", { ...project, accountName: null })).toBe("[Nội bộ] HRM Suite");
  });

  it("Khởi tạo dự án: project, PIC, framework, members, the empty issue log and a link back", () => {
    const card = projectCreatedCard({ project, createdByName: "Lan", picName: "Minh", frameworkLabel: "Template pilot-v1", memberNames: ["Lan", "Minh"], hasCustomerGroup: false, url });
    expect(title(card)).toBe("Khởi tạo dự án: HRM Suite");
    expect(cardText(card)).toContain("**Dự án:** HRM Suite (ACME-01) · Khách hàng: ACME");
    expect(cardText(card)).toContain("**PIC:** Minh");
    expect(cardText(card)).toContain("**Thành viên (2):** Lan, Minh");
    expect(cardText(card)).toContain("chưa tạo được, PM tạo lại trên trang dự án");
    expect(cardText(card)).toContain("Sổ vấn đề của dự án đang trống");
    expect(button(card)).toMatchObject({ url, text: { content: "Mở dự án" } });
  });

  it("Hồ sơ chuyển tiếp: submission, result and the single overdue reminder", () => {
    const submitted = handoffSubmittedCard({ project, gateCode: "G2", submittedByName: "Lan", submittedAt: new Date("2026-10-12T03:00:00.000Z"), reviewHours: 24, approverOpenIds: ["ou_admin"], url });
    expect(title(submitted)).toBe("Hồ sơ chuyển tiếp G2 chờ duyệt");
    expect(cardText(submitted)).toContain("<at id=ou_admin></at>");
    expect(cardText(submitted)).toContain("**Người nộp:** Lan · 12/10/2026");
    expect(cardText(submitted)).toContain("24 giờ làm việc");

    const rejected = handoffResultCard({ project, gateCode: "G2", decision: "rejected", decidedByName: "Minh", reason: "Thiếu SRS", awaitingCustomer: false, url });
    expect(title(rejected)).toBe("Kết quả duyệt G2: Từ chối");
    expect(rejected.header.template).toBe("red");
    expect(cardText(rejected)).toContain("**Lý do và phần làm lại:** Thiếu SRS");
    const conditional = handoffResultCard({ project, gateCode: "G1", decision: "conditional", reason: "Còn 1 task", awaitingCustomer: true, url });
    expect(title(conditional)).toBe("Kết quả duyệt G1: Chấp nhận có điều kiện");
    expect(cardText(conditional)).toContain("**Tồn đọng:** Còn 1 task");
    expect(cardText(conditional)).toContain("chờ khách hàng xác nhận");

    const overdue = handoffReviewOverdueCard({ project, gateCode: "G2", submittedAt: new Date("2026-10-07T03:00:00.000Z"), reviewHours: 24, directorOpenIds: ["ou_dx"], url });
    expect(title(overdue)).toBe("Hồ sơ G2 quá 24 giờ làm việc chưa có kết quả");
    expect(cardText(overdue)).toContain("<at id=ou_dx></at>");
    expect(cardText(overdue)).toContain("BRI-04");
  });

  it("Xác nhận khách hàng: the request carries the deadline and nothing internal", () => {
    const card = customerConfirmationRequestCard({ project, gateCode: "G4", dueAt: new Date("2026-10-13T16:59:59.999Z"), responseWorkingDays: 1, pmName: "Minh" });
    expect(title(card)).toContain("Đề nghị xác nhận");
    expect(cardText(card)).toContain("Kính gửi Quý khách hàng ACME");
    expect(cardText(card)).toContain("**Hạn phản hồi:** 13/10/2026 (1 ngày làm việc).");
    expect(cardText(card)).toContain("PM Minh");
    expect(card.elements).toHaveLength(1); // no link into the internal system for the customer
    expect(cardText(card)).not.toContain("ACME-01");
  });

  it("Xác nhận khách hàng: reminders count in the customer group, then turn internal", () => {
    const toCustomer = customerConfirmationReminderCard({ project, gateCode: "G1", dueAt: new Date("2026-10-15T16:59:59.999Z"), reminderNumber: 2, maxCustomerReminders: 2, toCustomer: true });
    expect(title(toCustomer)).toContain("Nhắc xác nhận (2/2)");
    expect(toCustomer.elements).toHaveLength(1);
    const internal = customerConfirmationReminderCard({ project, gateCode: "G1", dueAt: null, reminderNumber: 3, maxCustomerReminders: 2, toCustomer: false, pmOpenIds: ["ou_pm"], url });
    expect(title(internal)).toBe("Khách chưa xác nhận G1");
    expect(cardText(internal)).toContain("<at id=ou_pm></at>");
    expect(cardText(internal)).toContain("Đã nhắc đủ 2 lần trong nhóm khách hàng; từ đây chỉ nhắc nội bộ");
    expect(button(internal).url).toBe(url);
  });

  it("Trạng thái dự án: proposal, decision and the single reminder", () => {
    const base = { project, fromLabel: "Đang triển khai", proposedLabel: "Có rủi ro", basis: "Blocker BLK-001 đang mở", url };
    const created = statusProposalCard({ ...base, deciderOpenIds: ["ou_pm"], confirmWorkingDays: 2 });
    expect(title(created)).toBe("Đề xuất chuyển trạng thái: Có rủi ro");
    expect(cardText(created)).toContain("**Trạng thái:** Đang triển khai → **Có rủi ro**");
    expect(cardText(created)).toContain("**Căn cứ:** Blocker BLK-001 đang mở");
    expect(cardText(created)).toContain("trong 2 ngày làm việc");
    expect(title(statusProposalDecidedCard({ ...base, decision: "confirmed", decidedByName: "Minh" }))).toBe("Dự án chuyển sang Có rủi ro");
    const declined = statusProposalDecidedCard({ ...base, decision: "declined", decidedByName: "Minh", reason: "Đã có phương án" });
    expect(title(declined)).toBe("Đề xuất Có rủi ro bị từ chối");
    expect(cardText(declined)).toContain("**Lý do:** Đã có phương án");
    expect(title(statusProposalReminderCard({ ...base, confirmWorkingDays: 2 }))).toBe("Đề xuất Có rủi ro quá 2 ngày làm việc chưa xác nhận");
  });

  it("Sổ vấn đề dự án: new record, severity change and escalation, mentioning PM and BD", () => {
    const base = { project, code: "BLK-001", type: "blocker", severity: "high", description: "Khách chưa cấp quyền", ownerName: "Lan", dueAt: new Date("2026-10-15T00:00:00.000Z"), mentionOpenIds: ["ou_pm", "ou_bd", "ou_pm"], url };
    const created = issueLogCard({ ...base, event: "created" });
    expect(title(created)).toBe("Bản ghi mới trong sổ vấn đề: BLK-001");
    expect(cardText(created)).toContain("<at id=ou_pm></at> <at id=ou_bd></at>");
    expect(cardText(created)).toContain("**Blocker BLK-001** · Mức ảnh hưởng: **Cao**");
    expect(cardText(created)).toContain("**Người chịu trách nhiệm:** Lan · **Hạn xử lý:** 15/10/2026");
    expect(title(issueLogCard({ ...base, event: "severity_changed", note: "Mức ảnh hưởng (mức ảnh hưởng: Trung bình → Cao)" }))).toBe("Đổi mức ảnh hưởng: BLK-001");
    const escalated = issueLogCard({ ...base, event: "escalated", escalationLabel: "Dx Director" });
    expect(title(escalated)).toBe("Chuyển cấp: BLK-001");
    expect(cardText(escalated)).toContain("**Chuyển cấp tới:** Dx Director");
  });

  it("Cảnh báo dự án: title, merged body and the link", () => {
    const card = projectAlertCard({ title: "Cảnh báo Tiến độ: 2 thay đổi", body: "[Mới] TD-02 · HRM Suite: Task quá hạn", url });
    expect(title(card)).toBe("Cảnh báo Tiến độ: 2 thay đổi");
    expect(cardText(card)).toBe("[Mới] TD-02 · HRM Suite: Task quá hạn");
    expect(button(card).url).toBe(url);
  });
});
