import type {
  ProjectHierarchyOrderInput,
  ProjectHierarchyOrderResponse
} from "@b2b-crm/contracts";
import { isHierarchyOrderResponse } from "./hierarchy-order";

export type HierarchyOrderMutationResult =
  | { ok: true; data: ProjectHierarchyOrderResponse }
  | {
      ok: false;
      status: number;
      message: string;
      canonical?: ProjectHierarchyOrderResponse;
    };

export async function putProjectHierarchyOrder(
  projectId: string,
  input: ProjectHierarchyOrderInput,
  fetcher: typeof fetch = fetch
): Promise<HierarchyOrderMutationResult> {
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectId)}/hierarchy/order`,
    {
      method: "PUT",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    }
  );

  const payload = await response.json().catch(() => null) as unknown;
  if (response.ok && isHierarchyOrderResponse(payload)) {
    return { ok: true, data: payload };
  }

  const errorPayload = payload && typeof payload === "object"
    ? payload as { message?: unknown; current?: unknown; canonical?: unknown }
    : null;
  const canonicalCandidate = errorPayload?.current ?? errorPayload?.canonical;
  return {
    ok: false,
    status: response.status,
    message: typeof errorPayload?.message === "string" && errorPayload.message.trim()
      ? errorPayload.message
      : `Không thể lưu thứ tự (${response.status}).`,
    canonical: isHierarchyOrderResponse(canonicalCandidate) ? canonicalCandidate : undefined
  };
}
