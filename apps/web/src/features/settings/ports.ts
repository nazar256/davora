import type { UiSettings } from "./model";

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SettingsService {
  load(): UiSettings;
  save(settings: UiSettings): UiSettings;
}
