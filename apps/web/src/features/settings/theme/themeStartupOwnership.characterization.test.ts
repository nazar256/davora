// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createBrowserThemePorts } from "../../../platform/theme/browserThemePorts";
import { DEFAULT_UI_SETTINGS, normalizeUiSettings, type ThemeMode } from "../model";
import { createSettingsService, UI_SETTINGS_STORAGE_KEY } from "../service";
import { createThemeBootstrapSource, injectThemeBootstrapHtml } from "./bootstrapSource";
import type { ThemePreferencePorts } from "./ports";
import { THEME_COLORS, THEME_MODES, THEME_QUERY, resolveThemePreference } from "./model";
import { useThemePreference } from "./useThemePreference";

const repositoryRoot = existsSync(resolve(process.cwd(), "apps/web/index.html"))
  ? resolve(process.cwd())
  : resolve(process.cwd(), "../..");

const characterizedSourceHashes = {
  "apps/web/index.html": "7651689e50f9ddd2d3404492fb6a56f4efcbe8ee59e2be05eeb2cd2bd11a1b91",
  "apps/web/vite.config.ts": "a1ed60fcf63ec45912b4cbffe3aad70baabdc11bc56b0dc02424d1ee86cfaea2",
  "apps/web/src/features/settings/storageContract.ts": "b4ebdf83606ff10aeb2a7f74eb949a11d3c7d3c3206e865872a71d50dcd391a1",
  "apps/web/src/features/settings/service.ts": "86ddff3ceadffca48a8f54eba713f125e78f6774dc615a3d17ea244d238b2106",
  "apps/web/src/features/settings/theme/model.ts": "7565fd9c16fa93e89f8e50a0469605ac66d564d2686c94db098b1968834e6b5f",
  "apps/web/src/features/settings/theme/bootstrapSource.ts": "0aedcbf2927ecd3d98fd4608e24089d0771290314034c8a24848751f7a83a308",
  "apps/web/src/features/settings/theme/index.ts": "b6286c4d14f82fb96f073d6e438e2104363d27c74240b6c11b73f4559012a4dc",
  "apps/web/src/features/settings/theme/useThemePreference.ts": "45bcbee25823270fbdca9bdadb9e33575c02e76c366d7eab0d987865e71009f0",
  "apps/web/src/platform/theme/browserThemePorts.ts": "65665f70178efe9fea71a91a5fdea42bd3601150bbd2f118d97aa263be468730",
  "apps/web/src/features/settings/theme/model.test.ts": "723d262e5dc8b3649f4401ef1955f73109bdb6d9c1001d4e9804ed6a73886999",
  "apps/web/src/features/settings/theme/useThemePreference.test.tsx": "e7b46aa8d05258e45d9dd8c1c72ccc308c236385a27b3351ad5c5643ea0ba03c",
  "apps/web/src/features/settings/workspace/AppSettingsIntegration.test.tsx": "1193c8422bbbd3ea75b966ded81bb978890c4aa8b341748c2abd353c51ed1740",
  "apps/web/src/features/settings/model.ts": "97087207c48674e78f86fe7311296a483abf2847774a506da0f3bbf2ea821ad3",
  "apps/web/src/features/settings/service.test.ts": "8d5702b2d31e3d54f3b6f77336f70ed28d3a6a982f598e5cb233250f30f00ae0",
  "apps/web/src/features/settings/workspace/useSettingsPreferencesWorkspace.ts": "f518f50521405f2e8723fd8185333051532bbae9273c82a56e5e773ebc59cb0e",
  "apps/web/src/features/settings/workspace/useSettingsPreferencesWorkspace.test.tsx": "8cc1195686ff0371474eb6078019474be0f3a68f730a2dff18a3d3399c92d9ca"
} as const;

type FakeMeta = {
  content: string;
  setAttribute(name: string, value: string): void;
};

