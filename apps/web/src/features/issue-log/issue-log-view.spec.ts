import { describe, expect, it } from "vitest";
import type { ProjectRiskSummary } from "@b2b-crm/contracts";
import { EMPTY_ISSUE_LOG_FILTERS, ISSUE_LOG_CSV_HEADERS, filterIssueLog, issueLogCsvRows, locationLabel } from "./issue-log-view";

const record = (patch: Partial<ProjectRiskSummary>): ProjectRiskSummary => ({
  id: "r1", accountId: "a", accountName: "A", projectId: "p", projectName: "P", code: "ISS-001", type: "issue", severity: "medium", escalationLevel: "none",
  extension: {}, commercialHidden: false, isOpen: true, ageDays: 2, dueState: "no_due", allowedActions: [], canEdit: false, history: [],
  category: "Issue", description: "Mô tả", likelihood: "Medium", impact: "Medium", response: "", status: "pending", createdAt: "2026-10-10T03:00:00.000Z", updatedAt: "2026-10-10T03:00:00.000Z", ...patch
});

describe("issue log view", () => {
  const records = [
    record({}),
    record({ id: "r2", code: "CR-001", type: "change_request", status: "assessing", crStep: "CR-03", stepDueAt: "2026-10-14T16:59:59.999Z", dueState: "on_time", ownerUserId: "u1", ownerDisplayName: "Lan", extension: { intakeChannel: "email", estimatedEffortMd: 5 } }),
    record({ id: "r3", code: "BLK-001", type: "blocker", status: "resolved", isOpen: false, severity: "critical" })
  ];

  it("filters by type, severity, owner and open/exact status", () => {
    expect(filterIssueLog(records, EMPTY_ISSUE_LOG_FILTERS)).toHaveLength(3);
    expect(filterIssueLog(records, { ...EMPTY_ISSUE_LOG_FILTERS, type: "change_request" }).map((row) => row.code)).toEqual(["CR-001"]);
    expect(filterIssueLog(records, { ...EMPTY_ISSUE_LOG_FILTERS, status: "open" }).map((row) => row.code)).toEqual(["ISS-001", "CR-001"]);
    expect(filterIssueLog(records, { ...EMPTY_ISSUE_LOG_FILTERS, status: "resolved", severity: "critical" }).map((row) => row.code)).toEqual(["BLK-001"]);
    expect(filterIssueLog(records, { ...EMPTY_ISSUE_LOG_FILTERS, owner: "" }).map((row) => row.code)).toEqual(["ISS-001", "BLK-001"]);
  });

  it("shows the location path or says there is none", () => {
    expect(locationLabel({ milestoneName: "Milestone 2", stageName: "Build", taskTitle: "API" })).toBe("Milestone 2 › Build › API");
    expect(locationLabel({})).toBe("Chưa gắn vị trí");
  });

  it("exports the stable code, Vietnamese labels, step and type-specific fields", () => {
    const rows = issueLogCsvRows(records);
    expect(rows[0]).toHaveLength(ISSUE_LOG_CSV_HEADERS.length);
    expect(rows[1].slice(0, 2)).toEqual(["CR-001", "Yêu cầu thay đổi"]);
    expect(rows[1]).toEqual(expect.arrayContaining(["Đang đánh giá", "CR-03", "Trong hạn", "Lan"]));
    expect(rows[1].at(-1)).toBe("Kênh tiếp nhận: Email; Effort dự kiến (MD): 5");
    expect(rows[2]).toEqual(expect.arrayContaining(["Blocker", "Nghiêm trọng", "Đã xử lý", "Chưa phân công"]));
  });
});
