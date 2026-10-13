/** A response the API answered with a non-2xx status; `message` is the API's own message. */
export class ApiResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiResponseError";
  }
}

/** The API (or the web server in front of it) is asleep, restarting or deploying: nothing was saved, trying again later works. */
export const API_UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
export const API_UNAVAILABLE_MESSAGE = "Máy chủ đang khởi động lại, thử lại sau ít phút. Dữ liệu vừa nhập chưa được lưu.";

/** Build the error for a failed response: `if (!response.ok) throw await readApiError(response)`. `fallback` names the action when the body has no message. */
export async function readApiError(response: Response, fallback?: string) {
  let message = "";
  try {
    const body = await response.json();
    message = Array.isArray(body?.message) ? body.message.join(", ") : typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "";
  } catch {
    // Not JSON: fall through to the generic status message.
  }
  // A gateway page has no message of its own; an action-specific fallback such as "Could not create task: 502" explains nothing.
  if (!message && API_UNAVAILABLE_STATUSES.has(response.status)) message = API_UNAVAILABLE_MESSAGE;
  return new ApiResponseError(message || (fallback ? `${fallback}: ${response.status}` : `Yêu cầu thất bại (${response.status}).`), response.status);
}

/** Message to show the user for a failed write; `fallback` covers failures that never reached the API. */
export function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiResponseError ? error.message : fallback;
}

/**
 * Only a request that never got an answer from the API may be kept as an offline draft:
 * fetch threw, or a gateway in front of the API answered 502/503/504. A rejection (4xx) or an API failure never is.
 */
export function isNetworkFailure(error: unknown) {
  return !(error instanceof ApiResponseError) || [502, 503, 504].includes(error.status);
}
