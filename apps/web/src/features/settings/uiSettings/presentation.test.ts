import { describe, expect, it } from "vitest";

import {
  buildExperimentalHeicPreviewEnabledStatusMessage,
  buildFileSizeDisplayModeStatusMessage,
  buildKeepAwakeEnabledStatusMessage,
  buildMaxCacheableFileSizeStatusMessage,
  buildPreviewFreshnessIntervalStatusMessage,
  buildShowHiddenFilesStatusMessage,
  buildSortModeStatusMessage,
  buildThemeModeStatusMessage
} from "./presentation";

describe("ui settings presentation", () => {
  it("builds file-size mode status copy", () => {
    expect(buildFileSizeDisplayModeStatusMessage("kb")).toBe("File sizes now use KB.");
  });

  it("builds theme mode status copy", () => {
    expect(buildThemeModeStatusMessage("dark")).toBe("Dark theme selected.");
    expect(buildThemeModeStatusMessage("system")).toBe("System theme selected.");
  });

  it("builds max-cacheable size status copy using the current display mode", () => {
    expect(buildMaxCacheableFileSizeStatusMessage(32 * 1024 * 1024, "human")).toBe(
      "Files up to 32 MB stay eligible for browser blob caching."
    );
  });

  it("builds preview freshness status copy from normalized seconds", () => {
    expect(buildPreviewFreshnessIntervalStatusMessage(300)).toBe(
      "Cached previews will be checked after 300 seconds."
    );
  });

  it("builds keep-awake status copy", () => {
    expect(buildKeepAwakeEnabledStatusMessage(true)).toBe(
      "Keep awake is enabled for active media and transfers."
    );
    expect(buildKeepAwakeEnabledStatusMessage(false)).toBe("Keep awake is disabled on this device.");
  });

  it("builds hidden-files status copy", () => {
    expect(buildShowHiddenFilesStatusMessage(true)).toBe("Hidden files and folders are now visible.");
    expect(buildShowHiddenFilesStatusMessage(false)).toBe("Hidden files and folders are now hidden.");
  });

  it("builds experimental HEIC preview status copy", () => {
    expect(buildExperimentalHeicPreviewEnabledStatusMessage(true)).toBe(
      "Experimental HEIC preview is enabled for this browser."
    );
    expect(buildExperimentalHeicPreviewEnabledStatusMessage(false)).toBe(
      "Experimental HEIC preview is disabled."
    );
  });

  it("builds sort mode status copy", () => {
    expect(buildSortModeStatusMessage("name-asc")).toBe("Sorted by Name A-Z.");
  });
});
