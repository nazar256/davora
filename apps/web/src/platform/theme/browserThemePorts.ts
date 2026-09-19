/** Local structural copies keep platform adapters independent of feature modules. */
type BrowserThemeMode = "system" | "light" | "dark";
type BrowserResolvedTheme = "light" | "dark";

export interface BrowserThemePreferencePorts {
  readonly getSystemPrefersDark: () => boolean;
  readonly subscribeSystemPrefersDarkChange: (listener: () => void) => () => void;
  readonly applyResolvedTheme: (mode: BrowserThemeMode, resolved: BrowserResolvedTheme, themeColor: string) => void;
}

export function createBrowserThemePorts(): BrowserThemePreferencePorts {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  return {
    getSystemPrefersDark: () => mediaQuery.matches,
    subscribeSystemPrefersDarkChange: (listener) => {
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    },
    applyResolvedTheme: (mode, resolved, themeColor) => {
      const root = document.documentElement;
      root.dataset.themeMode = mode;
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
      document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", themeColor);
    }
  } satisfies BrowserThemePreferencePorts;
}
