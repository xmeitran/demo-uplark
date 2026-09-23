import type { AccountSummary, ContactSummary } from "@b2b-crm/contracts";
import { toIso, toMoneyNumber } from "../../shared/http/request-context";

export function mapAccountSummary(account: any): AccountSummary {
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
    annualValue: toMoneyNumber(account.annualValue),
    commercialNote: account.commercialNote ?? undefined
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
  if (["churn_risk", "blocked", "red"].includes(stage)) {
    return "red";
  }
  if (["implementation", "expansion", "negotiation", "amber"].includes(stage)) {
    return "amber";
  }

  return "green";
}
