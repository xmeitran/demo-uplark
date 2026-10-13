import { describe, expect, it } from "vitest";
import type { ProjectRiskSummary } from "@b2b-crm/contracts";
import { EMPTY_ISSUE_LOG_FILTERS, ISSUE_LOG_CSV_HEADERS, OPEN_ISSUE_STATUS, UNASSIGNED_ISSUE_OWNER, activeIssueLogFilterCount, filterIssueLog, isoDay, issueLogCsvRows, locationLabel } from "./issue-log-view";

const record = (patch: Partial<ProjectRiskSummary>): ProjectRiskSummary => ({
  id: "r1", accountId: "a", accountName: "A", projectId: "p", projectName: "P", code: "ISS-001", type: "issue", severity: "medium", escalationLevel: "none",
  extension: {}, isOpen: true, ageDays: 2, dueState: "no_due", allowedActions: [], canEdit: false, history: [],
  category: "Issue", description: "Mô tả", likelihood: "Medium", impact: "Medium", response: "", status: "pending", createdAt: "2026-10-10T03:00:00.000Z", updatedAt: "2026-10-10T03:00:00.000Z", ...patch
});

describe("issue log view", () => {
  const records = [
    record({}),
    record({ id: "r2", code: "RSK-001", type: "risk", status: "in_progress", dueAt: "2026-10-14T16:59:59.999Z", dueState: "on_time", ownerUserId: "u1", ownerDisplayName: "Lan", extension: { likelihood: "High", expectedImpact: "Trễ go-live" } }),
    record({ id: "r3", code: "BLK-001", type: "blocker", status: "resolved", isOpen: false, severity: "critical" })
  ];

  it("filters by several types, severities, owners and open/exact statuses", () => {
    const codes = (patch: Partial<typeof EMPTY_ISSUE_LOG_FILTERS>) => filterIssueLog(records, { ...EMPTY_ISSUE_LOG_FILTERS, ...patch }).map((row) => row.code);
    expect(codes({})).toEqual(["ISS-001", "RSK-001", "BLK-001"]);
    expect(codes({ types: ["risk"] })).toEqual(["RSK-001"]);
    expect(codes({ types: ["risk", "blocker"] })).toEqual(["RSK-001", "BLK-001"]);
    expect(codes({ statuses: [OPEN_ISSUE_STATUS] })).toEqual(["ISS-001", "RSK-001"]);
    expect(codes({ statuses: [OPEN_ISSUE_STATUS, "resolved"] })).toEqual(["ISS-001", "RSK-001", "BLK-001"]);
    expect(codes({ statuses: ["resolved"], severities: ["critical", "high"] })).toEqual(["BLK-001"]);
    expect(codes({ owners: [UNASSIGNED_ISSUE_OWNER] })).toEqual(["ISS-001", "BLK-001"]);
    expect(codes({ owners: [UNASSIGNED_ISSUE_OWNER, "u1"] })).toEqual(["ISS-001", "RSK-001", "BLK-001"]);
  });

  it("searches without accents and filters by the due day", () => {
    const codes = (patch: Partial<typeof EMPTY_ISSUE_LOG_FILTERS>) => filterIssueLog(records, { ...EMPTY_ISSUE_LOG_FILTERS, ...patch }).map((row) => row.code);
    expect(codes({ query: "mo ta" })).toEqual(["ISS-001", "RSK-001", "BLK-001"]);
    expect(codes({ query: "rsk-001" })).toEqual(["RSK-001"]);
    expect(codes({ query: "lan" })).toEqual(["RSK-001"]);
    // 14/10 in Vietnam; records without a due date drop out.
    expect(codes({ due: { from: "2026-10-14", to: "2026-10-14" } })).toEqual(["RSK-001"]);
    expect(codes({ due: { from: "2026-10-15", to: "" } })).toEqual([]);
  });

  it("counts the filters that narrow the list", () => {
    expect(activeIssueLogFilterCount(EMPTY_ISSUE_LOG_FILTERS)).toBe(0);
    expect(activeIssueLogFilterCount({ ...EMPTY_ISSUE_LOG_FILTERS, query: " x ", due: { from: "2026-10-01", to: "" }, types: ["risk", "issue"] })).toBe(3);
  });

  it("shows the location path or says there is none", () => {
    expect(locationLabel({ milestoneName: "Milestone 2", stageName: "Build", taskTitle: "API" })).toBe("Milestone 2 › Build › API");
    expect(locationLabel({})).toBe("Chưa gắn vị trí");
  });

  it("exports the stable code, Vietnamese labels and type-specific fields", () => {
    const rows = issueLogCsvRows(records);
    expect(rows[0]).toHaveLength(ISSUE_LOG_CSV_HEADERS.length);
    expect(rows[1].slice(0, 2)).toEqual(["RSK-001", "Risk"]);
    expect(rows[1]).toEqual(expect.arrayContaining(["Đang xử lý", "Trong hạn", "Lan"]));
    expect(ISSUE_LOG_CSV_HEADERS).not.toContain("Bước CR");
    expect(rows[1].at(-1)).toBe("Khả năng xảy ra: Cao; Tác động dự kiến: Trễ go-live");
    expect(rows[2]).toEqual(expect.arrayContaining(["Blocker", "Nghiêm trọng", "Đã xử lý", "Chưa phân công"]));
  });
});

describe("isoDay", () => {
  it("turns the date picker's display text into the calendar day the API takes", () => {
    expect(isoDay("Oct 13, 2026")).toBe("2026-10-13");
    expect(isoDay("Jan 5, 2027")).toBe("2027-01-05");
    expect(isoDay("2026-10-13")).toBe("2026-10-13");
    expect(isoDay("2026-10-13T00:00:00.000Z")).toBe("2026-10-13");
    expect(isoDay("không phải ngày")).toBe("không phải ngày");
  });
});
