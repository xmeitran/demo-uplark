import { describe, expect, it } from "vitest";
import { canApproveMilestoneReviewer, normalizeMilestoneReviewerMode } from "./milestone-reviewer";

describe("milestone reviewer policy", () => {
  it("defaults missing or legacy reviewer configuration to workspace admin", () => {
    expect(normalizeMilestoneReviewerMode(undefined)).toBe("workspace_admin");
    expect(normalizeMilestoneReviewerMode("PM")).toBe("workspace_admin");
  });

  it("allows Founder/GM and Workspace Admin for the default policy", () => {
    expect(canApproveMilestoneReviewer({ reviewerMode: "workspace_admin", principalUserId: "admin", principalRoleCodes: ["FOUNDER_GM"] })).toBe(true);
    expect(canApproveMilestoneReviewer({ reviewerMode: "workspace_admin", principalUserId: "admin", principalRoleCodes: ["WORKSPACE_ADMIN"] })).toBe(true);
    expect(canApproveMilestoneReviewer({ reviewerMode: "workspace_admin", principalUserId: "lead", principalRoleCodes: ["DELIVERY_LEAD"] })).toBe(false);
  });

  it("allows only the selected PIC for the specific-user policy", () => {
    const input = { reviewerMode: "specific_user" as const, reviewerUserId: "pic", principalRoleCodes: ["WORKSPACE_ADMIN"] };
    expect(canApproveMilestoneReviewer({ ...input, principalUserId: "pic" })).toBe(true);
    expect(canApproveMilestoneReviewer({ ...input, principalUserId: "other" })).toBe(false);
  });
});
