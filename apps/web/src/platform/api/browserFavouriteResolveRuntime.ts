import type { FileEntry } from "@davora/shared";

import { listFiles as requestListFiles } from "../../lib/api";

interface FavouriteResolveCache {
  writeFolder(namespace: string, parentPath: string, items: readonly FileEntry[]): unknown;
}

interface FavouriteResolveApi {
  listFiles(path: string, token: string): Promise<{ readonly items: readonly FileEntry[] }>;
}

interface FavouriteResolveRuntime {
  listFiles(parentPath: string, token: string): Promise<{ readonly items: readonly FileEntry[] }>;
  cacheFolder(namespace: string, parentPath: string, items: readonly FileEntry[]): void;
}

export function createBrowserFavouriteResolveRuntime(
  cache: FavouriteResolveCache,
  api: FavouriteResolveApi = { listFiles: requestListFiles }
): FavouriteResolveRuntime {
  return {
    listFiles: async (parentPath, token) => {
      try {
        return { items: (await api.listFiles(parentPath, token)).items };
      } catch {
        throw new Error("Unable to resolve this favourite.");
      }
    },
    cacheFolder: (namespace, parentPath, items) => {
      cache.writeFolder(namespace, parentPath, items);
    }
  };
}
