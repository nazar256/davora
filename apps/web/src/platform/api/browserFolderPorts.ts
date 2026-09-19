import type { FileEntry } from "@davora/shared";
import { basename, fileEntrySchema, parseNormalizedPath } from "@davora/shared";

import { ApiRequestError, listFiles as requestFolder } from "../../lib/api";

interface FolderCache {
  readFolder(cacheNamespace: string, path: string):
    | { readonly kind: "hit"; readonly cachedAt: string; readonly items: FileEntry[] }
    | { readonly kind: "miss" };
  writeFolder(cacheNamespace: string, path: string, items: readonly FileEntry[]): unknown;
}

interface FolderApi {
  listFiles(path: string, token: string, signal: AbortSignal): Promise<{ path: string; items: unknown }>;
}

const canonicalPath = (path: string): string | undefined => {
  try {
    const normalized = parseNormalizedPath(path);
    return normalized === path ? normalized : undefined;
  } catch {
    return undefined;
  }
};

const parseFolderItems = (value: unknown, folderPath: string): FileEntry[] | undefined => {
  if (canonicalPath(folderPath) === undefined || !Array.isArray(value)) {
    return undefined;
  }
  const items: FileEntry[] = [];
  for (const candidate of value) {
    const parsed = fileEntrySchema.safeParse(candidate);
    if (!parsed.success || canonicalPath(parsed.data.path) === undefined || basename(parsed.data.path) !== parsed.data.name) {
      return undefined;
    }
    const belongsToFolder = folderPath === ""
      ? parsed.data.path !== ""
      : parsed.data.path.startsWith(`${folderPath}/`);
    if (!belongsToFolder) {
      return undefined;
    }
    items.push(parsed.data);
  }
  return items;
};

const isTransient = (error: unknown): boolean => {
  if (error instanceof ApiRequestError) {
    return error.status >= 500 && error.code !== "config_error";
  }
  return error instanceof TypeError
    || (error instanceof Error && /fetch|network|proxy|socket|connection/i.test(error.message));
};

const classifyFolderError = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "cancelled" } as const;
  }
  const normalized = error instanceof Error ? error : new Error("Unable to load folder.");
  if (normalized instanceof ApiRequestError && normalized.status === 401) {
    return { kind: "unauthorized", error: normalized } as const;
  }
  if (normalized instanceof ApiRequestError && normalized.code === "account_reconnect_required") {
    return { kind: "reconnect-required", error: normalized } as const;
  }
  return isTransient(normalized)
    ? { kind: "transient", error: normalized } as const
    : { kind: "failure", error: normalized } as const;
};

export const createBrowserFolderPorts = (
  cache: FolderCache,
  api: FolderApi = { listFiles: requestFolder }
) => ({
  createAbortHandle: () => new AbortController(),
  async loadFolder(input: { path: string; token: string; signal: AbortSignal }) {
    try {
      const response = await api.listFiles(input.path, input.token, input.signal);
      const items = response.path === input.path ? parseFolderItems(response.items, input.path) : undefined;
      if (!items) {
        return { kind: "failure", error: new Error("The server returned invalid folder entries.") } as const;
      }
      return { kind: "success", items } as const;
    } catch (error) {
      return classifyFolderError(error);
    }
  },
  readCachedFolder(cacheNamespace: string, path: string) {
    const result = cache.readFolder(cacheNamespace, path);
    return result.kind === "hit" ? { items: result.items, cachedAt: result.cachedAt } : undefined;
  },
  writeCachedFolder(cacheNamespace: string, path: string, items: FileEntry[]): void {
    cache.writeFolder(cacheNamespace, path, items);
  }
});
