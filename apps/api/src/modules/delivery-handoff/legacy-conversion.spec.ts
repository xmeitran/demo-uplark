import { describe, expect, it } from "vitest";
import {
  LEGACY_NAME_MAP,
  classifyProjectPosition,
  entriesBeforeEightHourRule,
  isRunningProject,
  legacyWorkGroup,
  lookupLegacyName,
  mapLegacyStage,
  normalizeLegacyName
} from "./legacy-conversion";

const B = false;
const A = true;

describe("legacy stage/milestone name -> Layer 1 and side of the P&L closing point (9.2)", () => {
  // The whole table, spelled out: adding or changing a mapping must be a visible change of this list.
  const EXPECTED: Record<string, [string | null, boolean | null, number | null]> = {
    // TPL-001 stages
    intake: ["PRE_SALE", B, 1],
    validate: ["PRE_SALE", B, 1],
    "validate scope kick off": ["PRE_SALE", B, 1],
    design: ["DELIVERY", B, 2],
    build: ["DELIVERY", B, 2],
    "deployment preparation": ["DELIVERY", B, 2],
    pilot: ["DELIVERY", B, 3],
    onboard: ["DELIVERY", B, 3],
    acceptance: ["PM", B, 3],
    optimize: ["DELIVERY", A, 4],
    handover: ["PM", A, 4],
    // TPL-001 milestones: Layer 1 only where every stage of the milestone shares it
    "nhan brief kick off du an": ["PRE_SALE", B, 1],
    "xay dung he thong": ["DELIVERY", B, 2],
    "pilot onboarding nghiem thu he thong": [null, B, 3],
    "bao tri": [null, A, 4],
    // variants found in the data
    "nhan brief kick off": ["PRE_SALE", B, 1],
    "pre sale": ["PRE_SALE", B, 1],
    "pre sales": ["PRE_SALE", B, 1],
    "thiet ke giai phap lark": ["DELIVERY", B, 2],
    "xay dung he thong nghiem thu uat": ["DELIVERY", B, 2],
    "configuration integration": ["DELIVERY", B, 2],
    onboarding: ["DELIVERY", B, 3],
    "nghiem thu": ["PM", B, 3],
    "nghiem thu he thong": ["PM", B, 3],
    "trien khai nghiem thu van hanh": [null, B, 3],
    "van hanh toi uu": ["DELIVERY", A, 4],
    "ban giao bao tri": [null, A, 4],
    "khao sat thuc trang chuan hoa quy trinh": [null, B, null]
  };

  it("holds exactly the expected names", () => {
    expect(Object.fromEntries(Object.entries(LEGACY_NAME_MAP).map(([name, value]) => [name, [value.taskTypeLayer1, value.afterPnlClose, value.milestone]]))).toEqual(EXPECTED);
  });

  it("normalises case, diacritics, punctuation and the 'Milestone N' / 'upcoming' prefixes", () => {
    expect(normalizeLegacyName("Milestone 2: Xây dựng hệ thống")).toBe("xay dung he thong");
    expect(normalizeLegacyName("Milestone 3 -  Xây dựng hệ thống & Nghiệm thu UAT")).toBe("xay dung he thong nghiem thu uat");
    expect(normalizeLegacyName("Upcoming Milestone 5 - Vận hành & Tối ưu")).toBe("van hanh toi uu");
    expect(normalizeLegacyName("Đánh giá hiện trạng")).toBe("danh gia hien trang");
    expect(normalizeLegacyName("Milestone - Sao Mai")).toBe("milestone sao mai");
  });

  it.each([
    ["Intake", "PRE_SALE", B],
    ["[DXE] Intake", "PRE_SALE", B],
    ["Validate scope & kick-off", "PRE_SALE", B],
    ["Pre-sales - Lark License", "PRE_SALE", B],
    ["Deployment Preparation", "DELIVERY", B],
    ["[BUILD] Quy trình nghỉ việc", "DELIVERY", B],
    ["Feature Build: Logic chấm công GPS (Attendance)", "DELIVERY", B],
    ["Feature Build - Thanh lý tài sản", "DELIVERY", B],
    ["[ASNOVA Payroll] Milestone 3 -  Xây dựng hệ thống & nghiệm thu UAT", "DELIVERY", B],
    ["Milestone 2 - Thiết kế giải pháp Lark", "DELIVERY", B],
    ["Configuration & Integration", "DELIVERY", B],
    ["Nghiệm thu", "PM", B],
    ["Milestone 5 -  Vận hành & Tối ưu", "DELIVERY", A],
    ["Handover", "PM", A],
    ["Milestone 4: Bảo trì", null, A],
    ["[Lark HRM Suite] Upcoming Milestone 4 - Triển khai & nghiệm thu vận hành", null, B],
    ["Milestone 1 - Khảo sát thực trạng & chuẩn hóa quy trình", null, B]
  ])("%s -> %s / after=%s", (name, layer1, afterPnlClose) => {
    expect(lookupLegacyName(name)).toMatchObject({ taskTypeLayer1: layer1, afterPnlClose });
  });

  it.each([
    "Log task", "Họp nội bộ", "lark_base", "Nguyễn Thùy Dương - Internal Worklog", "Kick-off", "Discovery", "Requirements",
    "UAT", "Go-live", "Launch", "Kickoff & Scope Alignment", "UAT & Go-live Readiness", "Go-live & Hypercare",
    "Pilot hệ thống", "Check project", "🏁 Stage 5 — UAT, Bug Fix & Go-live", "[MT] Weekly meeting", "Planning Phase 2",
    "Stage Pilot: Triển khai Pilot (Trial Run)", "Milestone - Sao Mai", "", null
  ])("%s stays unmapped", (name) => {
    expect(lookupLegacyName(name)).toBeNull();
  });

  it("uses the TPL-001 stage key when the project uses the template, whatever the stage was renamed to", () => {
    expect(mapLegacyStage({ milestoneTemplateKey: "pilot-v1", stageKey: "acceptance", stageName: "Việc khác", milestoneName: "Bảo trì" }))
      .toEqual({ taskTypeLayer1: "PM", afterPnlClose: B, milestone: 3, source: "template" });
    // A legacy project's stage key carries a random suffix and is never read.
    expect(mapLegacyStage({ milestoneTemplateKey: null, stageKey: "acceptance", stageName: "Việc khác", milestoneName: "Việc khác" }).source).toBe("unmapped");
  });

  it("lets the stage name decide and fills what it leaves open from the milestone name", () => {
    expect(mapLegacyStage({ stageName: "Acceptance", milestoneName: "Milestone 2: Xây dựng hệ thống" })).toMatchObject({ taskTypeLayer1: "PM", afterPnlClose: B, source: "stage_and_milestone" });
    expect(mapLegacyStage({ stageName: "Đánh giá hiện trạng UpBase", milestoneName: "Nhận brief & Kick-off" })).toMatchObject({ taskTypeLayer1: "PRE_SALE", afterPnlClose: B, source: "milestone_name" });
    expect(mapLegacyStage({ stageName: "Milestone 1 - Khảo sát thực trạng & chuẩn hóa quy trình", milestoneName: "Nhận brief & kick-off dự án" })).toMatchObject({ taskTypeLayer1: "PRE_SALE", afterPnlClose: B });
    expect(mapLegacyStage({ stageName: "Bảo trì", milestoneName: "Bảo trì" })).toMatchObject({ taskTypeLayer1: null, afterPnlClose: A });
    expect(mapLegacyStage({ stageName: "Milestone 4 - Triển khai & nghiệm thu vận hành", milestoneName: "lark_base" })).toMatchObject({ taskTypeLayer1: null, afterPnlClose: B, source: "stage_name" });
  });

  it("maps nothing when the stage and its milestone name opposite sides of the closing point", () => {
    expect(mapLegacyStage({ stageName: "Acceptance", milestoneName: "Milestone 4: Bảo trì" })).toEqual({ taskTypeLayer1: null, afterPnlClose: null, milestone: null, source: "conflict" });
  });

  it("leaves a stage unmapped when neither name is in the table", () => {
    expect(mapLegacyStage({ stageName: "Log task", milestoneName: "Kha Nguyễn - Internal Working" })).toEqual({ taskTypeLayer1: null, afterPnlClose: null, milestone: null, source: "unmapped" });
  });
});

