import { describe, expect, it } from "vitest";
import { isActiveMembership } from "./active-membership";
describe("effective membership interval", () => {
  const now = new Date("2026-09-06T00:00:00Z");
  it("allows a current membership scheduled to end later", () => {
    expect(isActiveMembership({ startsAt: new Date(now.getTime() - 1), endsAt: new Date(now.getTime() + 1) }, now)).toBe(true);
  });
  it("rejects future-start and ended memberships", () => {
    expect(isActiveMembership({ startsAt: new Date(now.getTime() + 1), endsAt: null }, now)).toBe(false);
    expect(isActiveMembership({ startsAt: now, endsAt: now }, now)).toBe(false);
  });

});
