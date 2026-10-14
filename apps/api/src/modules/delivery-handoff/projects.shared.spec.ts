import { describe, expect, it } from "vitest";
import { dayCapMessage, mapMilestoneGateSummary } from "./projects.shared";

describe("dayCapMessage", () => {
  it("says how much the person already has on that day and how much is left", () => {
    expect(dayCapMessage(480, "log", 420)).toBe("Mỗi người chỉ ghi giờ tối đa 8 giờ hành chính một ngày. Ngày này người thực hiện đã ghi 7 giờ, còn ghi giờ được tối đa 1 giờ. Hãy giảm số giờ hoặc chọn ngày khác.");
    expect(dayCapMessage(480, "plan", 300)).toContain("đã có kế hoạch 5 giờ, còn lập kế hoạch được tối đa 3 giờ");
  });

  it("leaves the day's total out when one entry alone is over the cap", () => {
    expect(dayCapMessage(480, "log", 0)).toBe("Mỗi người chỉ ghi giờ tối đa 8 giờ hành chính một ngày. Hãy giảm số giờ hoặc chọn ngày khác.");
  });

  it("keeps the full-day leave message", () => {
    expect(dayCapMessage(0, "plan", 0)).toContain("đơn nghỉ phép cả ngày");
  });
});

describe("mapMilestoneGateSummary", () => {
  it("keeps subtasks and change-request stages out of milestone deliverable counts", () => {
    const result = mapMilestoneGateSummary({
      id: "milestone-1",
      projectId: "project-1",
      name: "Discovery",
      normalizedKey: "discovery",
      sortOrder: 1,
      gateStatus: "open",
      requiredDocumentCount: 0,
      requiredDocumentTypes: [],
      evidenceMode: "file_or_link",
      customerConfirmationRequired: false,
      stages: [
        { changeRequestId: null, tasks: [{ status: "done" }, { status: "todo", parentTaskId: "task-1" }] },
        { changeRequestId: "risk-1", tasks: [{ status: "todo" }] }
      ]
    }, { fileCount: 0, linkCount: 0, missingRequiredTypes: [] });

    expect(result).toMatchObject({ taskCount: 1, completedTaskCount: 1, tasksSatisfied: true });
  });
});
