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

  it("disables browser-native pull-to-refresh so the app gesture is the only refresh path", () => {
    const reset = readFileSync(resolve(sourceRoot, "styles.css"), "utf8");
    const fileList = readFileSync(resolve(sourceRoot, "features/browsing/fileList/fileList.css"), "utf8");
    expect(reset).toContain("overscroll-behavior-y: none");
    expect(fileList).toContain("overscroll-behavior: contain");
  });
});
