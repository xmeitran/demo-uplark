import { describe, expect, it, vi } from "vitest";
import { buildAllowedCorsOrigins, buildCorsOptions, configureAppSecurity, isCorsOriginAllowed } from "./bootstrap-security";

describe("bootstrap security policy", () => {
  it("builds production CORS allowlist from product defaults and configured URL origins", () => {
    expect(
      buildAllowedCorsOrigins({
        NODE_ENV: "production",
        CRM_API_CORS_ORIGINS: "https://customer.example, https://ops.example/path",
        NEXT_PUBLIC_API_URL: "https://b2b-crm.mindtheoperation.com/api"
      })
    ).toEqual([
      "https://b2b-crm.mindtheoperation.com",
      "https://lark-upbase.mindtheoperation.com",
      "https://customer.example",
      "https://ops.example"
    ]);
  });

  it("rejects unknown browser origins in production while allowing originless internal calls", () => {
    const env = { NODE_ENV: "production" };

    expect(isCorsOriginAllowed(undefined, env)).toBe(true);
    expect(isCorsOriginAllowed("https://b2b-crm.mindtheoperation.com", env)).toBe(true);
    expect(isCorsOriginAllowed("https://evil.example", env)).toBe(false);
    expect(isCorsOriginAllowed("http://localhost:3004", env)).toBe(false);
  });

  it("allows localhost only outside production", () => {
    expect(isCorsOriginAllowed("http://localhost:3004", { NODE_ENV: "development" })).toBe(true);
    expect(isCorsOriginAllowed("http://127.0.0.1:4400", { NODE_ENV: "test" })).toBe(true);
  });

  it("does not emit wildcard CORS for rejected origins", () =>
    new Promise<void>((resolve, reject) => {
      const corsOptions = buildCorsOptions({ NODE_ENV: "production" });

      if (typeof corsOptions.origin !== "function") {
        reject(new Error("Expected function origin policy"));
        return;
      }

      corsOptions.origin("https://evil.example", (error, value) => {
        try {
          expect(error).toBeNull();
          expect(value).toBe(false);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    }));

  it("disables the Express fingerprint header before enabling CORS", () => {
    const disabled: string[] = [];
    const app = {
      enableCors: vi.fn(),
      getHttpAdapter: () => ({
        getInstance: () => ({
          disable: (header: string) => disabled.push(header)
        })
      })
    };

    configureAppSecurity(app as any);

    expect(disabled).toEqual(["x-powered-by"]);
    expect(app.enableCors).toHaveBeenCalledOnce();
  });
});
