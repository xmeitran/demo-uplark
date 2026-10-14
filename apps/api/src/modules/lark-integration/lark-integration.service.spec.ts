import { describe, expect, it, vi } from "vitest";
import type { LarkRequest } from "./lark-client";
import { LarkIntegrationService } from "./lark-integration.service";

type Handler = (request: LarkRequest) => { status: "sent" | "disabled" | "failed"; detail: string; data?: any };

/** Fake transport: answers through `handler`, keeps every call and every delivery-log row. */
function fakeLark(handler: Handler) {
  const log: any[] = [];
  const calls: LarkRequest[] = [];
  return {
    log, calls,
    call: vi.fn(async (request: LarkRequest) => {
      calls.push(request);
      const outcome = handler(request);
      log.push({ ...request, status: outcome.status, detail: outcome.detail });
      return outcome;
    }),
    record: vi.fn(async (entry: any) => { log.push(entry); }),
    alreadyHandled: vi.fn(async (key: string) => log.some((row) => row.dedupeKey === key && row.status !== "failed"))
  };
}

function fakePrisma(overrides: { project?: Record<string, unknown>; gates?: any[]; proposals?: any[] } = {}) {
  const project: any = {
    id: "prj-1", workspaceId: "ws", code: "ACME-01", name: "HRM Suite", milestoneMode: "auto", milestoneTemplateKey: "pilot-v1",
    larkInternalChatId: null, larkCustomerChatId: null, larkGroupStatus: "not_created", larkGroupError: null, larkGroupSyncedAt: null, account: { name: "ACME" }, ...overrides.project
  };
  const users = [
    { id: "usr-pm", displayName: "Minh PM", roles: ["DELIVERY_LEAD"], openId: "ou_pm" },
    { id: "usr-bd", displayName: "Lan BD", roles: ["SALES_OWNER"], openId: "ou_bd" },
    { id: "usr-dev", displayName: "Huy Dev", roles: ["WORKSPACE_USER"], openId: "ou_dev" },
    { id: "usr-nolark", displayName: "No Lark", roles: ["WORKSPACE_USER"], openId: null },
    { id: "usr-admin", displayName: "Dx Director", roles: ["WORKSPACE_ADMIN"], openId: "ou_admin" }
  ];
  const memberIds = ["usr-pm", "usr-bd", "usr-dev", "usr-nolark"];
  const warnings: any[] = [];
  const gates = overrides.gates ?? [];
  const prisma = {
    project: {
      findFirst: async () => ({ ...project }),
      findMany: async () => [{ ...project }],
      update: vi.fn(async ({ data }: any) => Object.assign(project, data))
    },
    projectMember: { findMany: async () => memberIds.map((id) => { const user = users.find((item) => item.id === id)!; return { user: { id, displayName: user.displayName, roleBindings: user.roles.map((code) => ({ role: { code } })) } }; }) },
    projectStage: { findFirst: async () => ({ ownerUserId: "usr-pm" }) },
    tenantWorkspace: { findUnique: async () => ({ tenantKey: "tenant" }) },
    portalIdentity: {
      findMany: async ({ where }: any) => users
        .filter((user) => user.openId && (where.userId ? where.userId.in.includes(user.id) : where.providerUserId.in.includes(user.openId)))
        .map((user) => ({ userId: user.id, providerUserId: user.openId }))
    },
    user: {
      findMany: async () => users.filter((user) => user.roles.includes("WORKSPACE_ADMIN")).map((user) => ({ id: user.id })),
      findFirst: async ({ where }: any) => users.find((user) => user.id === where.id) ?? null
    },
    projectWarning: {
      findFirst: async ({ where }: any) => warnings.find((row) => row.dedupeKey === where.dedupeKey && row.status === "open") ?? null,
      findMany: async ({ where }: any) => warnings.filter((row) => row.dedupeKey === where.dedupeKey && row.status === "open"),
      create: vi.fn(async ({ data }: any) => { const row = { id: `w${warnings.length + 1}`, status: "open", ...data }; warnings.push(row); return row; }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(warnings.find((row) => row.id === where.id), data))
    },
    projectGate: { findMany: async () => gates, update: vi.fn(async ({ where, data }: any) => Object.assign(gates.find((gate) => gate.id === where.id), data)) },
    projectStatusProposal: { findMany: async () => overrides.proposals ?? [] }
  };
  return { prisma, project, warnings };
}

