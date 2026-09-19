import type { FileSizeDisplayMode } from "../../lib/fileSize";
import { isFileSizeDisplayMode } from "../../lib/fileSize";
import { isSortMode, type SortMode } from "../browsing";

export type ThemeMode = "system" | "light" | "dark";

export interface UiSettings {
  themeMode: ThemeMode;
  fileSizeDisplayMode: FileSizeDisplayMode;
  maxCacheableFileSizeBytes: number;
  imagePreviewFitMode: "fill" | "fit";
  previewFreshnessIntervalSeconds: number;
  keepAwakeEnabled: boolean;
  showHiddenFiles: boolean;
  experimentalHeicPreviewEnabled: boolean;
  diagnosticsEnabled: boolean;
  sortMode: SortMode;
}

export const DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES = 15 * 1024 * 1024;
export const MIN_MAX_CACHEABLE_FILE_SIZE_BYTES = 1024 * 1024;
export const MAX_MAX_CACHEABLE_FILE_SIZE_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_PREVIEW_FRESHNESS_INTERVAL_SECONDS = 60;
export const MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS = 1;
export const MAX_PREVIEW_FRESHNESS_INTERVAL_SECONDS = 365 * 24 * 60 * 60;

export const clampMaxCacheableFileSizeBytes = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES;
  }
  return Math.min(
    MAX_MAX_CACHEABLE_FILE_SIZE_BYTES,
    Math.max(MIN_MAX_CACHEABLE_FILE_SIZE_BYTES, Math.round(value))
  );
};

export const clampPreviewFreshnessIntervalSeconds = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PREVIEW_FRESHNESS_INTERVAL_SECONDS;
  }
  return Math.min(
    MAX_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
    Math.max(MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS, Math.round(value))
  );
};

export const DEFAULT_UI_SETTINGS: UiSettings = {
  themeMode: "system",
  fileSizeDisplayMode: "human",
  maxCacheableFileSizeBytes: DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES,
  imagePreviewFitMode: "fill",
  previewFreshnessIntervalSeconds: DEFAULT_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
  keepAwakeEnabled: true,
  showHiddenFiles: false,
  experimentalHeicPreviewEnabled: false,
  diagnosticsEnabled: false,
  sortMode: "name-asc"
};

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === "system" || value === "light" || value === "dark";

const isSettingsRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeUiSettings = (value: unknown): UiSettings => {
  const settings = isSettingsRecord(value) ? value : {};
  const fileSizeDisplayMode = settings.fileSizeDisplayMode;
  return {
    themeMode: isThemeMode(settings.themeMode) ? settings.themeMode : "system",
    fileSizeDisplayMode: typeof fileSizeDisplayMode === "string" && isFileSizeDisplayMode(fileSizeDisplayMode)
      ? fileSizeDisplayMode
      : "human",
    maxCacheableFileSizeBytes: clampMaxCacheableFileSizeBytes(settings.maxCacheableFileSizeBytes),
    imagePreviewFitMode: settings.imagePreviewFitMode === "fit" ? "fit" : "fill",
    previewFreshnessIntervalSeconds: clampPreviewFreshnessIntervalSeconds(settings.previewFreshnessIntervalSeconds),
    keepAwakeEnabled: settings.keepAwakeEnabled !== false,
    showHiddenFiles: settings.showHiddenFiles === true,
    experimentalHeicPreviewEnabled: settings.experimentalHeicPreviewEnabled === true,
    diagnosticsEnabled: settings.diagnosticsEnabled === true,
    sortMode: isSortMode(settings.sortMode) ? settings.sortMode : "name-asc"
  };
};
