import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";

import { executeFolderLoad, type FolderMode } from "./controller";
import {
  folderReducer,
  sameFolderRequest,
  type FolderEvent,
  type FolderKey,
  type FolderRequest,
  type FolderState
} from "./model";
import type { FolderPorts } from "./ports";
import type { FileEntry } from "@davora/shared";

export interface UseFolderInput {
  readonly key?: FolderKey;
  readonly token?: string;
  readonly mode: FolderMode;
  readonly explicitOfflineItems: FileEntry[];
  readonly ports: FolderPorts;
  readonly onSessionTerminated?: (reason: "unauthorized" | "reconnect-required", error: Error, key: FolderKey, contextToken: object) => void;
  readonly onWorkerUnavailable?: (key: FolderKey, contextToken: object) => void;
  readonly onWorkerAvailable?: (key: FolderKey, contextToken: object) => void;
}

export interface FolderController {
  readonly state: FolderState;
  readonly contextToken: object;
  reload(options?: { preferCache?: boolean; announceStatus?: boolean }): Promise<"session-terminated" | undefined>;
  cancel(): void;
}

interface ActiveFolderRequest {
  readonly request: FolderRequest;
  readonly abortHandle: { readonly signal: AbortSignal; abort(): void };
}

const stateMatchesContext = (state: FolderState, contextToken: object): boolean => {
  if (state.kind === "idle") {
    return true;
  }
  return (state.kind === "initialLoading" || state.kind === "refreshing" ? state.request.contextToken : state.contextToken) === contextToken;
};

const contextFallbackState = (input: UseFolderInput, contextToken: object): FolderState => {
  if (!input.key || (input.mode === "online" && !input.token)) {
    return { kind: "idle" };
  }
  if (input.mode === "explicit-offline") {
    return { kind: "offline", key: input.key, contextToken, items: input.explicitOfflineItems, source: "explicit-offline" };
  }
  return {
    kind: "initialLoading",
    request: { key: input.key, generation: 0, contextToken }
  };
};

export const useFolder = (input: UseFolderInput): FolderController => {
  const [state, dispatch] = useReducer(folderReducer, { kind: "idle" });
  const generationRef = useRef(0);
  const activeRef = useRef<ActiveFolderRequest | undefined>();
  const inputRef = useRef(input);
  const explicitOfflineSnapshot = input.mode === "explicit-offline" ? input.explicitOfflineItems : undefined;
  const contextToken = useMemo(() => ({
    accountId: input.key?.accountId,
    cacheNamespace: input.key?.cacheNamespace,
    path: input.key?.path,
    mode: input.mode,
    ports: input.ports,
    token: input.token,
    explicitOfflineSnapshot
  }), [
    explicitOfflineSnapshot,
    input.key?.accountId,
    input.key?.cacheNamespace,
    input.key?.path,
    input.mode,
    input.ports,
    input.token
  ]);
  const committedContextRef = useRef(contextToken);
  useLayoutEffect(() => {
    inputRef.current = input;
    committedContextRef.current = contextToken;
  }, [contextToken, input]);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (!active) {
      return;
    }
    active.abortHandle.abort();
    dispatch({ type: "request-cancelled", request: active.request });
    activeRef.current = undefined;
  }, []);

  const reload = useCallback(async (
    options: { preferCache?: boolean; announceStatus?: boolean } = {}
  ): Promise<"session-terminated" | undefined> => {
    cancel();
    const current = inputRef.current;
    if (!current.key || (current.mode === "online" && !current.token)) {
      dispatch({ type: "reset" });
      return;
    }

    const request: FolderRequest = {
      key: current.key,
      generation: ++generationRef.current,
      contextToken: committedContextRef.current
    };
    const abortHandle = current.ports.createAbortHandle();
    activeRef.current = { request, abortHandle };
    const emit = (event: FolderEvent): boolean => {
      const active = activeRef.current;
      if (committedContextRef.current !== request.contextToken
        || ("request" in event && (!active || !sameFolderRequest(active.request, event.request)))) {
        return false;
      }
      dispatch(event);
      return true;
    };

    try {
      return await executeFolderLoad({
        request,
        token: current.token,
        mode: current.mode,
        preferCache: options.preferCache ?? true,
        announceStatus: options.announceStatus ?? true,
        explicitOfflineItems: current.explicitOfflineItems,
        signal: abortHandle.signal
      }, current.ports, {
        emit,
        onSessionTerminated: (reason, error) => current.onSessionTerminated?.(reason, error, request.key, request.contextToken),
        onWorkerUnavailable: () => current.onWorkerUnavailable?.(request.key, request.contextToken),
        onWorkerAvailable: () => current.onWorkerAvailable?.(request.key, request.contextToken)
      });
    } finally {
      if (activeRef.current && sameFolderRequest(activeRef.current.request, request)) {
        activeRef.current = undefined;
      }
    }
  }, [cancel]);

  useEffect(() => {
    void reload();
    return cancel;
  }, [cancel, contextToken, reload]);

  return {
    state: stateMatchesContext(state, contextToken) ? state : contextFallbackState(input, contextToken),
    contextToken,
    reload,
    cancel
  };
};
