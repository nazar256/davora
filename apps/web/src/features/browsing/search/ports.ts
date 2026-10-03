import type { SearchResult } from "@davora/shared";

export type SearchLoadOutcome =
  | { readonly kind: "success"; readonly items: SearchResult[]; readonly completeness: "complete" | "partial" }
  | { readonly kind: "unauthorized" | "reconnect-required" | "failure"; readonly error: Error }
  | { readonly kind: "cancelled" };

export interface SearchPorts {
  createAbortHandle(): { readonly signal: AbortSignal; abort(): void };
  loadSearch(input: { path: string; query: string; token: string; signal: AbortSignal }): Promise<SearchLoadOutcome>;
  readCachedSearch(cacheNamespace: string, path: string, query: string): SearchResult[] | undefined;
  writeCachedSearch(cacheNamespace: string, path: string, query: string, items: SearchResult[]): void;
}
