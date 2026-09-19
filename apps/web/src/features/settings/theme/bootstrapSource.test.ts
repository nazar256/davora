// @vitest-environment jsdom

import { runInNewContext } from "node:vm";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createThemeBootstrapSource, injectThemeBootstrapHtml } from "./bootstrapSource";
import { THEME_COLORS, THEME_MODES, THEME_QUERY } from "./model";

const MARKER = "<!-- davora-theme-bootstrap -->";
const THEME_META = '<meta name="theme-color" content="#07101f" />';
const MODULE_STARTUP = '<script type="module" src="/src/main.tsx"></script>';
const webRoot = existsSync(resolve(process.cwd(), "src/features/settings/theme/bootstrapSource.ts"))
  ? resolve(process.cwd())
  : resolve(process.cwd(), "apps/web");

type FakeMeta = { content: string };

function readTemplate(): string {
  return `<!doctype html>\n<html><head>\n${THEME_META}\n${MARKER}\n</head><body>${MODULE_STARTUP}</body></html>`;
}

function inlineSource(html: string): string {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi)];
  expect(scripts).toHaveLength(1);
  return scripts[0]?.[1]?.trim() ?? "";
}

function execute(source: string, rawStoredValue: string | null, prefersDark: boolean, withMeta = true) {
  const meta: FakeMeta | null = withMeta ? { content: THEME_COLORS.dark } : null;
  const dataset: Record<string, string> = {};
  let colorScheme = "";
  const querySelector = vi.fn(() => meta);
  const storage = { getItem: vi.fn(() => rawStoredValue), setItem: vi.fn() };
  let error: unknown;
  try {
    runInNewContext(source, {
      document: {
        documentElement: {
          dataset,
          style: {
            get colorScheme() { return colorScheme; },
            set colorScheme(value: string) { colorScheme = value; }
          }
        },
        querySelector
      },
      localStorage: storage,
      matchMedia: () => ({ matches: prefersDark })
    });
  } catch (caught) {
    error = caught;
  }
  return { colorScheme, dataset, error, meta, querySelector, storage };
}

