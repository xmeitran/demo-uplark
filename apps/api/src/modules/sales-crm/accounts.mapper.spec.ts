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
      commercialNote: "Enterprise pilot"
    });

    expect(account).toMatchObject({
      id: "acc-1",
      code: "ACME",
      ownerTeam: "Delivery",
      picName: "Kha Nguyen",
      health: "amber",
      annualValue: 120000000
    });
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
