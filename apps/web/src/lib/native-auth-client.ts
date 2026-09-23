export async function authRequest<T = Record<string, unknown>>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(`/api/auth/native/${path}`, { method, cache: "no-store", credentials: "same-origin", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "Unable to complete this request. Please try again.");
  return data as T;
}
