import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_UI_SETTINGS } from "../model";
import { createSettingsService } from "../service";
import { createFakeSettingsStorage } from "../testing/fakeStorage";
import type { UiSettingsPorts } from "./ports";
import { useUiSettings } from "./useUiSettings";

function createHarness(initialStorage: Record<string, string> = {}) {
  const storage = createFakeSettingsStorage(initialStorage);
  const settingsService = createSettingsService(storage);
  const announceStatus = vi.fn<(message: string) => void>();
  const ports: UiSettingsPorts = { announceStatus };

  const hook = renderHook(() => useUiSettings({ settingsService, ports }));

  return { hook, storage, settingsService, announceStatus };
}

describe("useUiSettings", () => {
  it("loads persisted settings on mount", () => {
    const { hook } = createHarness({
      "davora-ui-settings": JSON.stringify({ ...DEFAULT_UI_SETTINGS, themeMode: "light" })
    });

    expect(hook.result.current.uiSettings.themeMode).toBe("light");
  });

  it("persists file-size mode changes and announces status", () => {
    const { hook, storage, announceStatus } = createHarness();

    act(() => {
      hook.result.current.handleFileSizeDisplayModeChange("kb");
    });

    expect(hook.result.current.uiSettings.fileSizeDisplayMode).toBe("kb");
    expect(JSON.parse(storage.values.get("davora-ui-settings") ?? "null")).toMatchObject({ fileSizeDisplayMode: "kb" });
    expect(announceStatus).toHaveBeenCalledWith("File sizes now use KB.");
  });

  it("persists theme mode changes and announces status", () => {
    const { hook, announceStatus } = createHarness();

    act(() => {
      hook.result.current.handleThemeModeChange("dark");
    });

    expect(hook.result.current.uiSettings.themeMode).toBe("dark");
    expect(announceStatus).toHaveBeenCalledWith("Dark theme selected.");
  });

  it("persists max-cacheable size using normalized saved values in status copy", () => {
    const { hook, announceStatus } = createHarness();

    act(() => {
      hook.result.current.handleMaxCacheableFileSizeChange(32 * 1024 * 1024);
    });

    expect(hook.result.current.uiSettings.maxCacheableFileSizeBytes).toBe(32 * 1024 * 1024);
    expect(announceStatus).toHaveBeenCalledWith(
      "Files up to 32 MB stay eligible for browser blob caching."
    );
  });

  it("persists preview freshness using normalized saved values in status copy", () => {
    const { hook, announceStatus } = createHarness();

    act(() => {
      hook.result.current.handlePreviewFreshnessIntervalChange(300.4);
    });

    expect(hook.result.current.uiSettings.previewFreshnessIntervalSeconds).toBe(300);
    expect(announceStatus).toHaveBeenCalledWith("Cached previews will be checked after 300 seconds.");
  });

  it("persists the image prefetch count and announces the effective look-ahead", () => {
    const { hook, storage, announceStatus } = createHarness();

    act(() => {
      hook.result.current.handleImagePreviewPrefetchCountChange(3);
    });

    expect(hook.result.current.uiSettings.imagePreviewPrefetchCount).toBe(3);
    expect(JSON.parse(storage.values.get("davora-ui-settings") ?? "null")).toMatchObject({ imagePreviewPrefetchCount: 3 });
    expect(announceStatus).toHaveBeenCalledWith("3 images will be preloaded ahead.");
  });

  it("persists keep-awake, hidden-files, HEIC, and sort changes with status copy", () => {
    const { hook, announceStatus } = createHarness();

    act(() => {
      hook.result.current.handleKeepAwakeEnabledChange(false);
    });
    expect(announceStatus).toHaveBeenLastCalledWith("Keep awake is disabled on this device.");

    act(() => {
      hook.result.current.handleShowHiddenFilesChange(true);
    });
    expect(announceStatus).toHaveBeenLastCalledWith("Hidden files and folders are now visible.");

    act(() => {
      hook.result.current.handleExperimentalHeicPreviewEnabledChange(true);
    });
    expect(announceStatus).toHaveBeenLastCalledWith(
      "Experimental HEIC preview is enabled for this browser."
    );

    act(() => {
      hook.result.current.handleSortModeChange("modified-desc");
    });
    expect(hook.result.current.uiSettings.sortMode).toBe("modified-desc");
    expect(announceStatus).toHaveBeenLastCalledWith("Sorted by Modified newest.");
  });

  it("persists image preview fit mode without announcing status", () => {
    const { hook, storage, announceStatus } = createHarness();

    act(() => {
      hook.result.current.handleImagePreviewFitModeChange("fit");
    });

    expect(hook.result.current.uiSettings.imagePreviewFitMode).toBe("fit");
    expect(JSON.parse(storage.values.get("davora-ui-settings") ?? "null")).toMatchObject({ imagePreviewFitMode: "fit" });
    expect(announceStatus).not.toHaveBeenCalled();
  });

  it("persists the video muted preference without announcing status", () => {
    const { hook, storage, announceStatus } = createHarness();

    act(() => {
      hook.result.current.handleVideoMutedChange(true);
    });
    expect(hook.result.current.uiSettings.videoMuted).toBe(true);
    expect(JSON.parse(storage.values.get("davora-ui-settings") ?? "null")).toMatchObject({ videoMuted: true });

    act(() => {
      hook.result.current.handleVideoMutedChange(false);
    });
    expect(hook.result.current.uiSettings.videoMuted).toBe(false);
    expect(JSON.parse(storage.values.get("davora-ui-settings") ?? "null")).toMatchObject({ videoMuted: false });
    expect(announceStatus).not.toHaveBeenCalled();
  });
});
