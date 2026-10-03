import type { FileEntry } from "@davora/shared";

import { listFiles as requestListFiles } from "../../lib/api";

interface FavouriteResolveCache {
  writeFolder(namespace: string, parentPath: string, items: readonly FileEntry[], completeness: "complete" | "partial"): unknown;
}

interface FavouriteResolveApi {
  listFiles(path: string, token: string): Promise<{ completeness: "complete" | "partial"; readonly items: readonly FileEntry[] }>;
}

interface FavouriteResolveRuntime {
  listFiles(parentPath: string, token: string): Promise<{ completeness: "complete" | "partial"; readonly items: readonly FileEntry[] }>;
  cacheFolder(namespace: string, parentPath: string, items: readonly FileEntry[], completeness: "complete" | "partial"): void;
}

export function createBrowserFavouriteResolveRuntime(
  cache: FavouriteResolveCache,
  api: FavouriteResolveApi = { listFiles: requestListFiles }
): FavouriteResolveRuntime {
  return {
    listFiles: async (parentPath, token) => {
      try {
        const listing = await api.listFiles(parentPath, token);
        return { items: listing.items, completeness: listing.completeness };
      } catch {
        throw new Error("Unable to resolve this favourite.");
      }
    },
    cacheFolder: (namespace, parentPath, items, completeness) => {
      cache.writeFolder(namespace, parentPath, items, completeness);
    }
  };
}
