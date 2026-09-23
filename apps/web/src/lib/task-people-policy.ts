export function canLogForWorkspaceMember(roleCodes: readonly string[] = []) {
  return roleCodes.some(role => role === "FOUNDER_GM" || role === "DELIVERY_LEAD");
}
export function allowedPerformers<T extends { id: string }>(members: T[], principalUserId: string, canLogForOthers: boolean) {
  return members.filter(member => canLogForOthers || member.id === principalUserId);
}
