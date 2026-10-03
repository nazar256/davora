import type { SearchResult } from "@davora/shared";

import type { SearchEvent, SearchRequest } from "./model";
import type { SearchLoadOutcome, SearchPorts } from "./ports";

export interface SearchLoadInput {
  readonly request: SearchRequest;
  readonly token?: string;
  readonly mode: "online" | "explicit-offline";
  readonly explicitOfflineItems: SearchResult[];
  readonly signal: AbortSignal;
}

export interface SearchControllerCallbacks {
  emit(event: SearchEvent): boolean;
  onSessionTerminated(reason: "unauthorized" | "reconnect-required", error: Error): void;
}

export const executeSearch = async (
  input: SearchLoadInput,
  ports: SearchPorts,
  callbacks: SearchControllerCallbacks
): Promise<void> => {
  if (!callbacks.emit({ type: "request-started", request: input.request })) return;
  if (input.mode === "explicit-offline") {
    callbacks.emit({ type: "explicit-offline-shown", request: input.request, items: input.explicitOfflineItems });
    return;
  }
  if (!input.token || input.signal.aborted) {
    callbacks.emit({ type: "request-cancelled", request: input.request });
    return;
  }
  let outcome: SearchLoadOutcome;
  try {
    outcome = await ports.loadSearch({ path: input.request.key.path, query: input.request.key.query, token: input.token, signal: input.signal });
  } catch (error) {
    outcome = { kind: "failure", error: error instanceof Error ? error : new Error("Unable to search files.") };
  }
  if (outcome.kind === "success") {
    if (callbacks.emit({ type: "live-response-accepted", request: input.request, items: outcome.items, completeness: outcome.completeness })) {
      try { ports.writeCachedSearch(input.request.key.cacheNamespace, input.request.key.path, input.request.key.query, outcome.items); } catch { /* optional cache */ }
    }
    return;
  }
  if (outcome.kind === "cancelled") {
    callbacks.emit({ type: "request-cancelled", request: input.request });
    return;
  }
  if (outcome.kind === "unauthorized" || outcome.kind === "reconnect-required") {
    if (callbacks.emit({ type: "request-cancelled", request: input.request })) callbacks.onSessionTerminated(outcome.kind, outcome.error);
    return;
  }
  let cached: SearchResult[] | undefined;
  try { cached = ports.readCachedSearch(input.request.key.cacheNamespace, input.request.key.path, input.request.key.query); } catch { cached = undefined; }
  callbacks.emit(cached === undefined
    ? { type: "load-failed", request: input.request }
    : { type: "cached-fallback-shown", request: input.request, items: cached });
};
