import type { FileSizeDisplayMode } from "./fileSize";
import { isFileSizeDisplayMode } from "./fileSize";

const STORAGE_KEY = "davora-ui-settings";

export interface UiSettings {
  fileSizeDisplayMode: FileSizeDisplayMode;
  maxCacheableFileSizeBytes: number;
}

const DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MIN_MAX_CACHEABLE_FILE_SIZE_BYTES = 1024 * 1024;
const MAX_MAX_CACHEABLE_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

function clampMaxCacheableFileSizeBytes(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES;
  }

  return Math.min(
    MAX_MAX_CACHEABLE_FILE_SIZE_BYTES,
    Math.max(MIN_MAX_CACHEABLE_FILE_SIZE_BYTES, Math.round(value ?? DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES))
  );
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  fileSizeDisplayMode: "human",
  maxCacheableFileSizeBytes: DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES
};

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
      maxCacheableFileSizeBytes: clampMaxCacheableFileSizeBytes(parsed.maxCacheableFileSizeBytes)
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return DEFAULT_UI_SETTINGS;
  }
}

export function saveUiSettings(settings: UiSettings): UiSettings {
  const normalizedSettings: UiSettings = {
    fileSizeDisplayMode: settings.fileSizeDisplayMode,
    maxCacheableFileSizeBytes: clampMaxCacheableFileSizeBytes(settings.maxCacheableFileSizeBytes)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedSettings));
  return normalizedSettings;
}

export {
  DEFAULT_MAX_CACHEABLE_FILE_SIZE_BYTES,
  MAX_MAX_CACHEABLE_FILE_SIZE_BYTES,
  MIN_MAX_CACHEABLE_FILE_SIZE_BYTES,
  clampMaxCacheableFileSizeBytes
};
