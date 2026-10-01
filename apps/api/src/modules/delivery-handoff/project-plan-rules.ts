import type {
  CreateProjectMilestoneInput,
  ProjectPlanMilestoneSuggestion,
  ProjectPlanPreviewInput,
  ProjectPlanPreviewResponse
} from "@b2b-crm/contracts";

type RuleTemplate = {
  key: string;
  milestones: CreateProjectMilestoneInput[];
};

type TaskRule = {
  matches: string[];
  tasks: Array<{ title: string; estimateMinutes: number }>;
};

const TASK_RULES: TaskRule[] = [
  {
    matches: ["kickoff", "validate", "brief", "scope", "initiation"],
    tasks: [
      { title: "Xác nhận scope, mục tiêu và PIC", estimateMinutes: 120 },
      { title: "Chốt tiêu chí nghiệm thu và lịch kick-off", estimateMinutes: 120 }
    ]
  },
  {
    matches: ["discovery", "khảo sát", "process", "data"],
    tasks: [
      { title: "Khảo sát quy trình và nguồn dữ liệu", estimateMinutes: 240 },
      { title: "Ghi nhận yêu cầu, rủi ro và phạm vi tích hợp", estimateMinutes: 180 }
    ]
  },
  {
    matches: ["design", "thiết kế", "solution", "configuration", "build", "implementation", "integration", "xây dựng"],
    tasks: [
      { title: "Chốt thiết kế và cấu hình hạng mục chính", estimateMinutes: 360 },
      { title: "Kiểm thử nội bộ và xử lý lỗi", estimateMinutes: 240 }
    ]
  },
  {
    matches: ["pilot", "uat", "acceptance", "nghiệm thu"],
    tasks: [
      { title: "Chuẩn bị kịch bản UAT/Pilot", estimateMinutes: 180 },
      { title: "Ghi nhận và xử lý feedback nghiệm thu", estimateMinutes: 240 }
    ]
  },
  {
    matches: ["onboard", "đào tạo", "training"],
    tasks: [
      { title: "Chuẩn bị tài liệu và hướng dẫn sử dụng", estimateMinutes: 180 },
      { title: "Đào tạo người dùng và ghi nhận câu hỏi", estimateMinutes: 180 }
    ]
  },
  {
    matches: ["deployment", "deployment_preparation", "triển khai", "cutover", "migration"],
    tasks: [
      { title: "Chuẩn bị checklist triển khai và kế hoạch rollback", estimateMinutes: 180 },
      { title: "Chạy smoke test và xác nhận môi trường", estimateMinutes: 180 }
    ]
  },
  {
    matches: ["optimize", "tối ưu", "support", "hỗ trợ", "bảo trì"],
    tasks: [
      { title: "Theo dõi vận hành và xử lý vấn đề sau triển khai", estimateMinutes: 180 },
      { title: "Tổng hợp cải tiến và kế hoạch hỗ trợ tiếp theo", estimateMinutes: 120 }
    ]
  },
  {
    matches: ["handover", "go-live", "golive", "bàn giao", "operation"],
    tasks: [
      { title: "Chuẩn bị hồ sơ bàn giao và vận hành", estimateMinutes: 180 },
      { title: "Xác nhận Go-live và kế hoạch hỗ trợ sau triển khai", estimateMinutes: 120 }
    ]
  }
];

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/đ/g, "d");
}

function textForPlan(input: ProjectPlanPreviewInput) {
  return normalize([input.name, input.scopeSummary, input.acceptanceCriteria].filter(Boolean).join(" "));
}

function taskRuleForStage(activity: string, planText: string) {
  const stageText = normalize(activity);
  const rule = TASK_RULES.find((candidate) => candidate.matches.some((match) => stageText.includes(normalize(match))));
  const baseTasks = rule?.tasks ?? [
    { title: `Chuẩn bị ${activity.trim()}`, estimateMinutes: 180 },
    { title: `Kiểm tra và xác nhận ${activity.trim()}`, estimateMinutes: 120 }
  ];

  if (/(api|tich hop|integration|webhook|dong bo)/.test(planText) && /(build|configuration|integration|thiet ke|xay dung)/.test(stageText)) {
    return [
      ...baseTasks,
      { title: "Kiểm tra mapping và luồng tích hợp", estimateMinutes: 180 }
    ];
  }

  return baseTasks;
}

export function buildRuleBasedProjectPlan(
  input: ProjectPlanPreviewInput,
  template: RuleTemplate,
  templateKey: string
): ProjectPlanPreviewResponse {
  const planText = textForPlan(input);
  const milestones: ProjectPlanMilestoneSuggestion[] = template.milestones.map((milestone, milestoneIndex) => ({
    id: `preview-milestone-${milestoneIndex + 1}`,
    name: milestone.name,
    stages: milestone.stages.map((stage, stageIndex) => ({
      id: `preview-stage-${milestoneIndex + 1}-${stageIndex + 1}`,
      stageKey: stage.stageKey || `stage-${milestoneIndex + 1}-${stageIndex + 1}`,
      activity: stage.activity,
      tasks: taskRuleForStage(stage.activity, planText).map((task, taskIndex) => ({
        id: `preview-task-${milestoneIndex + 1}-${stageIndex + 1}-${taskIndex + 1}`,
        title: task.title,
        estimateMinutes: task.estimateMinutes
      }))
    }))
  }));

  return {
    data: {
      source: "rule-engine",
      templateKey,
      summary: {
        milestoneCount: milestones.length,
        stageCount: milestones.reduce((count, milestone) => count + milestone.stages.length, 0),
        taskCount: milestones.reduce((count, milestone) => count + milestone.stages.reduce((stageCount, stage) => stageCount + stage.tasks.length, 0), 0)
      },
      milestones
    }
  };
}
