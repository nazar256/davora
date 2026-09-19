import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const cssPath = resolve(sourceRoot, "features/browsing/browseHeader/browseHeader.css");
const entryPath = resolve(sourceRoot, "css-system.css");

describe("browse-header CSS ownership", () => {
  it("keeps browse header, upload, and responsive controls together", () => {
    const css = readFileSync(cssPath, "utf8");
    for (const selector of [".browse-header", ".browse-header-main", ".browse-header-controls", ".browse-title-row", ".upload-label", ".drop-upload-note", ".file-size-toolbar-field"]) expect(css).toContain(selector);
    expect(css).toContain(":focus-within");
    expect(css).toContain("@media (max-width: 900px)");
  });

  it("loads exactly once through the features cascade layer", () => {
    const entry = readFileSync(entryPath, "utf8");
    expect((entry.match(/browseHeader\.css/g) ?? []).length).toBe(1);
    expect(entry).toMatch(/@import\s+["']\.\/features\/browsing\/browseHeader\/browseHeader\.css["']\s+layer\(features\)/);
  });
});
