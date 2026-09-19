import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const cssPath = resolve(sourceRoot, "features/pwa/reloadPrompt.css");

describe("PWA reload prompt CSS ownership", () => {
  it("keeps toast presentation and mobile placement in the PWA owner", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain(".toast");
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("position");
  });

  it("loads the prompt through the centralized feature layer", () => {
    expect(readFileSync(resolve(sourceRoot, "css-system.css"), "utf8")).toMatch(/@import\s+["']\.\/features\/pwa\/reloadPrompt\.css["']\s+layer\(features\)/);
  });
});
