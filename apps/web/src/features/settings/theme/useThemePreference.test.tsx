import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ThemePreferencePorts } from "./ports";
import { useThemePreference } from "./useThemePreference";

function createFakeThemePorts(initialPrefersDark = false): ThemePreferencePorts & {
  setPrefersDark(next: boolean): void;
  readonly removeListener: ReturnType<typeof vi.fn>;
} {
  let prefersDark = initialPrefersDark;
  const listeners = new Set<() => void>();
  const removeListener = vi.fn((listener: () => void) => {
    listeners.delete(listener);
  });

  return {
    getSystemPrefersDark: () => prefersDark,
    setPrefersDark(next: boolean) {
      prefersDark = next;
      listeners.forEach((listener) => listener());
    },
    subscribeSystemPrefersDarkChange: (listener) => {
      listeners.add(listener);
      return () => removeListener(listener);
    },
    applyResolvedTheme: vi.fn(),
    removeListener
  };
}

describe("useThemePreference", () => {
  it("updates system mode when the operating-system preference changes", () => {
    const ports = createFakeThemePorts(false);
    renderHook(() => useThemePreference("system", ports));

    expect(ports.applyResolvedTheme).toHaveBeenCalledWith("system", "light", expect.any(String));

    ports.setPrefersDark(true);
    expect(ports.applyResolvedTheme).toHaveBeenCalledWith("system", "dark", expect.any(String));
  });

  it("cleans up the system preference listener on unmount", () => {
    const ports = createFakeThemePorts();
    const { unmount } = renderHook(() => useThemePreference("system", ports));
    unmount();

    expect(ports.removeListener).toHaveBeenCalledTimes(1);
  });
});
