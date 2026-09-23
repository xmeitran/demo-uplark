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
