import type { FileEntry } from "@davora/shared";
import { assertNever } from "@davora/shared";

export interface FolderKey {
  readonly accountId: string;
  readonly cacheNamespace: string;
  readonly path: string;
}

export interface FolderRequest {
  readonly key: FolderKey;
  readonly generation: number;
  readonly contextToken: object;
}

export type FolderState =
  | { readonly kind: "idle" }
  | { readonly kind: "initialLoading"; readonly request: FolderRequest }
  | { readonly kind: "refreshing"; readonly request: FolderRequest; readonly items: FileEntry[]; readonly source: "cache"; readonly cachedAt?: string }
  | { readonly kind: "ready"; readonly key: FolderKey; readonly contextToken: object; readonly items: FileEntry[]; readonly source: "live"; readonly message: "viewing" | "refreshed" | "silent" }
  | { readonly kind: "stale"; readonly key: FolderKey; readonly contextToken: object; readonly items: FileEntry[]; readonly source: "cache"; readonly reason: "offline" | "server-unavailable" | "refresh-failed"; readonly cachedAt?: string }
  | { readonly kind: "offline"; readonly key: FolderKey; readonly contextToken: object; readonly items: FileEntry[]; readonly source: "explicit-offline" }
  | { readonly kind: "failed"; readonly key: FolderKey; readonly contextToken: object; readonly error: Error; readonly reason: "live-failure" | "offline-cache-miss" | "server-cache-miss" };

export type FolderEvent =
  | { readonly type: "reset" }
  | { readonly type: "request-started"; readonly request: FolderRequest }
  | { readonly type: "cached-snapshot-shown"; readonly request: FolderRequest; readonly items: FileEntry[]; readonly cachedAt?: string; readonly mode: "online" | "offline" | "server-unavailable" }
  | { readonly type: "explicit-offline-snapshot-shown"; readonly request: FolderRequest; readonly items: FileEntry[] }
  | { readonly type: "live-response-accepted"; readonly request: FolderRequest; readonly items: FileEntry[]; readonly message: "viewing" | "refreshed" | "silent" }
  | { readonly type: "refresh-failed"; readonly request: FolderRequest; readonly items: FileEntry[] }
  | { readonly type: "load-failed"; readonly request: FolderRequest; readonly error: Error; readonly reason: "live-failure" | "offline-cache-miss" | "server-cache-miss" }
  | { readonly type: "request-cancelled"; readonly request: FolderRequest };

export const sameFolderKey = (left: FolderKey, right: FolderKey): boolean =>
  left.accountId === right.accountId
  && left.cacheNamespace === right.cacheNamespace
  && left.path === right.path;

export const sameFolderRequest = (left: FolderRequest, right: FolderRequest): boolean =>
  left.generation === right.generation
  && left.contextToken === right.contextToken
  && sameFolderKey(left.key, right.key);

const activeRequest = (state: FolderState): FolderRequest | undefined =>
  state.kind === "initialLoading" || state.kind === "refreshing" ? state.request : undefined;

const accepts = (state: FolderState, request: FolderRequest): boolean => {
  const current = activeRequest(state);
  return Boolean(current && sameFolderRequest(current, request));
};

export const folderReducer = (state: FolderState, event: FolderEvent): FolderState => {
  switch (event.type) {
    case "reset":
      return { kind: "idle" };
    case "request-started":
      return { kind: "initialLoading", request: event.request };
    case "cached-snapshot-shown":
      if (!accepts(state, event.request)) {
        return state;
      }
      return event.mode === "online"
        ? {
            kind: "refreshing",
            request: event.request,
            items: event.items,
            source: "cache",
            ...(event.cachedAt ? { cachedAt: event.cachedAt } : {})
          }
        : {
            kind: "stale",
            key: event.request.key,
            contextToken: event.request.contextToken,
            items: event.items,
            source: "cache",
            reason: event.mode,
            ...(event.cachedAt ? { cachedAt: event.cachedAt } : {})
          };
    case "explicit-offline-snapshot-shown":
      return accepts(state, event.request)
        ? { kind: "offline", key: event.request.key, contextToken: event.request.contextToken, items: event.items, source: "explicit-offline" }
        : state;
    case "live-response-accepted":
      return accepts(state, event.request)
        ? { kind: "ready", key: event.request.key, contextToken: event.request.contextToken, items: event.items, source: "live", message: event.message }
        : state;
    case "refresh-failed":
      return accepts(state, event.request)
        ? {
            kind: "stale",
            key: event.request.key,
            contextToken: event.request.contextToken,
            items: event.items,
            source: "cache",
            reason: "refresh-failed",
            ...(state.kind === "refreshing" && state.cachedAt ? { cachedAt: state.cachedAt } : {})
          }
        : state;
    case "load-failed":
      return accepts(state, event.request)
        ? { kind: "failed", key: event.request.key, contextToken: event.request.contextToken, error: event.error, reason: event.reason }
        : state;
    case "request-cancelled":
      return accepts(state, event.request) ? { kind: "idle" } : state;
    default:
      return assertNever(event, "folder event");
  }
};
