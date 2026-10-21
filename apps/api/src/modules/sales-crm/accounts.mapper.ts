import type { AccountSummary, ContactSummary } from "@b2b-crm/contracts";
import { toIso, toMoneyNumber } from "../../shared/http/request-context";

/** `canViewMoney`: the annual value is a money figure, shown only to the cost permission group (`canViewCost`).
 *  `internal`: the commercial note is an internal remark, never sent to a portal (customer) user. */
export function mapAccountSummary(account: any, canViewMoney: boolean, internal = true): AccountSummary {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    stage: account.stage,
    ownerTeam: account.ownerTeam?.name ?? account.ownerTeam?.code ?? account.ownerTeamId ?? "unassigned",
    picUserId: account.picUserId ?? undefined,
    picName: account.picUser?.displayName ?? undefined,
    picEmail: account.picUser?.email ?? undefined,
    picAvatarUrl: account.picUser?.avatarUrl ?? undefined,
    health: inferAccountHealth(account.stage),
    ...(canViewMoney ? { annualValue: toMoneyNumber(account.annualValue) } : {}),
    commercialNote: internal ? account.commercialNote ?? undefined : undefined,
    createdAt: toIso(account.createdAt) ?? undefined
  };
}

export function mapContactSummary(contact: any): ContactSummary {
  return {
    id: contact.id,
    accountId: contact.accountId,
    accountName: contact.account?.name ?? "",
    name: contact.name,
    email: contact.email ?? undefined,
    phone: contact.phone ?? undefined,
    role: contact.role ?? undefined,
    influence: contact.influence ?? undefined,
    createdAt: toIso(contact.createdAt) ?? new Date().toISOString()
  };
}

function inferAccountHealth(stage: string): AccountSummary["health"] {
  // A churned / lost client is not "Healthy"; a client that is not a customer yet is not green either.
  if (["churn_risk", "churned", "lost", "blocked", "red"].includes(stage)) {
    return "red";
  }
  if (["new", "prospect", "implementation", "expansion", "negotiation", "amber"].includes(stage)) {
    return "amber";
  }

  return "green";
}
