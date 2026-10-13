import { describe, expect, it } from "vitest";
import { mapAccountSummary, mapContactSummary } from "./accounts.mapper";

describe("accounts.mapper", () => {
  it("maps account records into the public client summary contract", () => {
    const account = mapAccountSummary({
      id: "acc-1",
      code: "ACME",
      name: "Acme Co",
      stage: "implementation",
      ownerTeamId: "team-delivery",
      ownerTeam: { code: "DEL", name: "Delivery" },
      picUserId: "usr-1",
      picUser: { displayName: "Kha Nguyen", email: "kha@example.com", avatarUrl: null },
      annualValue: { toNumber: () => 120000000 },
      commercialNote: "Enterprise pilot",
      createdAt: new Date("2026-10-01T03:00:00.000Z")
    }, true);

    expect(account).toMatchObject({
      id: "acc-1",
      code: "ACME",
      ownerTeam: "Delivery",
      picName: "Kha Nguyen",
      health: "amber",
      annualValue: 120000000,
      createdAt: "2026-10-01T03:00:00.000Z"
    });
  });

  it("leaves the annual value out for a viewer without the cost permission", () => {
    const account = mapAccountSummary({ id: "acc-1", code: "ACME", name: "Acme Co", stage: "new", annualValue: { toNumber: () => 120000000 } }, false);
    expect(account).not.toHaveProperty("annualValue");
    expect(account).toMatchObject({ id: "acc-1", name: "Acme Co" });
  });

  it("maps contacts with account context", () => {
    const contact = mapContactSummary({
      id: "ct-1",
      accountId: "acc-1",
      account: { name: "Acme Co" },
      name: "Linh Tran",
      email: "linh@example.com",
      phone: null,
      role: "Sponsor",
      influence: "high",
      createdAt: new Date("2026-06-30T02:00:00.000Z")
    });

    expect(contact).toEqual({
      id: "ct-1",
      accountId: "acc-1",
      accountName: "Acme Co",
      name: "Linh Tran",
      email: "linh@example.com",
      phone: undefined,
      role: "Sponsor",
      influence: "high",
      createdAt: "2026-06-30T02:00:00.000Z"
    });
  });
});
