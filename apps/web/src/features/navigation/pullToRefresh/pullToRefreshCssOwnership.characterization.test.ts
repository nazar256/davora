import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const cssPath = resolve(sourceRoot, "features/navigation/pullToRefresh/pullToRefresh.css");
const entryPath = resolve(sourceRoot, "css-system.css");

describe("pull-to-refresh CSS ownership", () => {
  it("keeps indicator and spinner geometry in the navigation feature owner", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain(".pull-to-refresh-indicator");
    expect(css).toContain(".pull-to-refresh-spinner");
    expect(css).toContain(".pull-to-refresh-spinner::before");
    expect(css).toContain("transform");
  });

  it("loads through the centralized features layer", () => {
    expect(readFileSync(entryPath, "utf8")).toMatch(/@import\s+["']\.\/features\/navigation\/pullToRefresh\/pullToRefresh\.css["']\s+layer\(features\)/);
  });
});
