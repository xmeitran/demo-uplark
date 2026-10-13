/**
 * Role bindings the foundation seed may add on a boot. The seed runs on every API start, so it is additive only:
 * it never ends or rewrites a binding, and a binding that ever existed (active or ended in the Users screen) is left as
 * the workspace's admins set it. Only a configured Workspace Admin who has never held that role gets it.
 */
export function planFoundationRoleGrants(input: {
  founderUserId: string;
  workspaceAdminUserIds: Iterable<string>;
  /** Users that exist; an allow-listed id that has not signed in yet is skipped until it does. */
  existingUserIds: ReadonlySet<string>;
  /** `${userId}:${roleCode}` for every binding row of the workspace, ended ones included. */
  existingBindingKeys: ReadonlySet<string>;
}): Array<{ userId: string; roleCode: "WORKSPACE_ADMIN" }> {
  return [...new Set(input.workspaceAdminUserIds)]
    .filter((userId) => userId !== input.founderUserId && input.existingUserIds.has(userId) && !input.existingBindingKeys.has(`${userId}:WORKSPACE_ADMIN`))
    .map((userId) => ({ userId, roleCode: "WORKSPACE_ADMIN" as const }));
}
