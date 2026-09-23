import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceSessionToken,
  shouldFailClosedOnProtectedFallback,
  shouldRequirePublicSession
} from "./crm-public-session-policy";

describe("crm public session policy", () => {
  it("ignores URL session tokens in production", () => {
    expect(
      resolveWorkspaceSessionToken({
        cookieSessionToken: "cookie-token",
        nodeEnv: "production",
        querySessionToken: "url-token"
      })
    ).toBe("cookie-token");

    expect(
      resolveWorkspaceSessionToken({
        nodeEnv: "production",
        querySessionToken: "url-token"
      })
    ).toBeUndefined();
  });

  it("ignores URL session tokens in development as well", () => {
    expect(
      resolveWorkspaceSessionToken({
        cookieSessionToken: "cookie-token",
        nodeEnv: "development",
        querySessionToken: "url-token"
      })
    ).toBe("cookie-token");
  });

  it("requires a public session in production or when explicitly enabled", () => {
    expect(shouldRequirePublicSession({ nodeEnv: "production" })).toBe(true);
    expect(shouldRequirePublicSession({ crmPublicSessionRequired: "1", nodeEnv: "development" })).toBe(true);
    expect(shouldRequirePublicSession({ nodeEnv: "production", sessionToken: "token" })).toBe(false);
    expect(shouldRequirePublicSession({ crmPublicSessionRequired: "0", nodeEnv: "production" })).toBe(true);
  });

  it("fail-closes protected fallback data in production", () => {
    expect(shouldFailClosedOnProtectedFallback({ nodeEnv: "production" })).toBe(true);
    expect(shouldFailClosedOnProtectedFallback({ crmPublicSessionRequired: "1", nodeEnv: "development" })).toBe(true);
    expect(shouldFailClosedOnProtectedFallback({ crmPublicSessionRequired: "0", nodeEnv: "production" })).toBe(true);
    expect(shouldFailClosedOnProtectedFallback({ crmPublicSessionRequired: "0", nodeEnv: "development" })).toBe(true);
    expect(
      shouldFailClosedOnProtectedFallback({
        crmAllowPrincipalFallback: "true",
        crmPublicSessionRequired: "0",
        nodeEnv: "development"
      })
    ).toBe(false);
  });
});
