import { describe, expect, it } from "vitest";
import { milestoneReviewerOptions } from "./milestone-reviewer-options";

describe("milestone reviewer options", () => {
  it("puts workspace admin first and exposes identity details for user reviewers", () => {
    const options = milestoneReviewerOptions([
      {
        id: "user-1",
        displayName: "Nguyễn Hùng Việt Kha",
        email: "kha@example.com",
        roleCodes: ["FOUNDER_GM"],
        teamIds: [],
        avatarUrl: "https://example.com/kha.png"
      }
    ]);

    expect(options[0]).toMatchObject({
      value: "workspace_admin",
      label: "Admin workspace",
      subtext: "Workspace Admin · Quyền duyệt milestone"
    });
    expect(options[1]).toMatchObject({
      value: "user-1",
      label: "Nguyễn Hùng Việt Kha",
      subtext: "Founder Gm · kha@example.com",
      avatarUrl: "https://example.com/kha.png"
    });
  });

  it("keeps a previously selected inactive reviewer visible instead of silently switching to admin", () => {
    const options = milestoneReviewerOptions([], "inactive-user");

    expect(options.at(-1)).toMatchObject({
      value: "inactive-user",
      label: "Người duyệt hiện tại",
      subtext: "Tài khoản không còn active · cần chọn lại"
    });
  });
});
