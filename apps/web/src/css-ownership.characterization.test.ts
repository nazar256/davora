import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import postcss, { type AtRule, type Root, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const entryPath = resolve(sourceRoot, "css-system.css");
const mainPath = resolve(sourceRoot, "main.tsx");

const featureSheets = [
  "features/workspace/status/workspaceStatus.css",
  "features/navigation/pullToRefresh/pullToRefresh.css",
  "features/offline/sync/confirm/offlineSyncConfirm.css",
  "features/pwa/reloadPrompt.css",
  "features/accounts/accountSurfaces.css",
  "features/browsing/browseHeader/browseHeader.css",
  "features/preview/shell/previewShell.css",
  "features/preview/image/imagePreview.css",
  "features/preview/pdf/pdfPreview.css",
  "features/preview/media/mediaPreview.css",
  "features/preview/folderAudio/folderAudio.css",
  "features/operations/selection/selectionDetails.css",
  "features/operations/destination/destinationPicker.css",
  "features/operations/actionDialog/actionDialog.css",
  "features/settings/settingsDialog/settingsDialog.css",
  "features/transfers/tray/transferTray.css",
  "features/browsing/fileList/fileList.css",
  "features/browsing/favourites/favourites.css",
  "features/browsing/appBar/appBar.css",
  "features/browsing/navDrawer/navDrawer.css"
] as const;

const sharedPrimitiveSelectors = new Set([
  ":root", "*", "body", "button", "input", "textarea", ".shell", ".panel", ".panel-subtle", ".dialog-card",
  ".modal-scrim", ".subtitle", ".status", ".meta", ".dialog-copy", ".breadcrumb-separator", ".eyebrow",
  ".section-eyebrow", ".action-group-label", ".summary-label", ".breadcrumbs button", ".panel-header button",
  ".preview-header button", ".toast button", ".quiet-button", ".stacked-field select", ".metadata div",
  ".metadata dt", ".metadata dd", ".empty", ".empty-state", "button:hover", "summary:hover",
  "button:focus-visible", "summary:focus-visible", ".badge.online", ".operation-pill.enabled", ".badge.offline",
  ".operation-pill.disabled", ".badge.secondary", ".operation-pill.secondary", ".banner-state.loading",
  ".banner-state.error", ".banner-state.permission", ".banner-state.offline", ".banner-state.stale",
  ".toolbar-search", ".item-icon"
]);

function importedLayers(css: string): Array<{ path: string; layer: string }> {
  return [...css.matchAll(/@import\s+["']([^"']+)["']\s+layer\(([^)]+)\)\s*;/g)]
    .map((match) => ({ path: match[1] ?? "", layer: match[2]?.trim() ?? "" }));
}

function declarations(css: string): string {
  const values: string[] = [];
  function visit(container: Root | AtRule | Rule): void {
    for (const node of container.nodes ?? []) {
      if (node.type === "decl") values.push(`${node.prop}:${node.value}${node.important ? " !important" : ""}`);
      else if ((node.type === "rule" || node.type === "atrule") && node.nodes) visit(node);
    }
  }
  visit(postcss.parse(css));
  return values.join(";");
}

function rawColorCount(css: string): number {
  return (css.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\([^)]*\)/g) ?? []).length;
}

function selectors(css: string): string[] {
  const values: string[] = [];
  function visit(container: Root | AtRule): void {
    for (const node of container.nodes ?? []) {
      if (node.type === "rule") values.push(...node.selector.split(",").map((selector) => selector.trim()));
      else if (node.type === "atrule" && node.nodes) visit(node);
    }
  }
  visit(postcss.parse(css));
  return values;
}

function globalSelectorSources(): Map<string, Set<string>> {
  const sources = new Map<string, Set<string>>();
  for (const sheet of ["styles.css", "design-system.css"] as const) {
    for (const selector of selectors(readFileSync(resolve(sourceRoot, sheet), "utf8"))) {
      const owners = sources.get(selector) ?? new Set<string>();
      owners.add(sheet);
      sources.set(selector, owners);
    }
  }
  return sources;
}

