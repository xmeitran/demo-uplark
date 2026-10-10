/** A response the API answered with a non-2xx status; `message` is the API's own message. */
export class ApiResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiResponseError";
  }
}

/** Build the error for a failed response: `if (!response.ok) throw await readApiError(response)`. */
export async function readApiError(response: Response) {
  let message = "";
  try {
    const body = await response.json();
    message = Array.isArray(body?.message) ? body.message.join(", ") : typeof body?.message === "string" ? body.message : "";
  } catch {
    // Not JSON: fall through to the generic status message.
  }
  return new ApiResponseError(message || `Yêu cầu thất bại (${response.status}).`, response.status);
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
