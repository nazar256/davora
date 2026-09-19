import type { FileEntry } from "@davora/shared";

export interface CachedFolder {
  readonly items: FileEntry[];
  readonly cachedAt?: string;
}

export type FolderLoadOutcome =
  | { readonly kind: "success"; readonly items: FileEntry[] }
  | { readonly kind: "unauthorized" | "reconnect-required" | "transient" | "failure"; readonly error: Error }
  | { readonly kind: "cancelled" };

export interface FolderPorts {
  createAbortHandle(): { readonly signal: AbortSignal; abort(): void };
  loadFolder(input: { path: string; token: string; signal: AbortSignal }): Promise<FolderLoadOutcome>;
  readCachedFolder(cacheNamespace: string, path: string): CachedFolder | undefined;
  writeCachedFolder(cacheNamespace: string, path: string, items: FileEntry[]): void;
}
