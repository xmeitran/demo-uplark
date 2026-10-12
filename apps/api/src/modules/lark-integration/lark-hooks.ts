/**
 * Where the Lark integration plugs into the rest of the API without touching its logic.
 *
 * - gateHooks / issueLogHooks (delivery-handoff): the members that were left as TODO for Lark are assigned here.
 * - projectLifecycleHooks: called by ProjectsService after a project is created / changed / its status proposal recomputed.
 * - larkAlertDelivery: the Lark channel of the daily alert scan (alerts.service.ts passes it as `deliverLark`).
 *
 * Until LarkIntegrationService registers itself (module init) every hook is a no-op, so unit specs of the other
 * modules are unaffected. Nothing here may throw into a request.
 */
import { gateHooks } from "../delivery-handoff/gates";
import { issueLogHooks } from "../delivery-handoff/issue-log.service";
import type { LarkIntegrationService } from "./lark-integration.service";

const quiet = (label: string, work: () => Promise<unknown>) => {
  void work().catch((error) => console.error(`Lark hook ${label} failed`, error));
};

export const projectLifecycleHooks = {
  /** V-02: after the project is committed. Fire-and-forget: a Lark failure never fails project creation. */
  onProjectCreated(_project: { id: string }, _actor: { subjectId: string; displayName?: string | null }): void {},
  /** After a project update committed: group members follow the project members. */
  onProjectChanged(_projectId: string): void {},
  /** After the status proposal of a project was recomputed (V-17). */
  onStatusProposalChanged(_projectId: string): void {}
};

/** Undefined until registered: the scan then falls back to its own default (deliverLarkAlert, the webhook). */
export const larkAlertDelivery: { deliver?: (message: { title: string; body: string; href: string }) => Promise<string> } = {};

export function registerLarkHooks(service: LarkIntegrationService) {
  projectLifecycleHooks.onProjectCreated = (project, actor) => quiet("onProjectCreated", () => service.ensureProjectGroups(project.id, { actorUserId: actor.subjectId, actorName: actor.displayName }));
  projectLifecycleHooks.onProjectChanged = (projectId) => quiet("onProjectChanged", () => service.syncProjectGroupMembers(projectId));
  projectLifecycleHooks.onStatusProposalChanged = (projectId) => quiet("onStatusProposalChanged", () => service.sweepProject(projectId));
  larkAlertDelivery.deliver = (message) => service.deliverProjectAlert(message);

  // V-11 / V-15 "Hồ sơ chuyển tiếp" and V-14 "Xác nhận khách hàng": both are announced by the same idempotent sweep.
  gateHooks.notifyApprovers = async ({ project }) => { await service.sweepProject(project.id); };
  gateHooks.sendCustomerConfirmationRequest = async ({ project }) => { await service.sweepProject(project.id); };
  // 7.5 "Sổ vấn đề dự án".
  issueLogHooks.sendLarkMessage = async ({ record, project }) => { await service.announceIssueLogEvent(record, project); };
}
