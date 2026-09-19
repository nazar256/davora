import { useEffect } from "react";

import type { ThemeMode } from "../model";
import { applyThemePreference } from "./model";
import type { ThemePreferencePorts } from "./ports";

export function useThemePreference(mode: ThemeMode, ports: ThemePreferencePorts): void {
  useEffect(() => {
    const apply = () => {
      applyThemePreference(mode, ports.getSystemPrefersDark(), ports.applyResolvedTheme);
    };

    apply();

    if (mode !== "system") {
      return;
    }

    return ports.subscribeSystemPrefersDarkChange(apply);
  }, [mode, ports]);
}
