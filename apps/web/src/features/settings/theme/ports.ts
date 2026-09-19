import type { ThemeMode } from "../model";
import type { ResolvedTheme } from "./model";

export interface ThemePreferencePorts {
  readonly getSystemPrefersDark: () => boolean;
  readonly subscribeSystemPrefersDarkChange: (listener: () => void) => () => void;
  readonly applyResolvedTheme: (mode: ThemeMode, resolved: ResolvedTheme, themeColor: string) => void;
}
