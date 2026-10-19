/**
 * A same-origin path to send the user back to. Browsers strip tab/newline and treat "\" as "/" while parsing, so
 * "/\t/evil.com" or "/\\evil.com" would become "//evil.com" — any control, whitespace or backslash character is refused.
 */
export function isSafeReturnPath(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\/(?![/\\])[^\u0000- \u007F\\]*$/.test(value);
}
