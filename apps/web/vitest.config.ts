import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "**/._*"],
    include: ["src/**/*.spec.ts"]
  },
  resolve: {
    alias: {
      "@b2b-crm/contracts": resolve(rootDir, "packages/contracts/src/index.ts"),
      "@b2b-crm/ui-tokens": resolve(rootDir, "packages/ui-tokens/src/index.ts")
    }
  }
});
