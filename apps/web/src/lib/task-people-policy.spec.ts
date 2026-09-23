import { expect, it } from "vitest";
import { allowedPerformers, canLogForWorkspaceMember } from "./task-people-policy";
it("standalone tasks permit self logging and only authorized roles logging for another workspace member", () => {
  const members = [{ id: "self" }, { id: "other" }];
  expect(allowedPerformers(members, "self", canLogForWorkspaceMember(["SALES_OWNER"]))).toEqual([{ id: "self" }]);
  expect(allowedPerformers(members, "self", canLogForWorkspaceMember(["FINANCE_ADMIN", "DELIVERY_LEAD"]))).toEqual(members);
  expect(allowedPerformers(members, "missing", false)).toEqual([]);
  expect(canLogForWorkspaceMember(["FOUNDER_GM"])).toBe(true);
  expect(canLogForWorkspaceMember()).toBe(false);
});
