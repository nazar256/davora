import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { SearchResult } from "@davora/shared";

import { executeSearch } from "./controller";
import { sameSearchRequest, searchReducer, type SearchEvent, type SearchKey, type SearchRequest, type SearchState } from "./model";
import type { SearchPorts } from "./ports";

export interface UseSearchInput {
  readonly key?: SearchKey;
  readonly token?: string;
  readonly mode: "online" | "explicit-offline";
  readonly explicitOfflineItems: SearchResult[];
  readonly ports: SearchPorts;
  readonly onSessionTerminated?: (reason: "unauthorized" | "reconnect-required", error: Error, key: SearchKey, contextToken: object) => void;
}

interface ActiveRequest { readonly request: SearchRequest; readonly abortHandle: { readonly signal: AbortSignal; abort(): void } }

const stateMatches = (state: SearchState, token: object): boolean =>
  state.kind === "inactive" || (state.kind === "searching" ? state.request.contextToken : state.contextToken) === token;

const fallbackState = (input: UseSearchInput, contextToken: object): SearchState => {
  if (!input.key || (input.mode === "online" && !input.token)) return { kind: "inactive" };
  if (input.mode === "explicit-offline") {
    return { kind: "offline", key: input.key, contextToken, items: input.explicitOfflineItems, source: "explicit-offline" };
  }
  return { kind: "searching", request: { key: input.key, generation: 0, contextToken } };
};

export const useSearch = (input: UseSearchInput) => {
  const [state, dispatch] = useReducer(searchReducer, { kind: "inactive" });
  const generationRef = useRef(0);
  const activeRef = useRef<ActiveRequest>();
  const inputRef = useRef(input);
  const offlineSnapshot = input.mode === "explicit-offline" ? input.explicitOfflineItems : undefined;
  const contextToken = useMemo(() => ({
    accountId: input.key?.accountId, cacheNamespace: input.key?.cacheNamespace, path: input.key?.path,
    query: input.key?.query, token: input.token, mode: input.mode, ports: input.ports, offlineSnapshot
  }), [input.key?.accountId, input.key?.cacheNamespace, input.key?.path, input.key?.query, input.token, input.mode, input.ports, offlineSnapshot]);
  const committedContextRef = useRef(contextToken);
  useLayoutEffect(() => { inputRef.current = input; committedContextRef.current = contextToken; }, [contextToken, input]);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    active.abortHandle.abort();
    dispatch({ type: "request-cancelled", request: active.request });
    activeRef.current = undefined;
  }, []);

  const run = useCallback(async () => {
    cancel();
    const current = inputRef.current;
    if (!current.key || (current.mode === "online" && !current.token)) {
      dispatch({ type: "reset" });
      return;
    }
    const request: SearchRequest = { key: current.key, generation: ++generationRef.current, contextToken: committedContextRef.current };
    const abortHandle = current.ports.createAbortHandle();
    activeRef.current = { request, abortHandle };
    const emit = (event: SearchEvent): boolean => {
      const active = activeRef.current;
      if (committedContextRef.current !== request.contextToken || ("request" in event && (!active || !sameSearchRequest(active.request, event.request)))) return false;
      dispatch(event);
      return true;
    };
    try {
      await executeSearch({ request, token: current.token, mode: current.mode, explicitOfflineItems: current.explicitOfflineItems, signal: abortHandle.signal }, current.ports, {
        emit,
        onSessionTerminated: (reason, error) => current.onSessionTerminated?.(reason, error, request.key, request.contextToken)
      });
    } finally {
      if (activeRef.current && sameSearchRequest(activeRef.current.request, request)) activeRef.current = undefined;
    }
  }, [cancel]);
  useEffect(() => { void run(); return cancel; }, [cancel, contextToken, run]);
  const visibleState = stateMatches(state, contextToken) ? state : fallbackState(input, contextToken);
  return { state: visibleState, contextToken, cancel };
};
