import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const cssPath = resolve(sourceRoot, "features/offline/sync/confirm/offlineSyncConfirm.css");

describe("offline-sync confirmation CSS ownership", () => {
  it("keeps the dialog action layout and narrow-screen behavior in its owner", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain(".offline-sync-dialog .dialog-actions");
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
  });

  it("is imported only through the feature cascade", () => {
    const entry = readFileSync(resolve(sourceRoot, "css-system.css"), "utf8");
    expect(entry).toMatch(/@import\s+["']\.\/features\/offline\/sync\/confirm\/offlineSyncConfirm\.css["']\s+layer\(features\)/);
  });
});
