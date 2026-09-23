export const stageOptions = ["lead", "qualified", "discovery", "solution", "demo", "proposal", "negotiation", "contracting", "won", "lost"];
export const activityTypes = ["follow_up", "meeting", "proposal", "handoff", "risk_review"];

export const bdProcessStatuses = [
  ["L0", "Lead moi / tiep nhan", "BD tiep nhan lead, du thong tin co ban de qualify."],
  ["L1", "Qualify buoc 1", "Fit, need, timeline, authority, budget va next action da ro."],
  ["L2", "Lien he & brief", "Customer contact/brief du de chuyen demo, trial hoac proposal."],
  ["L3", "DX demo/trial prep", "BD + DX chot demo/trial plan hoac solution direction."],
  ["L4", "Demo / Trial / Pitching", "Customer reaction va next step duoc ghi nhan."],
  ["L5", "Proposal / Solution Review", "Proposal package duoc approve hoac co owner revise."],
  ["L6", "Negotiation", "Terms dang thuong luong, co next action ro."],
  ["L7", "Contracting / Signing", "Contract/SOW dang ky, lost reason bat buoc neu fail."],
  ["L8", "Closed Won / Handoff Ready", "Close won can handoff checklist de Delivery review."]
] as const;

export const deploymentStatuses = [
  ["Handoff dang cho", "0%", "BD da close, Delivery chua nhan review."],
  ["Kickoff", "5%", "Kickoff owner va working cadence duoc confirm."],
  ["Analyst", "10%", "Standard/Analyst dang chot requirement."],
  ["Standard", "30%", "Standard delivery dang execute."],
  ["Proposal", "45%", "DX proposal/solution alignment."],
  ["Transform / Build Up", "65%", "Build/up implementation dang chay."],
  ["Prototype", "75%", "Prototype hoac trial output da co."],
  ["Pilot", "90%", "Pilot adoption dang verify."],
  ["Onboarding", "95%", "Go-live enablement gan xong."],
  ["Acceptance", "100%", "Customer acceptance/live close."]
] as const;
