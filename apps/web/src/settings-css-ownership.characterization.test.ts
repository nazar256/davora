import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import postcss, { type AtRule, type Root } from "postcss";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const settingsCssPath = resolve(sourceRoot, "features/settings/settingsDialog/settingsDialog.css");
const settingsStagePath = resolve(sourceRoot, "features/settings/settingsDialog/SettingsDialogStage.tsx");
const cacheStagePath = resolve(sourceRoot, "features/settings/settingsDialog/CachePanel.tsx");
const entryPath = resolve(sourceRoot, "css-system.css");

const settingsClasses = [
  "settings-modal-scrim", "settings-dialog", "settings-dialog-header", "settings-dialog-heading", "settings-grid",
  "settings-section", "settings-close-button", "theme-mode-control", "cache-panel", "cache-summary", "cache-limit-field",
  "cache-limit-controls", "cache-limit-slider-field", "cache-limit-manual-field", "cache-limit-slider-summary",
  "cache-limit-manual-row", "cache-limit-scale", "cache-details", "cache-metadata"
] as const;

function selectors(css: string): string[] {
  const result: string[] = [];
  function visit(container: Root | AtRule): void {
    for (const node of container.nodes ?? []) {
      if (node.type === "rule") result.push(...node.selector.split(",").map((selector) => selector.trim()));
      else if (node.type === "atrule" && node.nodes) visit(node);
    }
  }
  visit(postcss.parse(css));
  return result;
}

describe("SettingsDialog and CachePanel CSS ownership", () => {
  it("keeps settings and cache namespaces in their feature stylesheet", () => {
    const css = readFileSync(settingsCssPath, "utf8");
    const allSelectors = selectors(css).join("\n");
    for (const className of settingsClasses) expect(allSelectors, `missing .${className}`).toContain(`.${className}`);
    const globalSelectors = selectors(readFileSync(resolve(sourceRoot, "styles.css"), "utf8") + readFileSync(resolve(sourceRoot, "design-system.css"), "utf8"));
    expect(globalSelectors.filter((selector) => selector.trim().startsWith(".settings-dialog"))).toEqual([]);
  });

  it("maps every emitted settings/cache class to its producing stage", () => {
    const settingsStage = readFileSync(settingsStagePath, "utf8");
    const cacheStage = readFileSync(cacheStagePath, "utf8");
    for (const className of settingsClasses.slice(0, 8)) expect(settingsStage).toContain(className);
    for (const className of settingsClasses.slice(8)) expect(cacheStage).toContain(className);
    expect(settingsStage).toContain("cache-limit-manual-row");
  });

  it("loads settings after operations and before transfer/browsing feature owners", () => {
    const entry = readFileSync(entryPath, "utf8");
    const settings = entry.indexOf("./features/settings/settingsDialog/settingsDialog.css");
    const operations = entry.indexOf("./features/operations/actionDialog/actionDialog.css");
    const transfer = entry.indexOf("./features/transfers/tray/transferTray.css");
    expect(settings).toBeGreaterThan(operations);
    expect(settings).toBeLessThan(transfer);
  });

  it("retains keyboard/focus and compact-layout behavior through shared primitives", () => {
    const primitives = readFileSync(resolve(sourceRoot, "design-system.css"), "utf8");
    const settings = readFileSync(settingsCssPath, "utf8");
    expect(primitives).toContain(":focus-visible");
    expect(settings).toContain("@media (max-width: 900px)");
    expect(settings).toContain("min-height");
  });
});