type FakeDocument = {
  readonly documentElement: {
    readonly dataset: Record<string, string>;
    readonly style: { colorScheme: string };
  };
  readonly head: { querySelector(selector: string): FakeMeta | null };
  querySelector(selector: string): FakeMeta | null;
};

type FakeThemeDom = {
  readonly document: FakeDocument;
  readonly meta: FakeMeta | null;
  readonly rootWrites: string[];
  readonly querySelectorCalls: string[];
};

const THEME_BOOTSTRAP_MARKER = "<!-- davora-theme-bootstrap -->";

function read(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function transformedIndexHtml(): string {
  return injectThemeBootstrapHtml(read("apps/web/index.html"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorTypeName(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "name" in error && typeof error.name === "string") {
    return error.name;
  }
  return undefined;
}

function classicBootstrap(html: string): string {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi)];
  expect(scripts, "expected one inline classic script").toHaveLength(1);
  const tag = scripts[0]?.[0] ?? "";
  expect(tag, "expected an inline classic script without src").not.toMatch(/\bsrc\s*=/i);
  return scripts[0]?.[1]?.trim() ?? "";
}

function assertRawMarkerPlacement(html: string, label: string): void {
  expect(html.match(/<!-- davora-theme-bootstrap -->/g), `${label}: marker count`).toHaveLength(1);
  expect(html, `${label}: raw executable script`).not.toMatch(/<script\b(?![^>]*\btype=["']module["'])/i);
  const headStart = html.indexOf("<head>");
  const headEnd = html.indexOf("</head>");
  const meta = html.indexOf('<meta name="theme-color" content="#07101f" />');
  const marker = html.indexOf(THEME_BOOTSTRAP_MARKER);
  const module = html.indexOf('<script type="module" src="/src/main.tsx"></script>');
  expect(headStart, `${label}: head`).toBeGreaterThanOrEqual(0);
  expect(headEnd, `${label}: head end`).toBeGreaterThan(headStart);
  expect(meta, `${label}: theme meta`).toBeGreaterThan(headStart);
  expect(marker, `${label}: marker`).toBeGreaterThan(meta);
  expect(marker, `${label}: marker in head`).toBeLessThan(headEnd);
  expect(module, `${label}: module startup`).toBeGreaterThan(marker);
}

function createThemeDom(withMeta = true): FakeThemeDom {
  const meta: FakeMeta | null = withMeta
    ? {
        content: "#07101f",
        setAttribute(name, value) {
          if (name === "content") this.content = value;
        }
      }
    : null;
  const rootWrites: string[] = [];
  const querySelectorCalls: string[] = [];
  const dataset = new Proxy<Record<string, string>>({}, {
    set(target, property, value) {
      rootWrites.push(`dataset.${String(property)}`);
      target[String(property)] = String(value);
      return true;
    }
  });
  let colorScheme = "";
  const style = { colorScheme };
  Object.defineProperty(style, "colorScheme", {
    configurable: true,
    get: () => colorScheme,
    set: (value: string) => {
      rootWrites.push("style.colorScheme");
      colorScheme = value;
    }
  });
  const documentElement = { dataset, style };
  const query = (selector: string): FakeMeta | null => {
    querySelectorCalls.push(selector);
    return selector === 'meta[name="theme-color"]' ? meta : null;
  };
  return {
    meta,
    rootWrites,
    querySelectorCalls,
    document: {
      documentElement,
      head: { querySelector: query },
      querySelector: query
    }
  };
}

function runBootstrap(source: string, rawStoredValue: string | null, prefersDark: boolean, withMeta = true) {
  const dom = createThemeDom(withMeta);
  const storage = {
    getItem: vi.fn(() => rawStoredValue),
    setItem: vi.fn()
  };
  const effects = {
    fetch: vi.fn(),
    setTimeout: vi.fn(),
    setInterval: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
  let error: unknown;
  try {
    runInNewContext(source, {
      document: dom.document,
      localStorage: storage,
      fetch: effects.fetch,
      setTimeout: effects.setTimeout,
      setInterval: effects.setInterval,
      matchMedia: () => ({
        matches: prefersDark,
        addEventListener: effects.addEventListener,
        removeEventListener: effects.removeEventListener
      })
    });
  } catch (caught) {
    error = caught;
  }
  return { dom, storage, effects, error };
}

function executeBootstrap(rawStoredValue: string | null, prefersDark: boolean): FakeThemeDom {
  const result = runBootstrap(classicBootstrap(transformedIndexHtml()), rawStoredValue, prefersDark);
  expect(result.error).toBeUndefined();
  expect(result.storage.setItem).not.toHaveBeenCalled();
  return result.dom;
}

function assertBootstrapAbsentMetaPolicy(source: string, label: string): void {
  const result = runBootstrap(source, null, false, false);
  expect(result.dom.meta, `${label}: meta query`).toBeNull();
  expect(result.dom.querySelectorCalls, `${label}: query`).toEqual(['meta[name="theme-color"]']);
  expect(result.error, `${label}: error`).toBeDefined();
  expect(errorTypeName(result.error), `${label}: error type`).toBe("TypeError");
  expect(result.dom.rootWrites, `${label}: root write order`).toEqual([
    "dataset.themeMode",
    "dataset.theme",
    "style.colorScheme"
  ]);
  expect(result.dom.document.documentElement.dataset, `${label}: root dataset`).toEqual({ themeMode: "system", theme: "light" });
  expect(result.dom.document.documentElement.style.colorScheme, `${label}: color scheme`).toBe("light");
  expect(result.storage.getItem).toHaveBeenCalledWith("davora-ui-settings");
  expect(result.storage.setItem, `${label}: storage write`).not.toHaveBeenCalled();
  expect(result.effects.fetch, `${label}: network`).not.toHaveBeenCalled();
  expect(result.effects.setTimeout, `${label}: timer`).not.toHaveBeenCalled();
  expect(result.effects.setInterval, `${label}: interval`).not.toHaveBeenCalled();
  expect(result.effects.addEventListener, `${label}: listener`).not.toHaveBeenCalled();
  expect(result.effects.removeEventListener, `${label}: listener cleanup`).not.toHaveBeenCalled();
}

function assertStartupOrder(html: string, label: string): void {
  const headStart = html.indexOf("<head>");
  const headEnd = html.indexOf("</head>");
  const classic = [...html.matchAll(/<script\b(?![^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi)];
  const moduleStartup = html.indexOf('<script type="module" src="/src/main.tsx"></script>');
  if (headStart < 0 || headEnd < 0 || classic.length !== 1) throw new Error(`${label}: parser placement`);
  if (/\bsrc\s*=/i.test(classic[0]?.[0] ?? "")) throw new Error(`${label}: inline bootstrap`);
  const classicStart = classic[0]?.index ?? -1;
  const themeMeta = html.indexOf('<meta name="theme-color" content="#07101f" />');
  if (themeMeta < 0 || classicStart < themeMeta || classicStart > headEnd || moduleStartup < 0 || classicStart > moduleStartup) {
    throw new Error(`${label}: parser placement`);
  }
  const headPrefix = html.slice(headStart, classicStart);
  if (/<link\b[^>]*rel=["']stylesheet["']/i.test(headPrefix)) throw new Error(`${label}: stylesheet dependency`);
}

function assertBootstrapPolicy(source: string, label: string): void {
  const required = [
    '"davora-ui-settings"',
    '["system", "light", "dark"]',
    'let mode = "system"',
    '"(prefers-color-scheme: dark)"',
    'document.documentElement.dataset.themeMode = mode',
    'document.documentElement.dataset.theme = resolved',
    'document.documentElement.style.colorScheme = resolved',
    "document.querySelector('meta[name=\"theme-color\"]').content",
    '"#07101f"',
    '"#f7f9fd"',
    'mode === "system"'
  ];
  for (const marker of required) {
    if (!source.includes(marker)) throw new Error(`${label}: ${marker}`);
  }
  if (/\b(?:fetch|XMLHttpRequest|setTimeout|setInterval|addEventListener|removeEventListener)\b/.test(source)) {
    throw new Error(`${label}: side effect dependency`);
  }
  if (source.includes("localStorage.setItem")) throw new Error(`${label}: storage write`);
}

function loadPersistedThemeMode(raw: string | null): {
  readonly settings: ReturnType<typeof createSettingsService> extends { load(): infer T } ? T : never;
  readonly getItem: ReturnType<typeof vi.fn>;
  readonly removeItem: ReturnType<typeof vi.fn>;
} {
  const getItem = vi.fn(() => raw);
  const removeItem = vi.fn();
  const service = createSettingsService({
    getItem,
    setItem: vi.fn(),
    removeItem
  });
  return { settings: service.load(), getItem, removeItem };
}

function assertRuntimePolicy(source: string, label: string): void {
  const required = [
    'window.matchMedia("(prefers-color-scheme: dark)")',
    'mediaQuery.addEventListener("change", listener)',
    'mediaQuery.removeEventListener("change", listener)',
    "root.dataset.themeMode = mode",
    "root.dataset.theme = resolved",
    "root.style.colorScheme = resolved",
    '?.setAttribute("content", themeColor)'
  ];
  for (const marker of required) {
    if (!source.includes(marker)) throw new Error(`${label}: ${marker}`);
  }
  if (/\b(?:localStorage|fetch|setTimeout|setInterval)\b/.test(source)) throw new Error(`${label}: unrelated effect`);
}

function assertHookPolicy(source: string, label: string): void {
  if (!source.includes('if (mode !== "system")')) throw new Error(`${label}: explicit-mode subscription`);
  if (!source.includes("return ports.subscribeSystemPrefersDarkChange(app);")) throw new Error(`${label}: listener binding`);
}

function expectCausalRejection(name: string, run: () => void): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(String(caught), name).toContain(name);
}

function createHookPorts(initialPrefersDark = false): {
  readonly ports: ThemePreferencePorts;
  readonly applyResolvedTheme: ReturnType<typeof vi.fn>;
  readonly subscribe: ReturnType<typeof vi.fn>;
  readonly unsubscribes: Array<ReturnType<typeof vi.fn>>;
  setPrefersDark(next: boolean): void;
} {
  let prefersDark = initialPrefersDark;
  const listeners = new Set<() => void>();
  const applyResolvedTheme = vi.fn();
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener);
    const unsubscribe = vi.fn(() => listeners.delete(listener));
    result.unsubscribes.push(unsubscribe);
    return unsubscribe;
  });
  const result = {
    ports: {
      getSystemPrefersDark: () => prefersDark,
      subscribeSystemPrefersDarkChange: subscribe,
      applyResolvedTheme
    },
    applyResolvedTheme,
    subscribe,
    unsubscribes: [] as Array<ReturnType<typeof vi.fn>>,
    setPrefersDark(next: boolean) {
      prefersDark = next;
      listeners.forEach((listener) => listener());
    }
  };
  return result;
}

describe("theme startup ownership characterization", () => {
  it("locks the single parser-blocking bootstrap and startup order", () => {
    const rawHtml = read("apps/web/index.html");
    assertRawMarkerPlacement(rawHtml, "raw marker placement");
    const html = transformedIndexHtml();
    assertStartupOrder(html, "startup order");
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head.match(/<script\b/gi)).toHaveLength(1);
    expect(html.match(/<script\b[^>]*type=["']module["']/gi)).toHaveLength(1);
    expect(classicBootstrap(html)).toBe(createThemeBootstrapSource());
    assertBootstrapPolicy(classicBootstrap(html), "bootstrap policy");
    const viteConfig = read("apps/web/vite.config.ts");
    expect(viteConfig).toContain('import { injectThemeBootstrapHtml } from "./src/features/settings/theme/bootstrapSource";');
    expect(viteConfig).not.toContain('from "./src/features/settings/theme";');
    for (const [relativePath, expectedHash] of Object.entries(characterizedSourceHashes)) {
      expect(sha256(read(relativePath)), relativePath).toBe(expectedHash);
    }
  });

  it("preserves the bootstrap state matrix without storage writes", () => {
    const cases = [
      { name: "absent", raw: null, prefersDark: false, mode: "system", resolved: "light", color: THEME_COLORS.light },
      { name: "malformed", raw: "{", prefersDark: true, mode: "system", resolved: "dark", color: THEME_COLORS.dark },
      { name: "non-object", raw: "null", prefersDark: false, mode: "system", resolved: "light", color: THEME_COLORS.light },
      { name: "array", raw: "[]", prefersDark: true, mode: "system", resolved: "dark", color: THEME_COLORS.dark },
      { name: "unsupported", raw: '{"themeMode":"sepia"}', prefersDark: false, mode: "system", resolved: "light", color: THEME_COLORS.light },
      { name: "system-light", raw: '{"themeMode":"system"}', prefersDark: false, mode: "system", resolved: "light", color: THEME_COLORS.light },
      { name: "system-dark", raw: '{"themeMode":"system"}', prefersDark: true, mode: "system", resolved: "dark", color: THEME_COLORS.dark },
      { name: "light", raw: '{"themeMode":"light"}', prefersDark: true, mode: "light", resolved: "light", color: THEME_COLORS.light },
      { name: "dark", raw: '{"themeMode":"dark"}', prefersDark: false, mode: "dark", resolved: "dark", color: THEME_COLORS.dark }
    ] as const;
    for (const testCase of cases) {
      const dom = executeBootstrap(testCase.raw, testCase.prefersDark);
      expect(dom.document.documentElement.dataset, testCase.name).toEqual({ themeMode: testCase.mode, theme: testCase.resolved });
      expect(dom.document.documentElement.style.colorScheme, testCase.name).toBe(testCase.resolved);
      expect(dom.meta?.content, testCase.name).toBe(testCase.color);
    }

    // The current parser bootstrap writes the three root sinks, then throws a
    // TypeError at the required meta sink. The runtime adapter's separate
    // absent-meta behavior is characterized as a non-throwing root update below.
    assertBootstrapAbsentMetaPolicy(classicBootstrap(transformedIndexHtml()), "bootstrap absent theme-color meta");
  });

  it("proves pure policy parity between bootstrap and the Settings theme model", () => {
    const bootstrap = classicBootstrap(transformedIndexHtml());
    expect(THEME_QUERY).toBe("(prefers-color-scheme: dark)");
    expect(THEME_COLORS).toEqual({ dark: "#07101f", light: "#f7f9fd" });
    expect(bootstrap).toContain(JSON.stringify(THEME_QUERY));
    expect(bootstrap).toContain(JSON.stringify(THEME_MODES).replaceAll(",", ", "));
    expect(bootstrap).toContain(THEME_COLORS.dark);
    expect(bootstrap).toContain(THEME_COLORS.light);
    for (const mode of ["system", "light", "dark"] as const) {
      for (const prefersDark of [false, true]) {
        const dom = executeBootstrap(JSON.stringify({ themeMode: mode }), prefersDark);
        const resolved = resolveThemePreference(mode, prefersDark);
        expect(dom.document.documentElement.dataset.theme).toBe(resolved);
        expect(dom.meta?.content).toBe(THEME_COLORS[resolved]);
      }
    }

    const persistenceCases: Array<{
      readonly name: string;
      readonly raw: string | null;
      readonly modelValue: unknown;
      readonly mode: ThemeMode;
      readonly removesCorruptJson: boolean;
    }> = [
      { name: "absent", raw: null, modelValue: undefined, mode: "system", removesCorruptJson: false },
      { name: "malformed", raw: "{", modelValue: undefined, mode: "system", removesCorruptJson: true },
      { name: "non-object", raw: "null", modelValue: null, mode: "system", removesCorruptJson: false },
      { name: "array", raw: "[]", modelValue: [], mode: "system", removesCorruptJson: false },
      { name: "unsupported", raw: JSON.stringify({ themeMode: "sepia" }), modelValue: { themeMode: "sepia" }, mode: "system", removesCorruptJson: false },
      { name: "system", raw: JSON.stringify({ themeMode: "system" }), modelValue: { themeMode: "system" }, mode: "system", removesCorruptJson: false },
      { name: "light", raw: JSON.stringify({ themeMode: "light" }), modelValue: { themeMode: "light" }, mode: "light", removesCorruptJson: false },
      { name: "dark", raw: JSON.stringify({ themeMode: "dark" }), modelValue: { themeMode: "dark" }, mode: "dark", removesCorruptJson: false }
    ];
    for (const testCase of persistenceCases) {
      expect(normalizeUiSettings(testCase.modelValue).themeMode, `${testCase.name} model`).toBe(testCase.mode);
      const loaded = loadPersistedThemeMode(testCase.raw);
      expect(loaded.settings, `${testCase.name} service`).toEqual({ ...DEFAULT_UI_SETTINGS, themeMode: testCase.mode });
      expect(loaded.getItem).toHaveBeenCalledWith(UI_SETTINGS_STORAGE_KEY);
      expect(loaded.removeItem).toHaveBeenCalledTimes(testCase.removesCorruptJson ? 1 : 0);
      if (testCase.removesCorruptJson) expect(loaded.removeItem).toHaveBeenCalledWith(UI_SETTINGS_STORAGE_KEY);
    }
  });

  it("keeps the browser adapter responsible for the four DOM sinks and listener lifetime", () => {
    const originalMatchMedia = window.matchMedia;
    const originalHead = document.head.innerHTML;
    const root = document.documentElement;
    const previousMode = root.dataset.themeMode;
    const previousTheme = root.dataset.theme;
    const previousColorScheme = root.style.colorScheme;
    const listeners = new Set<(event: { matches: boolean }) => void>();
    let prefersDark = false;
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener))
    };
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => mediaQuery) });
    document.head.innerHTML = '<meta name="theme-color" content="#07101f" />';
    try {
      const ports = createBrowserThemePorts();
      expect(ports.getSystemPrefersDark()).toBe(false);
      const listener = vi.fn();
      const remove = ports.subscribeSystemPrefersDarkChange(listener);
      expect(mediaQuery.addEventListener).toHaveBeenCalledTimes(1);
      mediaQuery.matches = true;
      prefersDark = true;
      listeners.forEach((registered) => registered({ matches: prefersDark }));
      expect(listener).toHaveBeenCalledTimes(1);
      ports.applyResolvedTheme("dark", "dark", THEME_COLORS.dark);
      expect(root.dataset.themeMode).toBe("dark");
      expect(root.dataset.theme).toBe("dark");
      expect(root.style.colorScheme).toBe("dark");
      expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(THEME_COLORS.dark);
      remove();
      expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);

      document.head.innerHTML = "";
      const addEventListener = vi.spyOn(window, "addEventListener");
      const setTimeout = vi.spyOn(window, "setTimeout");
      expect(() => ports.applyResolvedTheme("light", "light", THEME_COLORS.light)).not.toThrow();
      expect(root.dataset.themeMode).toBe("light");
      expect(root.dataset.theme).toBe("light");
      expect(root.style.colorScheme).toBe("light");
      expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull();
      expect(addEventListener).not.toHaveBeenCalled();
      expect(setTimeout).not.toHaveBeenCalled();
      addEventListener.mockRestore();
      setTimeout.mockRestore();
      assertRuntimePolicy(read("apps/web/src/platform/theme/browserThemePorts.ts"), "runtime adapter");
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
      document.head.innerHTML = originalHead;
      if (previousMode === undefined) delete root.dataset.themeMode;
      else root.dataset.themeMode = previousMode;
      if (previousTheme === undefined) delete root.dataset.theme;
      else root.dataset.theme = previousTheme;
      root.style.colorScheme = previousColorScheme;
    }
  });

  it("keeps system-mode updates, explicit-mode independence, and cleanup in one lifecycle owner", () => {
    const harness = createHookPorts(false);
    type HookProps = { mode: "system" | "light" | "dark"; ports: ThemePreferencePorts };
    const initialProps: HookProps = { mode: "system", ports: harness.ports };
    const { rerender, unmount } = renderHook(
      ({ mode, ports }: HookProps) => useThemePreference(mode, ports),
      { initialProps }
    );
    expect(harness.applyResolvedTheme).toHaveBeenCalledWith("system", "light", THEME_COLORS.light);
    expect(harness.subscribe).toHaveBeenCalledTimes(1);
    rerender({ mode: "light", ports: harness.ports });
    expect(harness.unsubscribes[0]).toHaveBeenCalledTimes(1);
    const callsAfterExplicitMode = harness.applyResolvedTheme.mock.calls.length;
    harness.setPrefersDark(true);
    expect(harness.applyResolvedTheme).toHaveBeenCalledTimes(callsAfterExplicitMode);
    rerender({ mode: "dark", ports: harness.ports });
    expect(harness.applyResolvedTheme).toHaveBeenLastCalledWith("dark", "dark", THEME_COLORS.dark);
    const callsAfterDarkMode = harness.applyResolvedTheme.mock.calls.length;
    harness.setPrefersDark(false);
    expect(harness.applyResolvedTheme).toHaveBeenCalledTimes(callsAfterDarkMode);
    rerender({ mode: "system", ports: harness.ports });
    expect(harness.subscribe).toHaveBeenCalledTimes(2);
    harness.setPrefersDark(false);
    expect(harness.applyResolvedTheme).toHaveBeenLastCalledWith("system", "light", THEME_COLORS.light);
    unmount();
    expect(harness.unsubscribes[1]).toHaveBeenCalledTimes(1);
  });

  it("rejects causal policy, placement, sink, side-effect, subscription, and cleanup drift", () => {
    const html = transformedIndexHtml();
    const bootstrap = classicBootstrap(html);
    const bootstrapTag = (() => {
      const scripts = [...html.matchAll(/<script\b(?![^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi)];
      return scripts[0]?.[0] ?? "";
    })();
    const ports = read("apps/web/src/platform/theme/browserThemePorts.ts");
    const hook = read("apps/web/src/features/settings/theme/useThemePreference.ts");
    const replaceOnce = (source: string, before: string, after: string): string => {
      expect(source).toContain(before);
      return source.replace(before, after);
    };
    expectCausalRejection("storage key", () => assertBootstrapPolicy(replaceOnce(bootstrap, '"davora-ui-settings"', '"wrong-key"'), "storage key"));
    expectCausalRejection("mode vocabulary", () => assertBootstrapPolicy(replaceOnce(bootstrap, '["system", "light", "dark"]', '["system", "light"]'), "mode vocabulary"));
    expectCausalRejection("fallback", () => assertBootstrapPolicy(replaceOnce(bootstrap, 'let mode = "system"', 'let mode = "light"'), "fallback"));
    expectCausalRejection("query", () => assertBootstrapPolicy(replaceOnce(bootstrap, '"(prefers-color-scheme: dark)"', '"(prefers-color-scheme: light)"'), "query"));
    expectCausalRejection("dark color", () => assertBootstrapPolicy(replaceOnce(bootstrap, '"#07101f"', '"#000000"'), "dark color"));
    expectCausalRejection("light color", () => assertBootstrapPolicy(replaceOnce(bootstrap, '"#f7f9fd"', '"#ffffff"'), "light color"));
    expectCausalRejection("resolution branch", () => assertBootstrapPolicy(replaceOnce(bootstrap, 'mode === "system"', 'mode === "light"'), "resolution branch"));
    for (const [sink, marker] of [
      ["theme-mode sink", "document.documentElement.dataset.themeMode = mode;"],
      ["theme sink", "document.documentElement.dataset.theme = resolved;"],
      ["color-scheme sink", "document.documentElement.style.colorScheme = resolved;"],
      ["theme-color sink", "document.querySelector('meta[name=\"theme-color\"]').content = resolved === \"dark\" ? \"#07101f\" : \"#f7f9fd\";"]
    ] as const) {
      expectCausalRejection(sink, () => assertBootstrapPolicy(replaceOnce(bootstrap, marker, ""), sink));
    }
    expectCausalRejection("storage write", () => assertBootstrapPolicy(`${bootstrap}\nlocalStorage.setItem("davora-ui-settings", "{}");`, "storage write"));
    expectCausalRejection("network", () => assertBootstrapPolicy(`${bootstrap}\nfetch("/");`, "network"));
    expectCausalRejection("timer", () => assertBootstrapPolicy(`${bootstrap}\nsetTimeout(() => undefined, 0);`, "timer"));
    expectCausalRejection("listener", () => assertBootstrapPolicy(`${bootstrap}\nmatchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => undefined);`, "listener"));
    const metaAssignment = 'document.querySelector(\'meta[name="theme-color"]\').content = resolved === "dark" ? "#07101f" : "#f7f9fd";';
    const silentlyAcceptingBootstrap = replaceOnce(
      bootstrap,
      metaAssignment,
      'document.querySelector(\'meta[name="theme-color"]\')?.setAttribute("content", resolved === "dark" ? "#07101f" : "#f7f9fd");'
    );
    expectCausalRejection("bootstrap absent-meta acceptance", () => assertBootstrapAbsentMetaPolicy(silentlyAcceptingBootstrap, "bootstrap absent-meta acceptance"));
    expectCausalRejection("runtime absent-meta strict", () => assertRuntimePolicy(
      replaceOnce(ports, '?.setAttribute("content", themeColor)', 'setAttribute("content", themeColor)'),
      "runtime absent-meta strict"
    ));
    expectCausalRejection("runtime absent-meta skip", () => assertRuntimePolicy(
      replaceOnce(ports, '?.setAttribute("content", themeColor);', ""),
      "runtime absent-meta skip"
    ));
    expectCausalRejection("startup placement", () => assertStartupOrder(replaceOnce(html, bootstrapTag, ""), "startup placement"));
    expectCausalRejection("startup placement", () => assertStartupOrder(
      replaceOnce(html, bootstrapTag, "").replace('<meta name="theme-color" content="#07101f" />', `${bootstrapTag}\n<meta name="theme-color" content="#07101f" />`),
      "startup placement"
    ));
    expectCausalRejection("startup placement", () => assertStartupOrder(
      replaceOnce(html, bootstrapTag, "").replace("</head>", `</head>\n${bootstrapTag}`),
      "startup placement"
    ));
    expectCausalRejection("startup placement", () => assertStartupOrder(
      replaceOnce(html, bootstrapTag, "").replace('<script type="module" src="/src/main.tsx"></script>', `<script type="module" src="/src/main.tsx"></script>\n${bootstrapTag}`),
      "startup placement"
    ));
    expectCausalRejection("explicit-mode subscription", () => assertHookPolicy(replaceOnce(hook, 'if (mode !== "system")', 'if (mode === "system")'), "explicit-mode subscription"));
    expectCausalRejection("cleanup", () => assertRuntimePolicy(replaceOnce(ports, 'return () => mediaQuery.removeEventListener("change", listener);', "return () => undefined;"), "cleanup"));
  });
});
