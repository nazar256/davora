import type { ThemeMode } from "../model";

export type ResolvedTheme = Exclude<ThemeMode, "system">;

export const THEME_MODES = ["system", "light", "dark"] as const satisfies readonly ThemeMode[];

export const THEME_QUERY = "(prefers-color-scheme: dark)";

export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: "#07101f",
  light: "#f7f9fd"
};

export function resolveThemePreference(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  return mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
}

export function applyThemePreference(
  mode: ThemeMode,
  systemPrefersDark: boolean,
  applyResolvedTheme: (mode: ThemeMode, resolved: ResolvedTheme, themeColor: string) => void
): ResolvedTheme {
  const resolvedTheme = resolveThemePreference(mode, systemPrefersDark);
  applyResolvedTheme(mode, resolvedTheme, THEME_COLORS[resolvedTheme]);
  return resolvedTheme;
}
