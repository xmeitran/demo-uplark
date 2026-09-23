import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration-spec.ts"],
    exclude: [...configDefaults.exclude, "**/._*"],
    environment: "node",
    testTimeout: 30000
  }
});
