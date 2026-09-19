import { isSortMode, type SortMode } from "../model";
import { decodeFolderSortStorageKey, folderSortStorageKey, planFolderSortNamespaceClear } from "./policy";
import type { FolderSortService, FolderSortStorage } from "./ports";

export const createFolderSortService = (storage: FolderSortStorage): FolderSortService => ({
  listNamespace(namespace) {
    const keys = storage.listKeys();
    if (!keys.ok) {
      return { kind: "list-failed", error: keys.error };
    }
    const entries = new Map<string, SortMode>();
    for (const key of keys.value) {
      const decoded = decodeFolderSortStorageKey(key);
      if (!decoded || decoded.namespace !== namespace) continue;
      const raw = storage.readItem(key);
      if (!raw.ok) {
        return { kind: "list-failed", error: raw.error };
      }
      if (raw.value === null) continue;
      if (!isSortMode(raw.value)) {
        storage.deleteItem(key);
        continue;
      }
      entries.set(decoded.path, raw.value);
    }
    return { kind: "listed", entries };
  },

  write(namespace, path, mode) {
    const written = storage.writeItem(folderSortStorageKey(namespace, path), mode);
    return written.ok ? { kind: "saved" } : { kind: "save-failed", error: written.error };
  },

  clearNamespace(namespace) {
    const keys = storage.listKeys();
    if (!keys.ok) {
      return { kind: "clear-failed", error: keys.error };
    }
    const planned = planFolderSortNamespaceClear(keys.value, namespace);
    for (const key of planned) {
      const removed = storage.deleteItem(key);
      if (!removed.ok) {
        return { kind: "clear-failed", error: removed.error };
      }
    }
    return { kind: "cleared", removedCount: planned.length };
  }
});
