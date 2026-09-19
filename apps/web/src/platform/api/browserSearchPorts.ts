import type { SearchResult } from "@davora/shared";
import { basename, parseNormalizedPath, searchResultSchema } from "@davora/shared";

import { ApiRequestError, searchFiles as requestSearch } from "../../lib/api";

interface SearchCache {
  readSearch(cacheNamespace: string, path: string, query: string):
    | { readonly kind: "hit"; readonly items: SearchResult[] }
    | { readonly kind: "miss" };
  writeSearch(cacheNamespace: string, path: string, query: string, items: readonly SearchResult[]): unknown;
}

interface SearchApi {
  searchFiles(path: string, query: string, token: string, signal: AbortSignal): Promise<{ path: string; query: string; items: unknown }>;
}

const isCanonical = (path: string): boolean => {
  try { return parseNormalizedPath(path) === path; } catch { return false; }
};

const parseItems = (value: unknown, path: string): SearchResult[] | undefined => {
  if (!isCanonical(path) || !Array.isArray(value)) return undefined;
  const items: SearchResult[] = [];
  for (const candidate of value) {
    const parsed = searchResultSchema.safeParse(candidate);
    if (!parsed.success || basename(parsed.data.path) !== parsed.data.name) return undefined;
    const inScope = path === "" ? parsed.data.path !== "" : parsed.data.path === path || parsed.data.path.startsWith(`${path}/`);
    if (!inScope) return undefined;
    items.push(parsed.data);
  }
  return items;
};

export const createBrowserSearchPorts = (
  cache: SearchCache,
  api: SearchApi = { searchFiles: requestSearch }
) => ({
  createAbortHandle: () => new AbortController(),
  async loadSearch(input: { path: string; query: string; token: string; signal: AbortSignal }) {
    try {
      const response = await api.searchFiles(input.path, input.query, input.token, input.signal);
      const items = response.path === input.path && response.query === input.query ? parseItems(response.items, input.path) : undefined;
      return items ? { kind: "success", items } as const : { kind: "failure", error: new Error("The server returned invalid search results.") } as const;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" } as const;
      const normalized = error instanceof Error ? error : new Error("Unable to search files.");
      if (normalized instanceof ApiRequestError && normalized.status === 401) return { kind: "unauthorized", error: normalized } as const;
      if (normalized instanceof ApiRequestError && normalized.code === "account_reconnect_required") return { kind: "reconnect-required", error: normalized } as const;
      return { kind: "failure", error: normalized } as const;
    }
  },
  readCachedSearch(cacheNamespace: string, path: string, query: string): SearchResult[] | undefined {
    const result = cache.readSearch(cacheNamespace, path, query);
    return result.kind === "hit" ? result.items : undefined;
  },
  writeCachedSearch(cacheNamespace: string, path: string, query: string, items: SearchResult[]): void {
    cache.writeSearch(cacheNamespace, path, query, items);
  }
});
