export const DEFAULT_PROJECT_STAGE_TEMPLATE = [
  {
    stageKey: "kickoff",
    phase: "initiation",
    activity: "Kickoff & Scope Alignment",
    sortOrder: 10,
    cumulativePercent: 10,
    activityPercent: 10,
    criteria: "Stakeholders, goals, scope, and working cadence are confirmed.",
    upbaseRole: "Delivery Lead",
    customerRole: "Project Sponsor"
  },
  {
    stageKey: "discovery",
    phase: "discovery",
    activity: "Process & Data Discovery",
    sortOrder: 20,
    cumulativePercent: 30,
    activityPercent: 20,
    criteria: "Current workflow, integrations, data sources, and risks are documented.",
    upbaseRole: "Solution Consultant",
    customerRole: "Business Owner"
  },
  {
    stageKey: "configuration",
    phase: "implementation",
    activity: "Configuration & Integration",
    sortOrder: 30,
    cumulativePercent: 65,
    activityPercent: 35,
    criteria: "Core setup is complete and integration smoke tests pass.",
    upbaseRole: "Implementation Engineer",
    customerRole: "Technical Owner"
  },
  {
    stageKey: "uat",
    phase: "acceptance",
    activity: "UAT & Go-live Readiness",
    sortOrder: 40,
    cumulativePercent: 90,
    activityPercent: 25,
    criteria: "UAT sign-off, training, support model, and go-live checklist are approved.",
    upbaseRole: "Customer Success",
    customerRole: "Key Users"
  },
  {
    stageKey: "golive",
    phase: "operation",
    activity: "Go-live & Hypercare",
    sortOrder: 50,
    cumulativePercent: 100,
    activityPercent: 10,
    criteria: "Production usage is stable and hypercare issues are triaged.",
    upbaseRole: "Support Lead",
    customerRole: "Operations Owner"
  }
] as const;

/**
 * Pilot delivery format from the current UpLark operating document.
 * The legacy template above is kept for backwards compatibility with older
 * integrations; new projects explicitly opting into the automatic format use
 * this four-milestone / nine-stage structure.
 */
export const PILOT_PROJECT_MILESTONE_TEMPLATE = [
  {
    name: "Nhận brief & kick-off dự án",
    normalizedKey: "nhan brief & kick-off du an",
    sortOrder: 10,
    requiredDocumentCount: 0,
    requiredDocumentTypes: [],
    unlockCriteria: "Đã xác nhận scope, mục tiêu và lịch kick-off.",
    customerConfirmationRequired: false,
    reviewerRole: "PM",
    stages: [
      { stageKey: "validate", phase: "validate", activity: "Validate scope & kick-off", sortOrder: 10, cumulativePercent: 20, activityPercent: 20, criteria: "Brief, module, PIC, proposal, scope và tiêu chí nghiệm thu được xác nhận.", upbaseRole: "PM / Dx", customerRole: "Project Sponsor" }
    ]
  },
  {
    name: "Xây dựng hệ thống",
    normalizedKey: "xay dung he thong",
    sortOrder: 20,
    requiredDocumentCount: 3,
    requiredDocumentTypes: ["BRD", "FRD", "SRS"],
    unlockCriteria: "Đủ BRD, FRD, SRS được PM duyệt trước khi bắt đầu build.",
    customerConfirmationRequired: true,
    reviewerRole: "PM",
    stages: [
      { stageKey: "design", phase: "design", activity: "Thiết kế giải pháp", sortOrder: 10, cumulativePercent: 40, activityPercent: 20, criteria: "BRD/FRD/SRS hoàn tất và được duyệt.", upbaseRole: "Dx", customerRole: "Business Owner" },
      { stageKey: "build", phase: "build", activity: "Xây dựng & kiểm thử", sortOrder: 20, cumulativePercent: 65, activityPercent: 25, criteria: "Hệ thống đã build, có URL và test case.", upbaseRole: "Dx", customerRole: "Technical Owner" },
      { stageKey: "deployment_preparation", phase: "deployment_preparation", activity: "Chuẩn bị triển khai", sortOrder: 30, cumulativePercent: 72, activityPercent: 7, criteria: "SOP và video hướng dẫn đã sẵn sàng.", upbaseRole: "Dx / PQA", customerRole: "Operations Owner" }
    ]
  },
  {
    name: "Pilot, Onboarding, Nghiệm thu hệ thống",
    normalizedKey: "pilot onboarding nghiem thu he thong",
    sortOrder: 30,
    requiredDocumentCount: 2,
    requiredDocumentTypes: ["pilot_bug_log", "onboard_bug_log"],
    unlockCriteria: "Pilot và onboarding hoàn tất; các lỗi/blocker đã có phương án xử lý.",
    customerConfirmationRequired: true,
    reviewerRole: "PM",
    stages: [
      { stageKey: "pilot", phase: "pilot", activity: "Pilot", sortOrder: 10, cumulativePercent: 82, activityPercent: 10, criteria: "Pilot bug log và đề xuất cải tiến được ghi nhận.", upbaseRole: "Dx", customerRole: "Pilot Users" },
      { stageKey: "onboard", phase: "onboard", activity: "Onboarding", sortOrder: 20, cumulativePercent: 90, activityPercent: 8, criteria: "Onboard bug log và đề xuất cải tiến được ghi nhận.", upbaseRole: "Dx / CS", customerRole: "End Users" },
      { stageKey: "acceptance", phase: "acceptance", activity: "Nghiệm thu hệ thống", sortOrder: 30, cumulativePercent: 96, activityPercent: 6, criteria: "Biên bản nghiệm thu và toàn bộ hồ sơ giải pháp được duyệt.", upbaseRole: "PM", customerRole: "Customer" }
    ]
  },
  {
    name: "Bảo trì",
    normalizedKey: "bao tri",
    sortOrder: 40,
    requiredDocumentCount: 2,
    requiredDocumentTypes: ["handover_cs", "golive_confirmation"],
    unlockCriteria: "Đã bàn giao cho CS/CSM và ghi nhận ngày Go-live.",
    customerConfirmationRequired: false,
    reviewerRole: "PM",
    stages: [
      { stageKey: "optimize", phase: "optimize", activity: "Tối ưu & hỗ trợ", sortOrder: 10, cumulativePercent: 98, activityPercent: 2, criteria: "Hồ sơ bàn giao cho CS đầy đủ.", upbaseRole: "Dx / PQA", customerRole: "CSM" },
      { stageKey: "handover", phase: "handover", activity: "Bàn giao & Go-live", sortOrder: 20, cumulativePercent: 100, activityPercent: 2, criteria: "Có xác nhận bàn giao và ngày Go-live.", upbaseRole: "BD / PM", customerRole: "CSM / Customer" }
    ]
  }
] as const;
