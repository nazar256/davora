import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");

describe("retired account-switcher CSS", () => {
  it("keeps the dead account-switcher namespace absent while retaining live select primitives", () => {
    const globalCss = readFileSync(resolve(sourceRoot, "styles.css"), "utf8") + readFileSync(resolve(sourceRoot, "css/primitives.css"), "utf8") + readFileSync(resolve(sourceRoot, "design-system.css"), "utf8");
    expect(globalCss).not.toContain(".account-switcher");
    expect(globalCss).toContain(".stacked-field select");
    expect(globalCss).toContain("var(--color-surface-raised)");
  });

  it("does not reintroduce a dead producer or import", () => {
    const sources = readFileSync(resolve(sourceRoot, "main.tsx"), "utf8") + readFileSync(resolve(sourceRoot, "css-system.css"), "utf8");
    expect(sources).not.toContain("account-switcher");
  });
});
