import { describe, expect, it } from "vitest";

import {
  DEFAULT_UI_SETTINGS,
  MAX_MAX_CACHEABLE_FILE_SIZE_BYTES,
  MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS
} from "./model";
import { createSettingsService, UI_SETTINGS_STORAGE_KEY } from "./service";
import { createFakeSettingsStorage } from "./testing/fakeStorage";

describe("settings service", () => {
  it("returns defaults when settings are missing", () => {
    const storage = createFakeSettingsStorage();

    expect(createSettingsService(storage).load()).toEqual(DEFAULT_UI_SETTINGS);
    expect(storage.readKeys).toEqual([UI_SETTINGS_STORAGE_KEY]);
  });

  it("normalizes partial stored settings and preserves valid fields", () => {
    const storage = createFakeSettingsStorage({
      [UI_SETTINGS_STORAGE_KEY]: JSON.stringify({
        themeMode: "dark",
        maxCacheableFileSizeBytes: Number.MAX_SAFE_INTEGER,
        previewFreshnessIntervalSeconds: 0,
        keepAwakeEnabled: false,
        showHiddenFiles: true,
        sortMode: "modified-desc"
      })
    });

    expect(createSettingsService(storage).load()).toEqual({
      ...DEFAULT_UI_SETTINGS,
      themeMode: "dark",
      maxCacheableFileSizeBytes: MAX_MAX_CACHEABLE_FILE_SIZE_BYTES,
      previewFreshnessIntervalSeconds: MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
      keepAwakeEnabled: false,
      showHiddenFiles: true,
      sortMode: "modified-desc"
    });
  });

  it("removes corrupt JSON and returns defaults", () => {
    const storage = createFakeSettingsStorage({ [UI_SETTINGS_STORAGE_KEY]: "{" });

    expect(createSettingsService(storage).load()).toEqual(DEFAULT_UI_SETTINGS);
    expect(storage.removedKeys).toEqual([UI_SETTINGS_STORAGE_KEY]);
  });

  it("treats valid JSON with invalid persisted fields as untrusted data", () => {
    const storage = createFakeSettingsStorage({
      [UI_SETTINGS_STORAGE_KEY]: JSON.stringify({
        themeMode: 1,
        fileSizeDisplayMode: {},
        maxCacheableFileSizeBytes: "unbounded",
        imagePreviewFitMode: true,
        previewFreshnessIntervalSeconds: null,
        keepAwakeEnabled: "false",
        showHiddenFiles: 1,
        experimentalHeicPreviewEnabled: "true",
        sortMode: "newest"
      })
    });

    expect(createSettingsService(storage).load()).toEqual(DEFAULT_UI_SETTINGS);
  });

  it("treats non-object JSON as missing settings", () => {
    const storage = createFakeSettingsStorage({ [UI_SETTINGS_STORAGE_KEY]: "null" });

    expect(createSettingsService(storage).load()).toEqual(DEFAULT_UI_SETTINGS);
  });

  it("normalizes, persists, and returns saved settings", () => {
    const storage = createFakeSettingsStorage();
    const settings = {
      ...DEFAULT_UI_SETTINGS,
      themeMode: "light" as const,
      maxCacheableFileSizeBytes: Number.POSITIVE_INFINITY,
      previewFreshnessIntervalSeconds: 300.4,
      imagePreviewFitMode: "fit" as const
    };

    const saved = createSettingsService(storage).save(settings);

    expect(saved).toEqual({
      ...settings,
      maxCacheableFileSizeBytes: DEFAULT_UI_SETTINGS.maxCacheableFileSizeBytes,
      previewFreshnessIntervalSeconds: 300
    });
    expect(JSON.parse(storage.values.get(UI_SETTINGS_STORAGE_KEY) ?? "null")).toEqual(saved);
  });
});
