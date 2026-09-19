import { UI_SETTINGS_STORAGE_KEY } from "../storageContract";
import { THEME_COLORS, THEME_MODES, THEME_QUERY } from "./model";

const THEME_BOOTSTRAP_MARKER = "<!-- davora-theme-bootstrap -->";
const THEME_COLOR_META = /<meta\b(?=[^>]*\bname=["']theme-color["'])(?=[^>]*\bcontent=["']#07101f["'])[^>]*>/i;
const MODULE_SCRIPT = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'][^"']+["'])[^>]*>[\s\S]*?<\/script>/gi;

function serialized(value: string | readonly string[]): string {
  return JSON.stringify(value);
}

function assertSafeBootstrapSource(source: string): void {
  if (
    /<\/script/i.test(source)
    || /sourceMappingURL/i.test(source)
    || /\b(?:import|eval|fetch|XMLHttpRequest|WebSocket|EventSource|setTimeout|setInterval|addEventListener|removeEventListener)\b/.test(source)
    || /\b(?:localStorage|sessionStorage)\.setItem\b/.test(source)
  ) {
    throw new Error("Theme bootstrap source contains an unsafe effect or serialization boundary.");
  }
}

export function createThemeBootstrapSource(): string {
  const themes = serialized(THEME_MODES).replaceAll(",", ", ");
  const storageKey = serialized(UI_SETTINGS_STORAGE_KEY);
  const query = serialized(THEME_QUERY);
  const darkColor = serialized(THEME_COLORS.dark);
  const lightColor = serialized(THEME_COLORS.light);
  const source = [
    "(() => {",
    `  const themes = ${themes};`,
    '  let mode = "system";',
    "  try {",
    `    const stored = JSON.parse(localStorage.getItem(${storageKey}) || "{}");`,
    "    if (themes.includes(stored.themeMode)) mode = stored.themeMode;",
    "  } catch {}",
    '  const resolved = mode === "system"',
    `    ? (matchMedia(${query}).matches ? "dark" : "light")`,
    "    : mode;",
    "  document.documentElement.dataset.themeMode = mode;",
    "  document.documentElement.dataset.theme = resolved;",
    "  document.documentElement.style.colorScheme = resolved;",
    `  document.querySelector('meta[name="theme-color"]').content = resolved === "dark" ? ${darkColor} : ${lightColor};`,
    "})();"
  ].join("\n");
  assertSafeBootstrapSource(source);
  return source;
}

function markerCount(html: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const next = html.indexOf(THEME_BOOTSTRAP_MARKER, offset);
    if (next < 0) return count;
    count += 1;
    offset = next + THEME_BOOTSTRAP_MARKER.length;
  }
}

function reject(message: string): never {
  throw new Error(`Invalid theme bootstrap HTML: ${message}`);
}

export function injectThemeBootstrapHtml(html: string): string {
  if (markerCount(html) !== 1) reject("expected exactly one inert bootstrap marker");

  const markerIndex = html.indexOf(THEME_BOOTSTRAP_MARKER);
  const headStart = html.indexOf("<head>");
  const headEnd = html.indexOf("</head>");
  const themeMetaMatch = html.match(THEME_COLOR_META);
  const themeMetaIndex = themeMetaMatch?.index ?? -1;
  const moduleStartupMatch = [...html.matchAll(MODULE_SCRIPT)]
    .find((match) => !/\bsrc=["']\/@vite\/client["']/i.test(match[0] ?? ""));
  const moduleStartupIndex = moduleStartupMatch?.index ?? -1;
  if (
    headStart < 0
    || headEnd < 0
    || markerIndex < headStart
    || markerIndex > headEnd
    || themeMetaIndex < headStart
    || themeMetaIndex > markerIndex
    || moduleStartupIndex < 0
    || moduleStartupIndex <= markerIndex
  ) {
    reject("marker, theme-color meta, and module startup are out of order");
  }

  const headPrefix = html.slice(headStart, markerIndex);
  const preBootstrapScripts = [...headPrefix.matchAll(/<script\b[^>]*>/gi)];
  if (
    preBootstrapScripts.some((match) => !/\bsrc=["']\/@vite\/client["']/i.test(match[0] ?? ""))
    || /<link\b[^>]*rel=["']stylesheet["']/i.test(headPrefix)
  ) {
    reject("an executable or stylesheet dependency precedes the bootstrap marker");
  }

  const source = createThemeBootstrapSource();
  assertSafeBootstrapSource(source);
  const inlineScript = `<script>\n${source}\n</script>`;
  return `${html.slice(0, markerIndex)}${inlineScript}${html.slice(markerIndex + THEME_BOOTSTRAP_MARKER.length)}`;
}
