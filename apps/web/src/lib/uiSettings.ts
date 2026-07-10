import type { FileSizeDisplayMode } from "./fileSize";
import { isFileSizeDisplayMode } from "./fileSize";

const STORAGE_KEY = "davora-ui-settings";

export type SortMode = "name-asc" | "name-desc" | "modified-desc" | "modified-asc" | "size-desc" | "size-asc";

export interface UiSettings {
  fileSizeDisplayMode: FileSizeDisplayMode;
  maxCacheableFileSizeBytes: number;
  imagePreviewFitMode: "fill" | "fit";
  previewFreshnessIntervalSeconds: number;
  showHiddenFiles: boolean;
  experimentalHeicPreviewEnabled: boolean;
  sortMode: SortMode;
}

const DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MIN_MAX_CACHEABLE_FILE_SIZE_BYTES = 1024 * 1024;
const MAX_MAX_CACHEABLE_FILE_SIZE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_PREVIEW_FRESHNESS_INTERVAL_SECONDS = 60;
const MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS = 1;
const MAX_PREVIEW_FRESHNESS_INTERVAL_SECONDS = 365 * 24 * 60 * 60;

function clampMaxCacheableFileSizeBytes(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES;
  }

  return Math.min(
    MAX_MAX_CACHEABLE_FILE_SIZE_BYTES,
    Math.max(MIN_MAX_CACHEABLE_FILE_SIZE_BYTES, Math.round(value ?? DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES))
  );
}

function clampPreviewFreshnessIntervalSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREVIEW_FRESHNESS_INTERVAL_SECONDS;
  }

  return Math.min(
    MAX_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
    Math.max(MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS, Math.round(value ?? DEFAULT_PREVIEW_FRESHNESS_INTERVAL_SECONDS))
  );
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  fileSizeDisplayMode: "human",
  maxCacheableFileSizeBytes: DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES,
  imagePreviewFitMode: "fill",
  previewFreshnessIntervalSeconds: DEFAULT_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
  showHiddenFiles: false,
  experimentalHeicPreviewEnabled: false,
  sortMode: "name-asc"
};

const VALID_SORT_MODES: SortMode[] = ["name-asc", "name-desc", "modified-desc", "modified-asc", "size-desc", "size-asc"];

function normalizeSortMode(value: unknown): SortMode {
  return VALID_SORT_MODES.includes(value as SortMode) ? (value as SortMode) : "name-asc";
}

export function loadUiSettings(): UiSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_UI_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    const fileSizeDisplayMode = parsed.fileSizeDisplayMode;
    return {
      fileSizeDisplayMode: fileSizeDisplayMode && isFileSizeDisplayMode(fileSizeDisplayMode) ? fileSizeDisplayMode : "human",
      maxCacheableFileSizeBytes: clampMaxCacheableFileSizeBytes(parsed.maxCacheableFileSizeBytes),
      imagePreviewFitMode: parsed.imagePreviewFitMode === "fit" ? "fit" : "fill",
      previewFreshnessIntervalSeconds: clampPreviewFreshnessIntervalSeconds(parsed.previewFreshnessIntervalSeconds),
      showHiddenFiles: parsed.showHiddenFiles === true,
      experimentalHeicPreviewEnabled: parsed.experimentalHeicPreviewEnabled === true,
      sortMode: normalizeSortMode(parsed.sortMode)
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return DEFAULT_UI_SETTINGS;
  }
}

export function saveUiSettings(settings: UiSettings): UiSettings {
  const normalizedSettings: UiSettings = {
    fileSizeDisplayMode: settings.fileSizeDisplayMode,
    maxCacheableFileSizeBytes: clampMaxCacheableFileSizeBytes(settings.maxCacheableFileSizeBytes),
    imagePreviewFitMode: settings.imagePreviewFitMode === "fit" ? "fit" : "fill",
    previewFreshnessIntervalSeconds: clampPreviewFreshnessIntervalSeconds(settings.previewFreshnessIntervalSeconds),
    showHiddenFiles: settings.showHiddenFiles === true,
    experimentalHeicPreviewEnabled: settings.experimentalHeicPreviewEnabled === true,
    sortMode: normalizeSortMode(settings.sortMode)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedSettings));
  return normalizedSettings;
}

export {
  DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES,
  DEFAULT_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
  MAX_MAX_CACHEABLE_FILE_SIZE_BYTES,
  MAX_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
  MIN_MAX_CACHEABLE_FILE_SIZE_BYTES,
  MIN_PREVIEW_FRESHNESS_INTERVAL_SECONDS,
  clampMaxCacheableFileSizeBytes,
  clampPreviewFreshnessIntervalSeconds
};