describe("old Timesheet groups (9.2)", () => {
  it("recognises Họp / Khác by the slugs that were stored", () => {
    for (const workType of ["h_p", "kh_c", "meeting", "Họp", "Khác"]) expect(legacyWorkGroup({ workType })).toBe("meeting_or_other");
    for (const workType of ["implementation", "delivery", "support", "", null]) expect(legacyWorkGroup({ workType })).toBeNull();
  });

  it("recognises Day-off and company activity", () => {
    expect(legacyWorkGroup({ workType: "day_off" })).toBe("day_off");
    expect(legacyWorkGroup({ workType: "implementation", dayOffId: "d1" })).toBe("day_off");
    expect(legacyWorkGroup({ workType: "company_activity" })).toBe("company_activity");
  });
});

describe("days over 8 hours before the effective date (9.2)", () => {
  const at = (iso: string) => new Date(iso);
  const entries = [
    // Person A, 2026-09-01: 5h + 4h = 9h -> over
    { id: "a1", userId: "A", at: at("2026-09-01T02:00:00.000Z"), minutes: 300 },
    { id: "a2", userId: "A", at: at("2026-09-01T08:00:00.000Z"), minutes: 240 },
    // Person A, 2026-09-02: exactly 8h -> not over
    { id: "a3", userId: "A", at: at("2026-09-02T02:00:00.000Z"), minutes: 480 },
    // Person B, 2026-09-01: 8h standard + 2h overtime -> overtime does not count (D-14)
    { id: "b1", userId: "B", at: at("2026-09-01T02:00:00.000Z"), minutes: 600, overtimeMinutes: 120 },
    // Person C: 17:30 UTC on 30/09 is 00:30 on 01/10 in Vietnam; with the entry of 01/10 the day is 9h
    { id: "c1", userId: "C", at: at("2026-09-30T17:30:00.000Z"), minutes: 60 },
    { id: "c2", userId: "C", at: at("2026-10-01T03:00:00.000Z"), minutes: 480 }
  ];

  it("marks every entry of an over-cap person-day dated before the effective date, and nothing else", () => {
    expect(entriesBeforeEightHourRule(entries, "2026-10-12")).toEqual({ personDays: 2, entryIds: ["a1", "a2", "c1", "c2"] });
  });

  it("does not mark a day on or after the effective date", () => {
    expect(entriesBeforeEightHourRule(entries, "2026-10-01")).toEqual({ personDays: 1, entryIds: ["a1", "a2"] });
    expect(entriesBeforeEightHourRule(entries, "2026-09-01").entryIds).toEqual([]);
  });

  it("never changes the hours", () => {
    const before = JSON.stringify(entries);
    entriesBeforeEightHourRule(entries, "2026-10-12");
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe("position of a running project (table 9.1)", () => {
  it("takes the furthest TPL-001 milestone that has started work", () => {
    expect(classifyProjectPosition([{ milestone: 1, status: "completed" }, { milestone: 2, status: "not_started" }])).toBe("before_g1");
    expect(classifyProjectPosition([{ milestone: 1, status: "completed" }, { milestone: 2, status: "in_progress" }])).toBe("milestone_2");
    expect(classifyProjectPosition([{ milestone: 2, status: "done" }, { milestone: 3, status: "not_started", loggedMinutes: 30 }])).toBe("milestone_3_4");
    expect(classifyProjectPosition([{ milestone: 4, status: "in_progress" }])).toBe("milestone_3_4");
  });

  it("is 'chưa qua G1' only when nothing at all has started", () => {
    expect(classifyProjectPosition([{ milestone: 1, status: "not_started" }, { milestone: 2, status: "not_started" }])).toBe("before_g1");
    expect(classifyProjectPosition([{ milestone: 1, status: "not_started" }, { milestone: null, status: "in_progress" }])).toBe("unknown");
  });

  it("does not guess without stages placed on TPL-001", () => {
    expect(classifyProjectPosition([])).toBe("unknown");
    expect(classifyProjectPosition([{ milestone: null, status: "in_progress" }])).toBe("unknown");
    expect(classifyProjectPosition([{ milestone: 2, status: "not_started" }])).toBe("unknown");
  });

  it("only treats projects that are not completed, in maintenance or closed as running", () => {
    expect(["planning", "in_progress", "in_review", "on_hold", "at_risk"].map(isRunningProject)).toEqual([true, true, true, true, true]);
    expect(["completed", "maintenance", "closed"].map(isRunningProject)).toEqual([false, false, false]);
  });
});
