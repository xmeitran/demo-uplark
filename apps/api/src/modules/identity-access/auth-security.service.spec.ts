import { describe, expect, it, afterEach, vi } from "vitest";
import { AuthSecurityService, hashPassword, verifyPassword, totpAt, matchingTotpStep, newTotpSecret, hashAuthToken } from "./auth-security.service";

describe("native authentication cryptographic boundaries", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("hashes with unique salts and rejects wrong or malformed credentials", async () => {
    const password = "Long test passphrase 123!";
    const hashed = await hashPassword(password);
    expect(hashed).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(await verifyPassword(password, hashed)).toBe(true);
    expect(await verifyPassword("wrong", hashed)).toBe(false);
    expect(await verifyPassword(password, "malformed")).toBe(false);
    expect(await hashPassword(password)).not.toBe(hashed);
    await expect(hashPassword("short")).rejects.toThrow();
    await expect(hashPassword("a".repeat(257))).rejects.toThrow();
    expect(await verifyPassword("a".repeat(257), hashed)).toBe(false);
  }, 15000);
  it("matches RFC6238 SHA1 vector truncated to six digits and enforces time window", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpAt(secret, 1)).toBe("287082");
    expect(matchingTotpStep(secret, "287082", 59000)).toBe(1);
    expect(matchingTotpStep(secret, "287082", 180000)).toBe(null);
    expect(matchingTotpStep(secret, "123", 59000)).toBe(null);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it("encrypts MFA secrets with authenticated user binding and fails without key", () => {
    vi.stubEnv("CRM_AUTH_ENCRYPTION_KEY", "ab".repeat(32));
    const service = new AuthSecurityService({} as any);
    const encoded = service.encrypt("secret", "user-1");
    expect(service.decrypt(encoded, "user-1")).toBe("secret");
    expect(() => service.decrypt(encoded, "user-2")).toThrow();
    const parts = encoded.split("."); parts[1] = Buffer.alloc(16).toString("base64url");
    expect(() => service.decrypt(parts.join("."), "user-1")).toThrow();
    vi.stubEnv("CRM_AUTH_ENCRYPTION_KEY", "bad");
    expect(() => service.encrypt("secret", "user-1")).toThrow("not configured");
  });
  it("enforces shared database rate limit and never stores raw identity", async () => {
    const upsert = vi.fn().mockResolvedValue({ attempts: 11 });
    const service = new AuthSecurityService({ authRateLimit: { upsert } } as any);
    await expect(service.limit("login", "person@example.com", 10)).rejects.toMatchObject({ status: 429 });
    expect(upsert.mock.calls[0][0].where.key).toContain(hashAuthToken("person@example.com"));
    expect(upsert.mock.calls[0][0].where.key).not.toContain("person@");
  });
});
