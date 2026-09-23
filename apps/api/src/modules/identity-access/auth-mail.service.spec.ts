import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthMailService } from "./auth-mail.service";
describe("AuthMailService delivery boundary", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("requires explicit delivery configuration", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CRM_AUTH_MAIL_MODE", "");
    await expect(new AuthMailService().sendAction("test@example.com", "reset", "token")).rejects.toThrow("not configured");
  });
  it("cannot write recovery links to spool in production", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("CRM_AUTH_PUBLIC_ORIGIN", "https://crm.example.com"); vi.stubEnv("CRM_AUTH_MAIL_MODE", "spool");
    await expect(new AuthMailService().sendAction("test@example.com", "reset", "token")).rejects.toThrow("not configured");
  });
  it("writes only private local mail when explicitly enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crm-auth-mail-"));
    try {
      vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CRM_AUTH_PUBLIC_ORIGIN", "http://localhost:3000"); vi.stubEnv("CRM_AUTH_MAIL_MODE", "spool"); vi.stubEnv("CRM_AUTH_MAIL_SPOOL", dir);
      expect(await new AuthMailService().sendAction("test@example.com", "invitation", "private-token")).toBe("spool");
      const [file] = await readdir(dir); const path = join(dir, file);
      const mail = JSON.parse(await readFile(path, "utf8"));
      expect(mail.text).toContain("http://localhost:3000/signup?token=private-token");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
