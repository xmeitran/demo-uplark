import { describe, expect, it } from "vitest";
import { buildRuleBasedProjectPlan } from "./project-plan-rules";

describe("buildRuleBasedProjectPlan", () => {
  it("builds a deterministic milestone, stage and task preview", () => {
    const result = buildRuleBasedProjectPlan(
      {
        name: "Triển khai CRM",
        scopeSummary: "Tích hợp API và đào tạo người dùng"
      },
      {
        key: "pilot-v1",
        milestones: [
          {
            name: "Xây dựng hệ thống",
            stages: [{ stageKey: "build", activity: "Xây dựng & kiểm thử" }]
          }
        ]
      },
      "pilot-v1"
    );

    expect(result.data.source).toBe("rule-engine");
    expect(result.data.summary).toEqual({ milestoneCount: 1, stageCount: 1, taskCount: 3 });
    expect(result.data.milestones[0]?.stages[0]?.tasks.map((task) => task.title)).toEqual([
      "Chốt thiết kế và cấu hình hạng mục chính",
      "Kiểm thử nội bộ và xử lý lỗi",
      "Kiểm tra mapping và luồng tích hợp"
    ]);
  });

  it("uses a baseline checklist when a stage is not recognized", () => {
    const result = buildRuleBasedProjectPlan(
      { name: "Project" },
      { key: "custom", milestones: [{ name: "M1", stages: [{ stageKey: "custom", activity: "Review nội bộ" }] }] },
      "custom"
    );

    expect(result.data.milestones[0]?.stages[0]?.tasks).toEqual([
      { id: "preview-task-1-1-1", title: "Chuẩn bị Review nội bộ", estimateMinutes: 180 },
      { id: "preview-task-1-1-2", title: "Kiểm tra và xác nhận Review nội bộ", estimateMinutes: 120 }
    ]);
  });
});