describe("theme bootstrap source", () => {
  it("keeps the build-root value graph on dependency-free Settings/theme leaves", () => {
    const bootstrapSource = readFileSync(resolve(webRoot, "src/features/settings/theme/bootstrapSource.ts"), "utf8");
    const storageContract = readFileSync(resolve(webRoot, "src/features/settings/storageContract.ts"), "utf8");
    const service = readFileSync(resolve(webRoot, "src/features/settings/service.ts"), "utf8");
    const viteConfig = readFileSync(resolve(webRoot, "vite.config.ts"), "utf8");
    expect(bootstrapSource).toContain('from "../storageContract"');
    expect(bootstrapSource).not.toMatch(/from "\.\.\/(?:service|model|browsing)"|@davora\/shared|from ["']react["']/);
    expect(viteConfig).toContain('import { injectThemeBootstrapHtml } from "./src/features/settings/theme/bootstrapSource";');
    expect(viteConfig).not.toContain('from "./src/features/settings/theme";');
    expect(viteConfig.match(/import \{ injectThemeBootstrapHtml \} from "\.\/src\/features\/settings\/theme\/bootstrapSource";/g)).toHaveLength(1);
    expect(storageContract).toBe('export const UI_SETTINGS_STORAGE_KEY = "davora-ui-settings";\n');
    expect(service).toContain('import { UI_SETTINGS_STORAGE_KEY } from "./storageContract";');
    expect(service).toContain('export { UI_SETTINGS_STORAGE_KEY } from "./storageContract";');
    expect(service).not.toContain('const UI_SETTINGS_STORAGE_KEY = "davora-ui-settings";');
  });

  it("serializes one deterministic synchronous classic policy from canonical constants", () => {
    const source = createThemeBootstrapSource();
    expect(source).toBe(createThemeBootstrapSource());
    expect(source).toContain(JSON.stringify(THEME_MODES).replaceAll(",", ", "));
    expect(source).toContain(JSON.stringify(THEME_QUERY));
    expect(source).toContain(JSON.stringify(THEME_COLORS.dark));
    expect(source).toContain(JSON.stringify(THEME_COLORS.light));
    expect(source).toContain("localStorage.getItem(\"davora-ui-settings\")");
    expect(source).toContain("document.documentElement.dataset.themeMode = mode");
    expect(source).toContain("document.documentElement.dataset.theme = resolved");
    expect(source).toContain("document.documentElement.style.colorScheme = resolved");
    expect(source).toContain("document.querySelector('meta[name=\"theme-color\"]').content");
    expect(source).not.toMatch(/<\/script|sourceMappingURL|\b(?:import|eval|fetch|setTimeout|setInterval|addEventListener|removeEventListener)\b/);
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage)\.setItem\b/);
  });

  it("injects exactly one parser-positioned script and refuses transformed or unsafe templates", () => {
    const raw = readTemplate();
    const transformed = injectThemeBootstrapHtml(raw);
    expect(transformed).not.toContain(MARKER);
    expect(transformed.match(/<script\b(?![^>]*\btype=["']module["'])[^>]*>/gi)).toHaveLength(1);
    expect(transformed.indexOf(THEME_META)).toBeLessThan(transformed.indexOf("<script>"));
    expect(transformed.indexOf("<script>")).toBeLessThan(transformed.indexOf(MODULE_STARTUP));
    expect(inlineSource(transformed)).toBe(createThemeBootstrapSource());
    expect(() => injectThemeBootstrapHtml(transformed)).toThrow(/exactly one inert bootstrap marker/);
    expect(() => injectThemeBootstrapHtml(raw.replace(MARKER, `${MARKER}\n${MARKER}`))).toThrow(/exactly one inert bootstrap marker/);
    expect(() => injectThemeBootstrapHtml(raw.replace(MARKER, ""))).toThrow(/exactly one inert bootstrap marker/);
    expect(() => injectThemeBootstrapHtml(raw.replace(`${THEME_META}\n${MARKER}`, `${MARKER}\n${THEME_META}`))).toThrow(/out of order/);
    expect(() => injectThemeBootstrapHtml(raw.replace(`${MARKER}\n</head>`, `<link rel="stylesheet" href="/wrong.css" />\n${MARKER}\n</head>`))).toThrow(/precedes/);
    expect(() => injectThemeBootstrapHtml(raw.replace(MODULE_STARTUP, `${MARKER}${MODULE_STARTUP}`))).toThrow(/exactly one inert bootstrap marker/);
  });

  it("preserves the startup state matrix and the characterized absent-meta partial write", () => {
    const source = inlineSource(injectThemeBootstrapHtml(readTemplate()));
    const cases = [
      { raw: null, prefersDark: false, mode: "system", resolved: "light", color: THEME_COLORS.light },
      { raw: "{", prefersDark: true, mode: "system", resolved: "dark", color: THEME_COLORS.dark },
      { raw: "[]", prefersDark: true, mode: "system", resolved: "dark", color: THEME_COLORS.dark },
      { raw: JSON.stringify({ themeMode: "light" }), prefersDark: true, mode: "light", resolved: "light", color: THEME_COLORS.light },
      { raw: JSON.stringify({ themeMode: "dark" }), prefersDark: false, mode: "dark", resolved: "dark", color: THEME_COLORS.dark }
    ] as const;
    for (const testCase of cases) {
      const result = execute(source, testCase.raw, testCase.prefersDark);
      expect(result.error, testCase.raw ?? "absent").toBeUndefined();
      expect(result.dataset).toEqual({ themeMode: testCase.mode, theme: testCase.resolved });
      expect(result.colorScheme).toBe(testCase.resolved);
      expect(result.meta?.content).toBe(testCase.color);
      expect(result.storage.setItem).not.toHaveBeenCalled();
    }
    const absentMeta = execute(source, null, false, false);
    expect(absentMeta.dataset).toEqual({ themeMode: "system", theme: "light" });
    expect(absentMeta.colorScheme).toBe("light");
    expect(absentMeta.querySelector).toHaveBeenCalledWith('meta[name="theme-color"]');
    expect(absentMeta.error).toBeDefined();
    expect(absentMeta.storage.setItem).not.toHaveBeenCalled();
  });

  it("rejects marker placement and duplicate-source adversaries", () => {
    const raw = readTemplate();
    const cases = [
      raw.replace("<head>", `<head>\n${MARKER}`),
      raw.replace("</head>", `${MARKER}\n</head>`),
      raw.replace(MODULE_STARTUP, `${MODULE_STARTUP}\n${MARKER}`),
      raw.replace(MARKER, `<script>unsafe</script>\n${MARKER}`),
      raw.replace(MARKER, `<script src="/theme.js"></script>\n${MARKER}`)
    ];
    for (const candidate of cases) {
      expect(() => injectThemeBootstrapHtml(candidate)).toThrow();
    }
  });
});
