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
    reviewerMode: "workspace_admin",
    stages: [
      {
        stageKey: "intake",
        phase: "intake",
        activity: "Intake",
        sortOrder: 10,
        cumulativePercent: 10,
        activityPercent: 10,
        criteria: "Đã tiếp nhận brief và ghi nhận đầy đủ nhu cầu ban đầu của khách hàng.",
        upbaseRole: "PM / Dx",
        customerRole: "Project Sponsor",
        slaDays: 2,
        tasks: [
          { title: "Tiếp nhận brief, thu thập đầy đủ thông tin painpoint và kỳ vọng sơ bộ của khách hàng.", subtasks: [] },
          { title: "Phân tích hiện trạng, xây dựng quy trình đề xuất và dựng Proposal/Demo.", subtasks: [] }
        ]
      },
      {
        stageKey: "validate",
        phase: "validate",
        activity: "Validate scope & kick-off",
        sortOrder: 20,
        cumulativePercent: 20,
        activityPercent: 10,
        criteria: "Brief, module, PIC, proposal, scope và tiêu chí nghiệm thu được xác nhận.",
        upbaseRole: "PM / Dx",
        customerRole: "Project Sponsor",
        slaDays: 2,
        tasks: [
          { title: "Trình bày Proposal và Demo giải pháp (nếu có) cho khách hàng.", subtasks: [] },
          { title: "Hoàn thiện Proposal/Demo dựa trên các góp ý chỉnh sửa của khách hàng.", subtasks: [] },
          { title: "Ký duyệt/Xác nhận đóng Scope quy trình về mặt Business với khách hàng.", subtasks: [] }
        ]
      }
    ]
  },
  {
    name: "Xây dựng hệ thống",
    normalizedKey: "xay dung he thong",
    sortOrder: 20,
    requiredDocumentCount: 3,
    requiredDocumentTypes: ["BRD", "FRD", "SRS"],
    unlockCriteria: "Đủ BRD, FRD, SRS và được người duyệt xác nhận trước khi bắt đầu build.",
    customerConfirmationRequired: true,
    reviewerMode: "workspace_admin",
    stages: [
      { stageKey: "design", phase: "design", activity: "Design", sortOrder: 10, cumulativePercent: 40, activityPercent: 20, criteria: "BRD/FRD/SRS hoàn tất và được duyệt.", upbaseRole: "Dx", customerRole: "Business Owner", slaDays: 3, tasks: [{ title: "Xây dựng bộ tài liệu thiết kế giải pháp (Form, Flow, Data, Permission).", subtasks: [] }] },
      { stageKey: "build", phase: "build", activity: "Build", sortOrder: 20, cumulativePercent: 65, activityPercent: 25, criteria: "Hệ thống đã build, có URL và test case.", upbaseRole: "Dx", customerRole: "Technical Owner", slaDays: 5, tasks: [{ title: "Cấu hình và xây dựng hệ thống vận hành trên Lark.", subtasks: [] }, { title: "Import dữ liệu mẫu, UAT nội bộ, Fix bug.", subtasks: [] }] },
      { stageKey: "deployment_preparation", phase: "deployment_preparation", activity: "Deployment Preparation", sortOrder: 30, cumulativePercent: 72, activityPercent: 7, criteria: "SOP và video hướng dẫn đã sẵn sàng.", upbaseRole: "Dx / PQA", customerRole: "Operations Owner", slaDays: 2, tasks: [{ title: "Xây dựng tài liệu hướng dẫn vận hành (SOP + Video).", subtasks: [] }, { title: "Chuẩn hoá và Import dữ liệu (nếu có).", subtasks: [] }] }
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
    reviewerMode: "workspace_admin",
    stages: [
      { stageKey: "pilot", phase: "pilot", activity: "Pilot", sortOrder: 10, cumulativePercent: 82, activityPercent: 10, criteria: "Pilot bug log và đề xuất cải tiến được ghi nhận.", upbaseRole: "Dx", customerRole: "Pilot Users", slaDays: 3, tasks: [{ title: "Chạy Pilot hệ thống với nhóm Key Users.", subtasks: [] }, { title: "Thiết lập phân quyền, bảo mật và Bàn giao Admin cho khách hàng.", subtasks: [] }] },
      { stageKey: "onboard", phase: "onboard", activity: "Onboard", sortOrder: 20, cumulativePercent: 90, activityPercent: 8, criteria: "Onboard bug log và đề xuất cải tiến được ghi nhận.", upbaseRole: "Dx / CS", customerRole: "End Users", slaDays: 2, tasks: [{ title: "Onboard hệ thống toàn công ty.", subtasks: [] }] },
      { stageKey: "acceptance", phase: "acceptance", activity: "Acceptance", sortOrder: 30, cumulativePercent: 96, activityPercent: 6, criteria: "Biên bản nghiệm thu và toàn bộ hồ sơ giải pháp được duyệt.", upbaseRole: "PM", customerRole: "Customer", slaDays: 1, tasks: [{ title: "Nghiệm thu hệ thống.", subtasks: [] }] }
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
    reviewerMode: "workspace_admin",
    stages: [
      { stageKey: "optimize", phase: "optimize", activity: "Optimize", sortOrder: 10, cumulativePercent: 98, activityPercent: 2, criteria: "Hồ sơ bàn giao cho CS đầy đủ.", upbaseRole: "Dx / PQA", customerRole: "CSM", tasks: [{ title: "Tiếp nhận, phân loại và xử lý các điều chỉnh của khách hàng sau go-live.", subtasks: [] }] },
      { stageKey: "handover", phase: "handover", activity: "Handover", sortOrder: 20, cumulativePercent: 100, activityPercent: 2, criteria: "Có xác nhận bàn giao và ngày Go-live.", upbaseRole: "BD / PM", customerRole: "CSM / Customer", tasks: [{ title: "Chuyển giao dự án cho team CS, sang giai đoạn bảo trì và chăm sóc dài hạn.", subtasks: [] }] }
    ]
  }
] as const;
