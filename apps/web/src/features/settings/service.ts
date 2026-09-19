import { DEFAULT_UI_SETTINGS, normalizeUiSettings, type UiSettings } from "./model";
import type { SettingsService, SettingsStorage } from "./ports";
import { UI_SETTINGS_STORAGE_KEY } from "./storageContract";

export { UI_SETTINGS_STORAGE_KEY } from "./storageContract";

export const createSettingsService = (storage: SettingsStorage): SettingsService => ({
  load(): UiSettings {
    const raw = storage.getItem(UI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_UI_SETTINGS;
    }
    try {
      return normalizeUiSettings(JSON.parse(raw));
    } catch {
      storage.removeItem(UI_SETTINGS_STORAGE_KEY);
      return DEFAULT_UI_SETTINGS;
    }
  },

  save(settings: UiSettings): UiSettings {
    const normalized = normalizeUiSettings(settings);
    storage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }
});
