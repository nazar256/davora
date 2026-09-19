import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");

describe("folder-cache toast CSS debt", () => {
  it("keeps the retired folder-cache selector absent from production styles", () => {
    const css = readFileSync(resolve(sourceRoot, "styles.css"), "utf8") + readFileSync(resolve(sourceRoot, "css-system.css"), "utf8");
    expect(css).not.toContain(".folder-cache-toast");
  });

  it("keeps the no-toast DOM contract explicit", () => {
    const displayIntegration = readFileSync(resolve(sourceRoot, "features/browsing/workspace/AppBrowsingDisplayIntegration.test.tsx"), "utf8");
    expect(displayIntegration).toContain('querySelector(".folder-cache-toast")');
  });
});
