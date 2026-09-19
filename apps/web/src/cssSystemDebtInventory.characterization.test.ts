import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import postcss, { type AtRule, type Root, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const entryPath = resolve(sourceRoot, "css-system.css");
const tokenPath = resolve(sourceRoot, "css/tokens.css");
const overridePath = resolve(sourceRoot, "css/overrides.css");
const mainPath = resolve(sourceRoot, "main.tsx");

const layerOrder = ["reset", "tokens", "primitives", "layout", "features", "utilities", "overrides"] as const;
const expectedImports = [
  ["./styles.css", "reset"],
  ["./css/tokens.css", "tokens"],
  ["./css/primitives.css", "primitives"],
  ["./design-system.css", "primitives"],
  ["./css/layout.css", "layout"],
  ["./features/workspace/status/workspaceStatus.css", "features"],
  ["./features/navigation/pullToRefresh/pullToRefresh.css", "features"],
  ["./features/offline/sync/confirm/offlineSyncConfirm.css", "features"],
  ["./features/pwa/reloadPrompt.css", "features"],
  ["./features/folderShortcut/folderShortcut.css", "features"],
  ["./features/accounts/accountSurfaces.css", "features"],
  ["./features/browsing/browseHeader/browseHeader.css", "features"],
  ["./features/preview/shell/previewShell.css", "features"],
  ["./features/preview/image/imagePreview.css", "features"],
  ["./features/preview/pdf/pdfPreview.css", "features"],
  ["./features/preview/media/mediaPreview.css", "features"],
  ["./features/preview/folderAudio/folderAudio.css", "features"],
  ["./features/operations/selection/selectionDetails.css", "features"],
  ["./features/operations/destination/destinationPicker.css", "features"],
  ["./features/operations/actionDialog/actionDialog.css", "features"],
  ["./features/settings/settingsDialog/settingsDialog.css", "features"],
  ["./features/transfers/tray/transferTray.css", "features"],
  ["./features/browsing/fileList/fileList.css", "features"],
  ["./features/browsing/favourites/favourites.css", "features"],
  ["./features/browsing/appBar/appBar.css", "features"],
  ["./features/browsing/navDrawer/navDrawer.css", "features"],
  ["./css/utilities.css", "utilities"],
  ["./css/overrides.css", "overrides"]
] as const;

type ImportRecord = { path: string; layer: string };

function importRecords(css: string): ImportRecord[] {
  return [...css.matchAll(/@import\s+["']([^"']+)["']\s+layer\(([^)]+)\)\s*;/g)]
    .map((match) => ({ path: match[1] ?? "", layer: match[2]?.trim() ?? "" }));
}

function rulesIn(css: string): Rule[] {
  const result: Rule[] = [];
  function visit(container: Root | AtRule): void {
    for (const node of container.nodes ?? []) {
      if (node.type === "rule") result.push(node);
      else if (node.type === "atrule" && node.nodes) visit(node);
    }
  }
  visit(postcss.parse(css));
  return result;
}

function customPropertyDefinitions(css: string): string[] {
  return [...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((match) => match[1] ?? "");
}

describe("Phase 5 CSS semantic ownership manifest", () => {
  it("defines one explicit cascade graph and imports each owner in stable order", () => {
    expect(existsSync(entryPath), "missing CSS system entry").toBe(true);
    const entry = readFileSync(entryPath, "utf8");
    expect(entry).toContain(`@layer ${layerOrder.join(", ")};`);
    expect(importRecords(entry)).toEqual(expectedImports.map(([path, layer]) => ({ path, layer })));
    const main = readFileSync(mainPath, "utf8");
    expect(main).toMatch(/import\s+["']\.\/css-system\.css["'];/);
    expect(main.match(/^import\s+["']\.\/[^"']+\.css["'];?$/gm) ?? []).toEqual(["import \"./css-system.css\";"]);
  });

  it("owns semantic tokens in the tokens layer and consumes them from shared primitives", () => {
    expect(existsSync(tokenPath), "missing semantic token source").toBe(true);
    const tokens = readFileSync(tokenPath, "utf8");
    const definitions = new Set(customPropertyDefinitions(tokens));
    const required = [
      "--color-canvas", "--color-surface", "--color-surface-raised", "--color-text", "--color-text-muted",
      "--color-border-subtle", "--color-accent", "--color-on-accent", "--color-accent-soft", "--color-folder",
      "--color-success", "--color-warning", "--color-danger", "--color-scrim", "--shadow-raised", "--shadow-overlay",
      "--touch-target", "--focus-ring", "--motion-fast", "--motion-normal"
    ];
    for (const token of required) expect(definitions, `missing ${token}`).toContain(token);
    const primitiveSource = readFileSync(resolve(sourceRoot, "design-system.css"), "utf8");
    expect(primitiveSource).toContain("var(--color-text)");
    expect(primitiveSource).toContain("var(--focus-ring)");
    expect(primitiveSource).not.toMatch(/--color-(?:canvas|surface|text|accent|danger)\s*:/);
  });

  it("maps all imported styles to a single explicit owner and retains feature namespaces", () => {
    const imports = importRecords(readFileSync(entryPath, "utf8"));
    expect(imports.filter(({ layer }) => layer === "features")).toHaveLength(21);
    expect(imports.filter(({ layer }) => layer === "reset")).toEqual([{ path: "./styles.css", layer: "reset" }]);
    expect(imports.filter(({ layer }) => layer === "primitives")).toEqual([
      { path: "./css/primitives.css", layer: "primitives" },
      { path: "./design-system.css", layer: "primitives" }
    ]);
    expect(imports.filter(({ layer }) => layer === "layout")).toEqual([{ path: "./css/layout.css", layer: "layout" }]);
    expect(imports.filter(({ layer }) => layer === "utilities")).toEqual([{ path: "./css/utilities.css", layer: "utilities" }]);
    for (const [path] of expectedImports) expect(existsSync(resolve(sourceRoot, path.slice(2)))).toBe(true);
    const featureSources = imports.filter(({ layer }) => layer === "features").map(({ path }) => readFileSync(resolve(sourceRoot, path.slice(2)), "utf8"));
    expect(featureSources.every((css) => css.trim().length > 0)).toBe(true);
    expect(featureSources.join("\n")).toContain(".state-banner-slot");
    expect(featureSources.join("\n")).toContain(".preview-header");
  });

  it("requires a named, auditable override ledger with no unexplained rules", () => {
    expect(existsSync(overridePath), "missing override ledger").toBe(true);
    const overrides = readFileSync(overridePath, "utf8");
    expect(overrides).toMatch(/Exception ledger:/);
    const rules = rulesIn(overrides);
    expect(rules.every((rule) => /button-danger/.test(rule.selector))).toBe(true);
    expect(rules.length).toBeLessThanOrEqual(1);
  });

  it("rejects an unlayered stylesheet or an unlisted override", () => {
    const entry = readFileSync(entryPath, "utf8");
    expect(entry).not.toMatch(/@import\s+["'][^"']+["']\s*;/);
    expect(readFileSync(overridePath, "utf8")).not.toMatch(/\.unlisted-[A-Za-z0-9_-]+/);
  });
});
