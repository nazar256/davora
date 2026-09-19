import { describe, expect, it } from "vitest";

import { DEFAULT_UI_SETTINGS } from "../model";
import { createSettingsService } from "../service";
import { createFakeSettingsStorage } from "../testing/fakeStorage";
import { saveUiSettingChange } from "./controller";

describe("saveUiSettingChange", () => {
  it("merges defaults, current settings, and patch before saving", () => {
    const storage = createFakeSettingsStorage();
    const service = createSettingsService(storage);
    const current = {
      ...DEFAULT_UI_SETTINGS,
      themeMode: "dark" as const,
      fileSizeDisplayMode: "kb" as const,
      sortMode: "modified-desc" as const
    };
    service.save(current);

    const saved = saveUiSettingChange(current, { fileSizeDisplayMode: "mb" }, service);

    expect(saved.fileSizeDisplayMode).toBe("mb");
    expect(saved.themeMode).toBe("dark");
    expect(saved.sortMode).toBe("modified-desc");
    expect(JSON.parse(storage.values.get("davora-ui-settings") ?? "null")).toEqual(saved);
  });

  it("normalizes invalid patch values through the settings service", () => {
    const storage = createFakeSettingsStorage();
    const service = createSettingsService(storage);

    const saved = saveUiSettingChange(DEFAULT_UI_SETTINGS, { previewFreshnessIntervalSeconds: 300.4 }, service);

    expect(saved.previewFreshnessIntervalSeconds).toBe(300);
  });
});
