import { act, renderHook } from "@testing-library/react";
import { expectTypeOf, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";

import { DEFAULT_UI_SETTINGS, type ThemeMode, type UiSettings } from "../model";
import type { SettingsService } from "../ports";
import type { ThemePreferencePorts } from "../theme";
import {
  useSettingsPreferencesWorkspace,
  type SettingsPreferencesWorkspaceCommands,
  type SettingsPreferencesWorkspaceOutput
} from "./index";

function createSettingsService(initial: UiSettings = DEFAULT_UI_SETTINGS): SettingsService & {
  current: UiSettings;
} {
  let current = initial;
  const service: SettingsService & { current: UiSettings } = {
    get current() {
      return current;
    },
    set current(next: UiSettings) {
      current = next;
    },
    load: vi.fn((): UiSettings => current),
    save: vi.fn((next: UiSettings): UiSettings => {
      current = next;
      return next;
    })
  };
  return service;
}

function createThemePorts() {
  let prefersDark = false;
  const listeners = new Set<() => void>();
  const ports: ThemePreferencePorts & {
    setPrefersDark(next: boolean): void;
    listenerCount(): number;
  } = {
    getSystemPrefersDark: () => prefersDark,
    subscribeSystemPrefersDarkChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyResolvedTheme: vi.fn(),
    setPrefersDark(next) {
      prefersDark = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size
  };
  return ports;
}

function createInput(initial?: UiSettings) {
  return {
    settingsService: createSettingsService(initial),
    themePorts: createThemePorts(),
    announceStatus: vi.fn()
  };
}

describe("useSettingsPreferencesWorkspace", () => {
  it("exposes only validated preferences and typed setting commands", () => {
    type Expected = {
      readonly preferences: UiSettings;
      readonly commands: SettingsPreferencesWorkspaceCommands;
    };
    expectTypeOf<ReturnType<typeof useSettingsPreferencesWorkspace>>().toEqualTypeOf<Expected>();
    expectTypeOf<ReturnType<typeof useSettingsPreferencesWorkspace>>().toEqualTypeOf<SettingsPreferencesWorkspaceOutput>();
    expectTypeOf<ReturnType<typeof useSettingsPreferencesWorkspace>>().not.toHaveProperty("token");
    expectTypeOf<ReturnType<typeof useSettingsPreferencesWorkspace>>().not.toHaveProperty("password");
  });

  it("loads persisted preferences and persists every command through the settings service", () => {
    const initial = { ...DEFAULT_UI_SETTINGS, themeMode: "light" as const, showHiddenFiles: true };
    const input = createInput(initial);
    const { result } = renderHook(() => useSettingsPreferencesWorkspace(input));

    expect(result.current.preferences).toEqual(initial);

    act(() => result.current.commands.handleShowHiddenFilesChange(false));
    act(() => result.current.commands.handleKeepAwakeEnabledChange(false));
    act(() => result.current.commands.handleThemeModeChange("dark"));

    expect(input.settingsService.save).toHaveBeenCalledTimes(3);
    expect(result.current.preferences).toMatchObject({
      showHiddenFiles: false,
      keepAwakeEnabled: false,
      themeMode: "dark"
    });
    expect(input.announceStatus).toHaveBeenCalledWith("Dark theme selected.");
  });

  it.each<[ThemeMode, boolean, string]>([
    ["system", false, "light"],
    ["system", true, "dark"],
    ["light", true, "light"],
    ["dark", false, "dark"]
  ])("applies %s theme mode as %s", (mode, systemPrefersDark, resolved) => {
    const input = createInput({ ...DEFAULT_UI_SETTINGS, themeMode: mode });
    input.themePorts.setPrefersDark(systemPrefersDark);
    renderHook(() => useSettingsPreferencesWorkspace(input));

    expect(input.themePorts.applyResolvedTheme).toHaveBeenLastCalledWith(mode, resolved, expect.any(String));
  });

  it("reacts to system preference changes and cleans up on replacement and unmount", () => {
    const input = createInput();
    const { result, rerender, unmount } = renderHook(() => useSettingsPreferencesWorkspace(input));

    expect(input.themePorts.listenerCount()).toBe(1);
    act(() => input.themePorts.setPrefersDark(true));
    expect(input.themePorts.applyResolvedTheme).toHaveBeenLastCalledWith("system", "dark", expect.any(String));

    act(() => result.current.commands.handleThemeModeChange("light"));
    rerender();
    expect(input.themePorts.listenerCount()).toBe(0);

    act(() => result.current.commands.handleThemeModeChange("system"));
    rerender();
    expect(input.themePorts.listenerCount()).toBe(1);

    unmount();
    expect(input.themePorts.listenerCount()).toBe(0);
  });

  it("keeps exactly one system listener through StrictMode effect replay", () => {
    const input = createInput();
    const { unmount } = renderHook(() => useSettingsPreferencesWorkspace(input), { wrapper: StrictMode });

    expect(input.themePorts.listenerCount()).toBe(1);
    unmount();
    expect(input.themePorts.listenerCount()).toBe(0);
  });
});
