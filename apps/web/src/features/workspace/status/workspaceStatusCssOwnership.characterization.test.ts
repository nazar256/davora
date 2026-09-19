import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const cssPath = resolve(sourceRoot, "features/workspace/status/workspaceStatus.css");

describe("workspace status CSS ownership", () => {
  it("keeps status slot layout and offline toggle geometry in its owner", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain(".state-banner-slot");
    expect(css).toContain(".state-banner-slot .banner-state");
    expect(css).toContain(".offline-mode-toggle");
    expect(css).toContain("@media (max-width: 900px)");
  });

  it("loads status styles through the centralized feature layer", () => {
    expect(readFileSync(resolve(sourceRoot, "css-system.css"), "utf8")).toMatch(/@import\s+["']\.\/features\/workspace\/status\/workspaceStatus\.css["']\s+layer\(features\)/);
  });
});
