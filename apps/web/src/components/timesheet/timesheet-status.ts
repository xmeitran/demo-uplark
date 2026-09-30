import type { NodeStatus } from "./timesheet-types";

export function normalizeNodeStatus(value?: string): NodeStatus {
  const normalized = String(value ?? "").toLowerCase();
  if (["done", "completed", "complete", "closed"].includes(normalized)) return "completed";
  if (["waiting", "pending", "on_hold", "on-hold"].includes(normalized)) return "waiting";
  if (["in_progress", "in-progress", "in progress", "doing"].includes(normalized)) return "in_progress";
  if (["blocked", "blocking"].includes(normalized)) return "blocked";
  return "not_started";
}
