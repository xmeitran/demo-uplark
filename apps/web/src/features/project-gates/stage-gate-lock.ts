/**
 * Which stages wait for a gate (rule V-11): a stage after a gate that is not approved (or opened by exception) cannot
 * be started and takes no time logs. The API enforces it (delivery-handoff/gates.ts, blockingGateForStage); this view
 * helper only lets the screens say so before the user tries, and name the gate to approve.
 */
import { useEffect, useState } from "react";

export const GATE_TAB_LABEL = "Điểm chốt & Tài liệu";

export interface StageGateBlock { code: string; name: string }
export type StageGateBlocks = Record<string, StageGateBlock>;

interface GateLike { stageId: string; status: string; code: string; definition?: { name?: string } }
interface StageLike { id: string; sortOrder?: number; milestoneSortOrder?: number; changeRequestId?: string | null }

const isGatePassed = (status: string) => status === "approved" || status === "exception";

/** Stage id -> the nearest gate on an earlier stage that is not passed. A stage an old change request created (changeRequestId, data before 13/10/2026) is outside the sequence. */
export function stageGateBlocks(stages: readonly StageLike[], gates: readonly GateLike[]): StageGateBlocks {
  const ordered = stages.filter((stage) => !stage.changeRequestId)
    .slice().sort((left, right) => (left.milestoneSortOrder ?? 0) - (right.milestoneSortOrder ?? 0) || (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  const blocks: StageGateBlocks = {};
  let waiting: StageGateBlock | null = null;
  for (const stage of ordered) {
    if (waiting) blocks[stage.id] = waiting;
    const gate = gates.find((item) => item.stageId === stage.id);
    if (gate) waiting = isGatePassed(gate.status) ? null : { code: gate.code, name: gate.definition?.name ?? "" };
  }
  return blocks;
}

export function gateBlockLabel(block: StageGateBlock) {
  return `Điểm chốt ${block.code}${block.name ? ` (${block.name})` : ""}`;
}

/** One sentence for a tooltip or an inline note, e.g. gateBlockNote(block, "ghi giờ"). */
export function gateBlockNote(block: StageGateBlock, action: string) {
  return `${gateBlockLabel(block)} chưa được duyệt nên chưa thể ${action}. Duyệt điểm chốt ở tab ${GATE_TAB_LABEL} của dự án.`;
}

export async function loadStageGateBlocks(projectId: string, signal?: AbortSignal): Promise<StageGateBlocks> {
  const get = async (path: string) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/${path}`, { cache: "no-store", credentials: "same-origin", signal });
    return response.ok ? response.json() : null;
  };
  const rows = (body: any) => Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  const [stages, gates] = await Promise.all([get("stages"), get("gates")]);
  // "Không duyệt": no stage waits for a gate (the API skips the check the same way).
  if (gates?.milestoneApprovalRequired === false) return {};
  return stageGateBlocks(rows(stages), rows(gates));
}

/** Blocks of one project; empty while loading, for a project without gates, or when the read fails (the API still decides). */
export function useStageGateBlocks(projectId: string | null | undefined, refreshKey: unknown = ""): StageGateBlocks {
  const [blocks, setBlocks] = useState<StageGateBlocks>({});
  useEffect(() => {
    if (!projectId) { setBlocks({}); return; }
    const controller = new AbortController();
    loadStageGateBlocks(projectId, controller.signal).then((next) => { if (!controller.signal.aborted) setBlocks(next); }).catch(() => undefined);
    return () => controller.abort();
  }, [projectId, refreshKey]);
  return blocks;
}
