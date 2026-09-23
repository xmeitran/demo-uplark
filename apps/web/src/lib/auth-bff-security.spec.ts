import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginAuthRequest, resolveAuthPublicOrigin, redactAuthCredentials, safeAuthReturnTo } from "./auth-bff-security";
afterEach(() => vi.unstubAllEnvs());
describe("auth browser trust boundary", () => {
  it("requires an explicit matching origin and rejects cross-site metadata", () => {
    vi.stubEnv("PUBLIC_WEB_URL", "http://localhost:3000");
    const req = (headers: Record<string,string>) => new Request("http://localhost:3000/api/auth/native/password/login", { method:"POST", headers });
    expect(isSameOriginAuthRequest(req({origin:"http://localhost:3000"}))).toBe(true);
    expect(isSameOriginAuthRequest(req({origin:"https://evil.test"}))).toBe(false);
    expect(isSameOriginAuthRequest(req({origin:"null"}))).toBe(false);
    expect(isSameOriginAuthRequest(req({}))).toBe(false);
    expect(isSameOriginAuthRequest(req({origin:"http://localhost:3000","sec-fetch-site":"cross-site"}))).toBe(false);
    expect(isSameOriginAuthRequest(req({origin:"https://evil.test","x-forwarded-host":"evil.test"}))).toBe(false);
  });
  it("never exposes session or challenge bearer credentials to browser JSON", () => {
    expect(redactAuthCredentials({token:"secret",expiresAt:"later",principal:{subjectId:"user"}})).toEqual({expiresAt:"later",principal:{subjectId:"user"}});
    expect(redactAuthCredentials({mfaRequired:true,challengeToken:"secret"})).toEqual({mfaRequired:true});
    expect(redactAuthCredentials({session:{token:"secret",expiresAt:"later"},accepted:true})).toEqual({session:{expiresAt:"later"},accepted:true});
  });
  it("rejects external and browser-normalized redirect paths", () => {
    for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/login", "/\r\nevil"]) expect(safeAuthReturnTo(path)).toBe("/");
    expect(safeAuthReturnTo("/settings?tab=security")).toBe("/settings?tab=security");
  });
});


describe("allowlisted reverse-proxy auth origins", () => {
  const primary = "https://b2b-crm.example.test";
  const secondary = "https://lark-crm.example.test";
  function configure() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_WEB_URL", "");
    vi.stubEnv("CRM_AUTH_PUBLIC_ORIGIN", primary);
    vi.stubEnv("LARK_OAUTH_REDIRECT_URIS", `${primary}/api/auth/lark/callback,${secondary}/api/auth/lark/callback`);
  }
  function forwarded(host: string, origin: string, proto = "https") {
    return new Request("https://localhost:3000/api/auth/password/login", {
      method: "POST", headers: { "X-Forwarded-Host": host, "X-Forwarded-Proto": proto, Origin: origin }
    });
  }
  it.each(["b2b-crm.example.test", "lark-crm.example.test"])("preserves public host %s behind an internal Next URL", (host) => {
    configure();
    const request = forwarded(host, `https://${host}`);
    expect(resolveAuthPublicOrigin(request)).toBe(`https://${host}`);
    expect(isSameOriginAuthRequest(request)).toBe(true);
  });
  it("does not treat two allowed hosts as the same browser origin", () => {
    configure();
    expect(isSameOriginAuthRequest(forwarded("b2b-crm.example.test", secondary))).toBe(false);
  });
  it.each(["evil.test", "b2b-crm.example.test.evil.test", "b2b-crm.example.test,evil.test", "b2b-crm.example.test/path", "b2b-crm.example.test@evil.test", "b2b-crm.example.test:8443", "b2b-crm.example.test?x=1"])("rejects untrusted or malformed forwarded host %s", (host) => {
    configure();
    const request = forwarded(host, primary);
    expect(resolveAuthPublicOrigin(request)).toBeUndefined();
    expect(isSameOriginAuthRequest(request)).toBe(false);
  });
  it.each(["http", "https,http", "ftp"])("rejects invalid production forwarded protocol %s", (proto) => {
    configure();
    expect(resolveAuthPublicOrigin(forwarded("b2b-crm.example.test", primary, proto))).toBeUndefined();
  });
  it("fails closed for incomplete forwarding headers and an unconfigured internal origin", () => {
    configure();
    expect(resolveAuthPublicOrigin(new Request("https://localhost:3000", { headers: { "x-forwarded-host": "b2b-crm.example.test" } }))).toBeUndefined();
    expect(resolveAuthPublicOrigin(new Request("https://localhost:3000"))).toBeUndefined();
  });
  it("supports an explicit single canonical origin without forwarding headers", () => {
    configure();
    vi.stubEnv("PUBLIC_WEB_URL", primary);
    expect(resolveAuthPublicOrigin(new Request("https://localhost:3000"))).toBe(primary);
    expect(resolveAuthPublicOrigin(forwarded("evil.test", primary))).toBeUndefined();
  });
  it("retains direct loopback development without trusting arbitrary remote hosts", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PUBLIC_WEB_URL", "");
    vi.stubEnv("CRM_AUTH_PUBLIC_ORIGIN", "");
    vi.stubEnv("LARK_OAUTH_REDIRECT_URIS", "");
    const request = new Request("http://127.0.0.1:3903/api/auth/password/login", { headers: { Origin: "http://127.0.0.1:3903" } });
    expect(resolveAuthPublicOrigin(request)).toBe("http://127.0.0.1:3903");
    expect(isSameOriginAuthRequest(request)).toBe(true);
    expect(resolveAuthPublicOrigin(new Request("http://evil.test"))).toBeUndefined();
  });
  it("rejects credential-bearing or path-bearing browser Origin values", () => {
    configure();
    expect(isSameOriginAuthRequest(forwarded("b2b-crm.example.test", primary + "/path"))).toBe(false);
    expect(isSameOriginAuthRequest(forwarded("b2b-crm.example.test", "https://user@b2b-crm.example.test"))).toBe(false);
  });
  it("requires explicit harness origin for differing internal and forwarded loopback hostnames", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PUBLIC_WEB_URL", "");
    vi.stubEnv("CRM_AUTH_PUBLIC_ORIGIN", "");
    vi.stubEnv("LARK_OAUTH_REDIRECT_URIS", "");
    const request = new Request("http://localhost:3903/api/auth/demo/session", { headers: {
      Origin: "http://127.0.0.1:3903", "x-forwarded-host": "127.0.0.1:3903", "x-forwarded-proto": "http"
    } });
    expect(isSameOriginAuthRequest(request)).toBe(false);
    vi.stubEnv("PUBLIC_WEB_URL", "http://127.0.0.1:3903");
    expect(isSameOriginAuthRequest(request)).toBe(true);
  });

});
