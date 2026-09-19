export interface BrowserStringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readItem(key: string): BrowserStorageResult<string | null>;
  writeItem(key: string, value: string): BrowserStorageResult<void>;
  deleteItem(key: string): BrowserStorageResult<void>;
  keys(): readonly string[];
  listKeys(): BrowserStorageResult<readonly string[]>;
}

export type BrowserStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

interface RawStringStorage {
  readonly length?: number;
  key?(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

export const createBrowserStringStorage = (
  resolveStorage: () => RawStringStorage = () => globalThis.localStorage
): BrowserStringStorage => {
  const resolved = (() => {
    try {
      return { storage: resolveStorage() };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error("Browser storage is unavailable.") };
    }
  })();

  const readItem = (key: string): BrowserStorageResult<string | null> => {
    if (!resolved.storage) {
      return { ok: false, error: resolved.error ?? new Error("Browser storage is unavailable.") };
    }
    try {
      return { ok: true, value: resolved.storage.getItem(key) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error("Browser storage read failed.") };
    }
  };

  const writeItem = (key: string, value: string): BrowserStorageResult<void> => {
    if (!resolved.storage) {
      return { ok: false, error: resolved.error ?? new Error("Browser storage is unavailable.") };
    }
    try {
      resolved.storage.setItem(key, value);
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error("Browser storage write failed.") };
    }
  };

  const deleteItem = (key: string): BrowserStorageResult<void> => {
    if (!resolved.storage) {
      return { ok: false, error: resolved.error ?? new Error("Browser storage is unavailable.") };
    }
    try {
      resolved.storage.removeItem(key);
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error("Browser storage delete failed.") };
    }
  };

  const listKeys = (): BrowserStorageResult<readonly string[]> => {
    if (!resolved.storage) {
      return { ok: false, error: resolved.error ?? new Error("Browser storage is unavailable.") };
    }
    try {
      if (typeof resolved.storage.length === "number" && typeof resolved.storage.key === "function") {
        const keys: string[] = [];
        for (let index = 0; index < resolved.storage.length; index += 1) {
          const key = resolved.storage.key(index);
          if (key !== null) {
            keys.push(key);
          }
        }
        return { ok: true, value: keys };
      }
      return {
        ok: true,
        value: Object.keys(resolved.storage).filter((key) =>
          typeof Object.getOwnPropertyDescriptor(resolved.storage, key)?.value === "string")
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error("Browser storage enumeration failed.") };
    }
  };

  return {
    getItem(key) {
      const result = readItem(key);
      return result.ok ? result.value : null;
    },
    setItem(key, value) {
      writeItem(key, value);
    },
    removeItem(key) {
      deleteItem(key);
    },
    readItem,
    writeItem,
    deleteItem,
    keys() {
      const result = listKeys();
      return result.ok ? result.value : [];
    },
    listKeys
  };
};
