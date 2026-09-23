import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3003);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const crmPublicSessionRequired = process.env.CRM_PUBLIC_SESSION_REQUIRED ?? "1";
const shouldStartApi = process.env.CRM_E2E_START_API === "1" && !process.env.E2E_BASE_URL;
const apiPort = Number(process.env.CRM_E2E_API_PORT ?? 4000);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const defaultDatabaseUrl = "postgresql://b2b_crm_saas:b2b_crm_saas_ci@127.0.0.1:5432/b2b_crm_saas_ci?schema=public";
const shellEnv = (key: string, value: string) => `${key}=${JSON.stringify(value)}`;
const webCommand = [
  // Match the browser origin even when Next constructs request.url with localhost.
  shellEnv("PUBLIC_WEB_URL", baseURL),
  shellEnv("NEXT_DIST_DIR", process.env.NEXT_DIST_DIR ?? `.next-playwright-${port}`),
  shellEnv("CRM_PUBLIC_SESSION_REQUIRED", crmPublicSessionRequired),
  shellEnv("CRM_DEMO_AUTH_ENABLED", process.env.CRM_DEMO_AUTH_ENABLED ?? "true"),
  shouldStartApi ? shellEnv("CRM_API_INTERNAL_URL", apiBaseUrl) : undefined,
  shouldStartApi ? shellEnv("NEXT_PUBLIC_API_URL", `${apiBaseUrl}/api`) : undefined,
  `pnpm --dir apps/web dev -p ${port}`
].filter(Boolean).join(" ");
const apiCommand = [
  shellEnv("API_PORT", String(apiPort)),
  shellEnv("DATABASE_URL", process.env.DATABASE_URL ?? defaultDatabaseUrl),
  shellEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0"),
  shellEnv("CRM_ENABLE_DEMO_SESSION", process.env.CRM_ENABLE_DEMO_SESSION ?? "true"),
  shellEnv("CRM_LOCAL_AUTH_ENABLED", process.env.CRM_LOCAL_AUTH_ENABLED ?? "true"),
  `pnpm --filter @b2b-crm/api dev:compiled`
].join(" ");

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results/e2e",
  use: {
    baseURL,
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 }
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        ...(shouldStartApi
          ? [
              {
                command: apiCommand,
                url: `${apiBaseUrl}/api/health`,
                reuseExistingServer: false,
                timeout: 120_000
              }
            ]
          : []),
        {
          command: webCommand,
          url: `${baseURL}/login`,
          reuseExistingServer: !process.env.CI && crmPublicSessionRequired !== "1",
          timeout: 120_000
        }
      ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