describe("Phase 5 feature CSS ownership", () => {
  it("has one feature layer import for every feature stylesheet", () => {
    const entry = readFileSync(entryPath, "utf8");
    const featureImports = importedLayers(entry).filter(({ layer }) => layer === "features");
    expect(featureImports.map(({ path }) => path.slice(2))).toEqual([...featureSheets]);
    expect(new Set(featureImports.map(({ path }) => path)).size).toBe(featureSheets.length);
    expect(readFileSync(mainPath, "utf8")).toContain('import "./css-system.css";');
  });

  it("assigns retained global rules to truthful ownership layers", () => {
    const reset = readFileSync(resolve(sourceRoot, "styles.css"), "utf8");
    const primitives = readFileSync(resolve(sourceRoot, "css/primitives.css"), "utf8") + readFileSync(resolve(sourceRoot, "design-system.css"), "utf8");
    const layout = readFileSync(resolve(sourceRoot, "css/layout.css"), "utf8");
    const utilities = readFileSync(resolve(sourceRoot, "css/utilities.css"), "utf8");
    const resetSelectors = selectors(reset);
    expect(resetSelectors.every((selector) => !selector.includes(".")), resetSelectors.join(", ")).toBe(true);
    expect(reset).not.toContain("@media");
    expect(reset).not.toContain(".workspace-layout");
    expect(reset).not.toContain(".dialog-card");
    expect(primitives).toContain(".dialog-card");
    expect(primitives).toContain("button:focus-visible");
    expect(layout).toContain(".workspace-layout");
    expect(layout).toContain(".metadata div");
    expect(layout).toContain("@media (max-width: 900px)");
    expect(utilities).toContain("button:disabled");
    expect(utilities).toContain(".cache-limit-presets");
  });

  it("keeps each feature owner non-empty and prohibits an accidental nested ownership leak", () => {
    for (const sheet of featureSheets) {
      const css = readFileSync(resolve(sourceRoot, sheet), "utf8");
      expect(css.trim(), `${sheet} is empty`).not.toBe("");
      expect(selectors(css), `${sheet} has no selectors`).not.toHaveLength(0);
      expect(css).not.toMatch(/@import\s+["']/);
    }
  });

  it("keeps shared accessibility primitives explicit and feature-owned selectors intact", () => {
    const primitiveCss = readFileSync(resolve(sourceRoot, "design-system.css"), "utf8");
    expect(primitiveCss).toContain("button:focus-visible");
    expect(primitiveCss).toContain("input:focus-visible");
    expect(primitiveCss).toContain("min-height: var(--touch-target)");
    expect(primitiveCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(readFileSync(resolve(sourceRoot, "features/preview/image/imagePreview.css"), "utf8")).toContain(".media-preview-image");
    expect(readFileSync(resolve(sourceRoot, "features/operations/selection/selectionDetails.css"), "utf8")).toContain(".details-panel");
    expect(readFileSync(resolve(sourceRoot, "features/settings/settingsDialog/settingsDialog.css"), "utf8")).toContain(".settings-dialog");
  });

  it("contains no feature import outside the centralized entry", () => {
    const main = readFileSync(mainPath, "utf8");
    expect(main.match(/^import\s+["']\.\/features\/[^"']+\.css["'];?$/gm) ?? []).toEqual([]);
    const globalText = readFileSync(resolve(sourceRoot, "styles.css"), "utf8") + readFileSync(resolve(sourceRoot, "design-system.css"), "utf8");
    expect(globalText).not.toContain("@import");
    expect(declarations(globalText)).toContain("var(--color-text)");
  });

  it("keeps the legacy global overlap limited to named shared primitives", () => {
    const competitors = [...globalSelectorSources()]
      .filter(([, owners]) => owners.size > 1)
      .map(([selector]) => selector);
    expect(competitors.every((selector) => sharedPrimitiveSelectors.has(selector)), competitors.join(", ")).toBe(true);
  });

  it("keeps palette literals in the token source and leaves only documented surface gradients", () => {
    const styles = readFileSync(resolve(sourceRoot, "styles.css"), "utf8");
    const tokens = readFileSync(resolve(sourceRoot, "css/tokens.css"), "utf8");
    expect(rawColorCount(tokens)).toBeGreaterThan(0);
    expect(rawColorCount(readFileSync(resolve(sourceRoot, "design-system.css"), "utf8"))).toBe(0);
    expect(rawColorCount(styles)).toBeLessThanOrEqual(5);
    expect(styles).toContain("radial-gradient");
  });
});