function build(handler: Handler, overrides: Parameters<typeof fakePrisma>[0] = {}) {
  const lark = fakeLark(handler);
  const state = fakePrisma(overrides);
  const service = new LarkIntegrationService(state.prisma, lark);
  service.env = { PUBLIC_APP_URL: "https://pm.example.com", LARK_HANDOFF_REVIEW_CHAT_ID: "oc_review" };
  return { service, lark, ...state };
}

const sent = (data?: unknown) => ({ status: "sent" as const, detail: "đã gửi Lark", data });
const messages = (lark: ReturnType<typeof fakeLark>) => lark.calls.filter((call) => call.action === "send_message").map((call) => ({ to: (call.body as any).receive_id, bot: call.bot, title: JSON.parse((call.body as any).content).header.title.content }));

describe("bot sweep: Hồ sơ chuyển tiếp, Xác nhận khách hàng, Trạng thái dự án", () => {
  const groups = { larkInternalChatId: "oc_internal", larkCustomerChatId: "oc_customer", larkGroupStatus: "created" };
  // Monday 12/10/2026 10:00 Vietnam time.
  const now = new Date("2026-10-12T03:00:00.000Z");

  it("a submission goes to the review group and is reposted to the internal group, once", async () => {
    const gate = { id: "g2", projectId: "prj-1", code: "G2", status: "submitted", submittedAt: new Date("2026-10-12T02:00:00.000Z"), submittedByUserId: "usr-dev" };
    const { service, lark } = build(() => sent(), { project: groups, gates: [gate] });
    await service.sweep("ws", { now });
    await service.sweep("ws", { now });
    expect(messages(lark)).toEqual([
      { to: "oc_review", bot: "Hồ sơ chuyển tiếp", title: "Hồ sơ chuyển tiếp G2 chờ duyệt" },
      { to: "oc_internal", bot: "Hồ sơ chuyển tiếp", title: "Hồ sơ chuyển tiếp G2 chờ duyệt" }
    ]);
  });

  it("V-15: past the review deadline the reviewers are reminded once, naming the Dx Director", async () => {
    const gate = { id: "g2", projectId: "prj-1", code: "G2", status: "submitted", submittedAt: new Date("2026-10-05T02:00:00.000Z"), submittedByUserId: "usr-dev" };
    const { service, lark } = build(() => sent(), { project: groups, gates: [gate] });
    await service.sweep("ws", { now });
    await service.sweep("ws", { now: new Date("2026-10-13T03:00:00.000Z") });
    const overdue = lark.calls.filter((call) => call.dedupeKey?.includes("review-overdue"));
    expect(overdue.map((call) => (call.body as any).receive_id)).toEqual(["oc_review", "oc_internal"]);
    expect(JSON.parse((overdue[0].body as any).content).elements[0].text.content).toContain("<at id=ou_admin></at>");
  });

  it("V-14: the result is announced internally, the request goes to the customer group only", async () => {
    const gate = { id: "g1", projectId: "prj-1", code: "G1", status: "awaiting_customer", decision: "approved", decidedAt: new Date("2026-10-12T02:30:00.000Z"), decidedByUserId: "usr-pm", customerRequestedAt: new Date("2026-10-12T02:30:00.000Z"), customerDueAt: new Date("2026-10-15T16:59:59.999Z"), customerReminderCount: 0 };
    const { service, lark } = build(() => sent(), { project: groups, gates: [gate] });
    await service.sweep("ws", { now });
    expect(messages(lark)).toEqual([
      { to: "oc_review", bot: "Hồ sơ chuyển tiếp", title: "Kết quả duyệt G1: Chấp nhận" },
      { to: "oc_internal", bot: "Hồ sơ chuyển tiếp", title: "Kết quả duyệt G1: Chấp nhận" },
      { to: "oc_customer", bot: "Xác nhận khách hàng", title: "Đề nghị xác nhận: Đóng scope & kick-off" }
    ]);
    // Nothing internal ever reaches the customer group (V-36).
    expect(messages(lark).filter((message) => message.to === "oc_customer").every((message) => message.bot === "Xác nhận khách hàng")).toBe(true);
  });

  it("V-14: at most two reminders in the customer group, one per working day, then internal only", async () => {
    const gate = { id: "g1", projectId: "prj-1", code: "G1", status: "awaiting_customer", customerRequestedAt: new Date("2026-10-12T02:30:00.000Z"), customerDueAt: new Date("2026-10-15T16:59:59.999Z"), customerReminderCount: 0 };
    const { service, lark } = build(() => sent(), { project: groups, gates: [gate] });
    for (const at of ["2026-10-12T03:00:00.000Z", "2026-10-13T02:00:00.000Z", "2026-10-13T08:00:00.000Z", "2026-10-14T02:00:00.000Z", "2026-10-15T02:00:00.000Z", "2026-10-16T02:00:00.000Z"]) await service.sweep("ws", { now: new Date(at) });
    expect(messages(lark).slice(1)).toEqual([
      { to: "oc_customer", bot: "Xác nhận khách hàng", title: "Nhắc xác nhận (1/2): Đóng scope & kick-off" },
      { to: "oc_customer", bot: "Xác nhận khách hàng", title: "Nhắc xác nhận (2/2): Đóng scope & kick-off" },
      { to: "oc_internal", bot: "Xác nhận khách hàng", title: "Khách chưa xác nhận G1" },
      { to: "oc_internal", bot: "Xác nhận khách hàng", title: "Khách chưa xác nhận G1" }
    ]);
    expect(gate.customerReminderCount).toBe(2);
  });

  it("without a customer group the request is logged as not sent instead of going anywhere else", async () => {
    const gate = { id: "g1", projectId: "prj-1", code: "G1", status: "awaiting_customer", customerRequestedAt: new Date("2026-10-12T02:30:00.000Z"), customerReminderCount: 0 };
    const { service, lark } = build(() => sent(), { project: { larkInternalChatId: "oc_internal" }, gates: [gate] });
    await service.sweep("ws", { now });
    expect(messages(lark)).toEqual([]);
    expect(lark.log).toEqual([expect.objectContaining({ bot: "Xác nhận khách hàng", status: "disabled", detail: "dự án chưa có nhóm khách hàng trên Lark", target: "nhóm khách hàng" })]);
  });

  it("V-17 / V-20: a proposal is announced in the internal group, reminded once after 2 working days, and its decision is announced", async () => {
    const proposal: any = { id: "p1", projectId: "prj-1", fromStatus: "active", proposedStatus: "at_risk", basis: "Blocker BLK-001 đang mở", status: "pending", createdAt: new Date("2026-10-12T02:00:00.000Z") };
    const { service, lark } = build(() => sent(), { project: groups, proposals: [proposal] });
    await service.sweep("ws", { now });
    await service.sweep("ws", { now: new Date("2026-10-14T03:00:00.000Z") }); // 2 working days: still within the deadline
    await service.sweep("ws", { now: new Date("2026-10-15T03:00:00.000Z") });
    await service.sweep("ws", { now: new Date("2026-10-16T03:00:00.000Z") });
    Object.assign(proposal, { status: "confirmed", decidedAt: new Date("2026-10-16T04:00:00.000Z"), decidedByUserId: "usr-pm" });
    await service.sweep("ws", { now: new Date("2026-10-16T05:00:00.000Z") });
    expect(messages(lark).map((message) => message.to)).toEqual(["oc_internal", "oc_internal", "oc_internal"]);
    expect(messages(lark).map((message) => message.title)).toEqual(["Đề xuất chuyển trạng thái: Có rủi ro", "Đề xuất Có rủi ro quá 2 ngày làm việc chưa xác nhận", "Dự án chuyển sang Có rủi ro"]);
  });
});

