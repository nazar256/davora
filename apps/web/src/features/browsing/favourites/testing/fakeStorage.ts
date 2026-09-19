import type { FavouritesStorage, StorageOperationResult } from "../ports";

interface FakeStorageFailures {
  failRead?: boolean;
  failWrite?: boolean;
  failDelete?: boolean;
}

export interface FakeFavouritesStorage extends FavouritesStorage {
  readonly values: Map<string, string>;
  readonly readKeys: string[];
  readonly deletedKeys: string[];
  failRead: boolean;
  failWrite: boolean;
  failDelete: boolean;
}

const failure = <T>(operation: string): StorageOperationResult<T> => ({
  ok: false,
  error: new Error(`${operation} failed`)
});

export const createFakeFavouritesStorage = (
  initial: Record<string, string> = {},
  failures: FakeStorageFailures = {}
): FakeFavouritesStorage => {
  const storage: FakeFavouritesStorage = {
    values: new Map(Object.entries(initial)),
    readKeys: [],
    deletedKeys: [],
    failRead: failures.failRead ?? false,
    failWrite: failures.failWrite ?? false,
    failDelete: failures.failDelete ?? false,
    readItem(key) {
      storage.readKeys.push(key);
      return storage.failRead ? failure("read") : { ok: true, value: storage.values.get(key) ?? null };
    },
    writeItem(key, value) {
      if (storage.failWrite) {
        return failure("write");
      }
      storage.values.set(key, value);
      return { ok: true, value: undefined };
    },
    deleteItem(key) {
      storage.deletedKeys.push(key);
      if (storage.failDelete) {
        return failure("delete");
      }
      storage.values.delete(key);
      return { ok: true, value: undefined };
    }
  };
  return storage;
};
