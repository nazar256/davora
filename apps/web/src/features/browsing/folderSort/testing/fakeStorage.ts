import type { FolderSortService, FolderSortStorage, FolderSortStorageResult } from "../ports";
import { createFolderSortService } from "../service";

interface FakeStorageFailures {
  failRead?: boolean;
  failWrite?: boolean;
  failDelete?: boolean;
  failList?: boolean;
}

export interface FakeFolderSortStorage extends FolderSortStorage {
  readonly values: Map<string, string>;
  readonly deletedKeys: string[];
  failRead: boolean;
  failWrite: boolean;
  failDelete: boolean;
  failList: boolean;
}

const failure = <T>(operation: string): FolderSortStorageResult<T> => ({
  ok: false,
  error: new Error(`${operation} failed`)
});

export const createFakeFolderSortStorage = (
  initial: Record<string, string> = {},
  failures: FakeStorageFailures = {}
): FakeFolderSortStorage => {
  const storage: FakeFolderSortStorage = {
    values: new Map(Object.entries(initial)),
    deletedKeys: [],
    failRead: failures.failRead ?? false,
    failWrite: failures.failWrite ?? false,
    failDelete: failures.failDelete ?? false,
    failList: failures.failList ?? false,
    readItem(key) {
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
    },
    listKeys() {
      return storage.failList ? failure("list") : { ok: true, value: [...storage.values.keys()] };
    }
  };
  return storage;
};

export const createMemoryFolderSortService = (
  initial: Record<string, string> = {}
): FolderSortService => createFolderSortService(createFakeFolderSortStorage(initial));