describe("Sổ vấn đề dự án and Cảnh báo dự án", () => {
  const record = (events: any[]) => ({ id: "risk-1", code: "BLK-001", type: "blocker", severity: "high", description: "Khách chưa cấp quyền", owner: { displayName: "Huy Dev" }, dueAt: null, escalationLevel: "dx_director", events });

  it("announces new records, severity changes and escalations in the internal group, mentioning PM and BD; other changes are silent", async () => {
    const { service, lark } = build(() => sent(), { project: { larkInternalChatId: "oc_internal" } });
    await service.announceIssueLogEvent(record([{ id: "e1", action: "created" }]), { id: "prj-1" });
    await service.announceIssueLogEvent(record([{ id: "e1", action: "created" }]), { id: "prj-1" }); // same event twice
    await service.announceIssueLogEvent(record([{ id: "e1", action: "created" }, { id: "e2", action: "updated", note: "Bước tiếp theo" }]), { id: "prj-1" });
    await service.announceIssueLogEvent(record([{ id: "e3", action: "updated", note: "Mức ảnh hưởng (mức ảnh hưởng: Trung bình → Cao)" }]), { id: "prj-1" });
    await service.announceIssueLogEvent(record([{ id: "e4", action: "escalate" }]), { id: "prj-1" });
    await service.announceIssueLogEvent(record([{ id: "e5", action: "propose_resolve" }]), { id: "prj-1" });
    expect(messages(lark)).toEqual([
      { to: "oc_internal", bot: "Sổ vấn đề dự án", title: "Bản ghi mới trong sổ vấn đề: BLK-001" },
      { to: "oc_internal", bot: "Sổ vấn đề dự án", title: "Đổi mức ảnh hưởng: BLK-001" },
      { to: "oc_internal", bot: "Sổ vấn đề dự án", title: "Chuyển cấp: BLK-001" }
    ]);
    expect(JSON.parse((lark.calls[0].body as any).content).elements[0].text.content).toContain("<at id=ou_pm></at> <at id=ou_bd></at>");
  });

  it("a one-project alert goes to that project's internal group", async () => {
    const { service, lark } = build(() => sent(), { project: { larkInternalChatId: "oc_internal" } });
    expect(await service.deliverProjectAlert({ title: "Cảnh báo Tiến độ: 1 thay đổi", body: "[Mới] TD-02", href: "/projects/prj-1", alerts: [{ projectId: "prj-1" }] })).toBe("đã gửi Lark (nhóm nội bộ dự án)");
    expect(messages(lark)).toEqual([{ to: "oc_internal", bot: "Cảnh báo dự án", title: "Cảnh báo Tiến độ: 1 thay đổi" }]);
  });

  it("no internal group, several projects or a failed send: the previous channel decides (here: not configured)", async () => {
    const none = build(() => sent());
    expect(await none.service.deliverProjectAlert({ title: "T", body: "B", href: "/projects/prj-1", alerts: [{ projectId: "prj-1" }] })).toBe("chưa cấu hình kênh Lark");
    const many = build(() => sent(), { project: { larkInternalChatId: "oc_internal" } });
    expect(await many.service.deliverProjectAlert({ title: "T", body: "B", href: "/admin#alerts", alerts: [{ projectId: "prj-1" }, { projectId: "prj-2" }] })).toBe("chưa cấu hình kênh Lark");
    expect(many.lark.calls).toHaveLength(0);
    const failing = build(() => ({ status: "disabled", detail: "chưa bật kênh Lark" }), { project: { larkInternalChatId: "oc_internal" } });
    expect(await failing.service.deliverProjectAlert({ title: "T", body: "B", href: "/projects/prj-1", alerts: [{ projectId: "prj-1" }] })).toBe("chưa cấu hình kênh Lark");
  });

  it("the scheduled entry point refuses a missing or wrong token", async () => {
    const { service } = build(() => sent());
    await expect(service.scheduledSweep("x")).rejects.toThrow("LARK_SWEEP_TOKEN chưa được cấu hình");
    service.env = { ...service.env, LARK_SWEEP_TOKEN: "right-token" };
    await expect(service.scheduledSweep("wrong-token")).rejects.toThrow("không hợp lệ");
    await expect(service.scheduledSweep(undefined)).rejects.toThrow("không hợp lệ");
  });
});
