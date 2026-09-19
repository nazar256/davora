import { getSortModeLabel, type SortMode } from "../../browsing";
import { formatFileSize, getFileSizeDisplayModeLabel, type FileSizeDisplayMode } from "../../../lib/fileSize";
import type { ThemeMode } from "../model";

export function buildFileSizeDisplayModeStatusMessage(mode: FileSizeDisplayMode): string {
  return `File sizes now use ${getFileSizeDisplayModeLabel(mode)}.`;
}

export function buildThemeModeStatusMessage(mode: ThemeMode): string {
  return `${mode[0].toUpperCase() + mode.slice(1)} theme selected.`;
}

export function buildMaxCacheableFileSizeStatusMessage(
  limitBytes: number,
  fileSizeDisplayMode: FileSizeDisplayMode
): string {
  return `Files up to ${formatFileSize(limitBytes, fileSizeDisplayMode)} stay eligible for browser blob caching.`;
}

export function buildPreviewFreshnessIntervalStatusMessage(intervalSeconds: number): string {
  return `Cached previews will be checked after ${intervalSeconds} seconds.`;
}

export function buildKeepAwakeEnabledStatusMessage(enabled: boolean): string {
  return enabled
    ? "Keep awake is enabled for active media and transfers."
    : "Keep awake is disabled on this device.";
}

export function buildShowHiddenFilesStatusMessage(show: boolean): string {
  return show ? "Hidden files and folders are now visible." : "Hidden files and folders are now hidden.";
}

export function buildExperimentalHeicPreviewEnabledStatusMessage(enabled: boolean): string {
  return enabled
    ? "Experimental HEIC preview is enabled for this browser."
    : "Experimental HEIC preview is disabled.";
}

export function buildSortModeStatusMessage(mode: SortMode): string {
  return `Sorted by ${getSortModeLabel(mode)}.`;
}
