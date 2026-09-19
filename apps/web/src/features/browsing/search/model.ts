import type { SearchResult } from "@davora/shared";
import { assertNever } from "@davora/shared";

export interface SearchKey {
  readonly accountId: string;
  readonly cacheNamespace: string;
  readonly path: string;
  readonly query: string;
}

export interface SearchRequest {
  readonly key: SearchKey;
  readonly generation: number;
  readonly contextToken: object;
}

export type SearchState =
  | { readonly kind: "inactive" }
  | { readonly kind: "searching"; readonly request: SearchRequest }
  | { readonly kind: "ready"; readonly key: SearchKey; readonly contextToken: object; readonly items: SearchResult[]; readonly source: "live" }
  | { readonly kind: "fallback"; readonly key: SearchKey; readonly contextToken: object; readonly items: SearchResult[]; readonly source: "cache"; readonly reason: "live-failure" }
  | { readonly kind: "offline"; readonly key: SearchKey; readonly contextToken: object; readonly items: SearchResult[]; readonly source: "explicit-offline" }
  | { readonly kind: "failed"; readonly key: SearchKey; readonly contextToken: object; readonly reason: "live-failure" };

export type SearchEvent =
  | { readonly type: "reset" }
  | { readonly type: "request-started"; readonly request: SearchRequest }
  | { readonly type: "live-response-accepted"; readonly request: SearchRequest; readonly items: SearchResult[] }
  | { readonly type: "cached-fallback-shown"; readonly request: SearchRequest; readonly items: SearchResult[] }
  | { readonly type: "explicit-offline-shown"; readonly request: SearchRequest; readonly items: SearchResult[] }
  | { readonly type: "load-failed"; readonly request: SearchRequest }
  | { readonly type: "request-cancelled"; readonly request: SearchRequest };

export const sameSearchKey = (left: SearchKey, right: SearchKey): boolean =>
  left.accountId === right.accountId
  && left.cacheNamespace === right.cacheNamespace
  && left.path === right.path
  && left.query === right.query;

export const sameSearchRequest = (left: SearchRequest, right: SearchRequest): boolean =>
  left.generation === right.generation
  && left.contextToken === right.contextToken
  && sameSearchKey(left.key, right.key);

const accepts = (state: SearchState, request: SearchRequest): boolean =>
  state.kind === "searching" && sameSearchRequest(state.request, request);

export const searchReducer = (state: SearchState, event: SearchEvent): SearchState => {
  switch (event.type) {
    case "reset": return { kind: "inactive" };
    case "request-started": return { kind: "searching", request: event.request };
    case "live-response-accepted":
      return accepts(state, event.request)
        ? { kind: "ready", key: event.request.key, contextToken: event.request.contextToken, items: event.items, source: "live" }
        : state;
    case "cached-fallback-shown":
      return accepts(state, event.request)
        ? { kind: "fallback", key: event.request.key, contextToken: event.request.contextToken, items: event.items, source: "cache", reason: "live-failure" }
        : state;
    case "explicit-offline-shown":
      return accepts(state, event.request)
        ? { kind: "offline", key: event.request.key, contextToken: event.request.contextToken, items: event.items, source: "explicit-offline" }
        : state;
    case "load-failed":
      return accepts(state, event.request)
        ? { kind: "failed", key: event.request.key, contextToken: event.request.contextToken, reason: "live-failure" }
        : state;
    case "request-cancelled": return accepts(state, event.request) ? { kind: "inactive" } : state;
    default: return assertNever(event, "search event");
  }
};
