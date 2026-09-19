import type { SettingsStorage } from "../ports";

export interface FakeSettingsStorage extends SettingsStorage {
  readonly values: Map<string, string>;
  readonly readKeys: string[];
  readonly removedKeys: string[];
}

export const createFakeSettingsStorage = (initial: Record<string, string> = {}): FakeSettingsStorage => {
  const values = new Map(Object.entries(initial));
  const readKeys: string[] = [];
  const removedKeys: string[] = [];
  return {
    values,
    readKeys,
    removedKeys,
    getItem(key) {
      readKeys.push(key);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      removedKeys.push(key);
      values.delete(key);
    }
  };
};
