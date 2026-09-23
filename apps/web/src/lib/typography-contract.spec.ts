import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = process.cwd();
const repositoryRoot = resolve(webRoot, "../..");
const typographyContractTest = resolve(webRoot, "src/lib/typography-contract.spec.ts");

function read(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (!/\.(?:css|js|ts|tsx)$/.test(entry.name) || path === typographyContractTest) return [];
    return [path];
  });
}

describe("global typography contract", () => {
  it("loads Be Vietnam Pro once and maps both sans and mono tokens to it", () => {
    const layout = read("apps/web/app/layout.tsx");
    const globals = read("apps/web/app/globals.css");
    const tailwind = read("apps/web/tailwind.config.js");
    const sharedTokens = read("packages/ui-tokens/src/tokens.css");

    expect(layout).toContain('import { Be_Vietnam_Pro } from "next/font/google"');
    expect(layout).toMatch(/subsets:\s*\["latin",\s*"vietnamese"\]/);
    expect(layout).toContain('variable: "--font-be-vietnam-pro"');
    expect(layout).toContain('display: "swap"');
    expect(layout).toContain('weight: ["400", "500", "600", "700", "800", "900"]');
    expect(layout).toContain('style: ["normal", "italic"]');
    expect(layout).toContain("preload: false");
    expect(globals).not.toContain("fonts.googleapis.com");
    expect(globals).toContain("--font-sans: var(--font-be-vietnam-pro, \"Be Vietnam Pro\"), \"Be Vietnam Pro\", sans-serif;");
    expect(globals).toContain("--font-mono: var(--font-be-vietnam-pro, \"Be Vietnam Pro\"), \"Be Vietnam Pro\", sans-serif;");
    expect(tailwind.match(/var\(--font-be-vietnam-pro, "Be Vietnam Pro"\)/g)).toHaveLength(2);
    expect(sharedTokens).toContain("--font-sans: var(--font-be-vietnam-pro, \"Be Vietnam Pro\"), \"Be Vietnam Pro\", sans-serif;");
    expect(sharedTokens).toContain("--font-mono: var(--font-be-vietnam-pro, \"Be Vietnam Pro\"), \"Be Vietnam Pro\", sans-serif;");
  });

  it("does not allow legacy font families to override the Be Vietnam Pro tokens", () => {
    const sourceFiles = [
      ...collectSourceFiles(resolve(webRoot, "app")),
      ...collectSourceFiles(resolve(webRoot, "src")),
      ...collectSourceFiles(resolve(repositoryRoot, "packages/ui-tokens/src"))
    ];
    const forbiddenOverride = /--font-inter|\bInter\b|Nunito|JetBrains(?:\s+Mono)?|font-family\s*:\s*(?:monospace|system-ui|ui-monospace)|fontFamily\s*:\s*["'](?:monospace|system-ui|ui-monospace)/;
    const violations = sourceFiles.flatMap((path) => {
      const content = readFileSync(path, "utf8");
      return forbiddenOverride.test(content) ? [path.replace(`${repositoryRoot}/`, "")] : [];
    });

    expect(violations).toEqual([]);
    expect(existsSync(resolve(webRoot, "src/components/app-shadow-font-runtime.tsx"))).toBe(true);
    expect(existsSync(resolve(webRoot, "src/components/nunito-shadow-font-runtime.tsx"))).toBe(false);
  });
});
