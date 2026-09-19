import { afterEach, describe, expect, it, vi } from "vitest";

import { createSettingsService } from "../service";
import { createBrowserStringStorage } from "../../../platform/storage/browserStringStorage";
import { applyThemePreference, resolveThemePreference } from "./model";

describe("theme preference model", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("resolves system mode without changing explicit modes", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });

  it("applies the resolved theme and browser chrome color", () => {
    const applyResolvedTheme = vi.fn();

    applyThemePreference("system", true, applyResolvedTheme);

    expect(applyResolvedTheme).toHaveBeenCalledWith("system", "dark", "#07101f");
  });

  it("falls back to system mode for an unsupported stored preference", () => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ themeMode: "sepia" }));

    expect(createSettingsService(createBrowserStringStorage()).load().themeMode).toBe("system");
  });
});
