export interface ProjectCreateAttempt { payload?: string; key?: string }
/** Retry an unchanged submission with the same server receipt key, including after transport failure. */
export function postProject(attempt: ProjectCreateAttempt, payload: unknown, fetcher: typeof fetch = fetch) {
  const body = JSON.stringify(payload);
  if (attempt.payload !== body || !attempt.key) { attempt.payload = body; attempt.key = crypto.randomUUID(); }
  return fetcher("/api/projects", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "Idempotency-Key": attempt.key }, body });
}
