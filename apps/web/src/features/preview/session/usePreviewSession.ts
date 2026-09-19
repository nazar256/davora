import type { FilePreview } from "@davora/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { PreviewCacheState } from "../shell";
import { PreviewSessionController } from "./controller";
import type { PreviewCacheEvent, PreviewResource } from "./ports";
import type { PreviewOpenRequest, PreviewRequestKey, PreviewSessionState } from "./model";
import {
  DEFAULT_PREVIEW_CACHE_STATE,
  mapPreviewSessionPublication,
  type PendingPreviewUpdate
} from "./publication";
import type { PreviewSessionAdapterBundle, UsePreviewSessionInput } from "./usePreviewSessionPorts";

function resetPreviewUiState(): {
  readonly selected: FilePreview | undefined;
  readonly previewOpen: boolean;
  readonly loadingPreview: boolean;
  readonly previewError: Error | undefined;
  readonly pendingPreviewUpdate: PendingPreviewUpdate | undefined;
  readonly previewCacheState: PreviewCacheState;
} {
  return {
    selected: undefined,
    previewOpen: false,
    loadingPreview: false,
    previewError: undefined,
    pendingPreviewUpdate: undefined,
    previewCacheState: DEFAULT_PREVIEW_CACHE_STATE
  };
}

export function usePreviewSession(input: UsePreviewSessionInput) {
  const inputRef = useRef(input);
  inputRef.current = input;

  const [previewSessionState, setPreviewSessionState] = useState<PreviewSessionState>({ kind: "closed" });
  const [previewResource, setPreviewResource] = useState<PreviewResource | undefined>();
  const [selected, setSelected] = useState<FilePreview | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<Error | undefined>();
  const [previewCacheState, setPreviewCacheState] = useState<PreviewCacheState>(DEFAULT_PREVIEW_CACHE_STATE);
  const [pendingPreviewUpdate, setPendingPreviewUpdate] = useState<PendingPreviewUpdate | undefined>();

  const previewTokenRef = useRef<string | undefined>(input.token);
  const previewContextGenerationRef = useRef(0);
  const previewOwnerRef = useRef<PreviewRequestKey>();
  const previewOpenRef = useRef(previewOpen);
  const openedEntryPathRef = useRef<string | undefined>(input.openedEntryPath);
  const previewPrefetchAbortersRef = useRef(new Set<{ abort(): void }>());
  const previewPrefetchSequenceRef = useRef(0);
  const adaptersRef = useRef<PreviewSessionAdapterBundle>();
  const controllerRef = useRef<PreviewSessionController>();
  const compositionRef = useRef({
    accountId: input.accountId,
    cacheNamespace: input.cacheNamespace,
    accountName: input.accountName
  });

  previewOpenRef.current = previewOpen;
  openedEntryPathRef.current = input.openedEntryPath;

  if (!adaptersRef.current) {
    adaptersRef.current = input.composition.createSessionAdapters({
      tokenFor: (key) => {
        const current = inputRef.current;
        return key.accountId === current.accountId
          && key.cacheNamespace === current.cacheNamespace
          && key.contextGeneration === String(previewContextGenerationRef.current)
          ? previewTokenRef.current
          : undefined;
      }
    });
  }

  if (!controllerRef.current) {
    const adapters = adaptersRef.current;
    const current = {
      isCurrent: (key: PreviewRequestKey) => {
        const live = inputRef.current;
        return (previewOwnerRef.current === undefined || previewOwnerRef.current.requestSequence === key.requestSequence)
          && key.accountId === live.accountId
          && key.cacheNamespace === live.cacheNamespace
          && key.contextGeneration === String(previewContextGenerationRef.current)
          && key.path === openedEntryPathRef.current
          && key.connectionMode === (live.cacheOnlyMode ? "cache-only" : "online");
      }
    };
    controllerRef.current = new PreviewSessionController({
      cache: adapters.cache,
      live: adapters.live,
      abort: adapters.abort,
      resources: adapters.resources,
      current,
      failures: adapters.failures,
      publication: {
        publish: (nextState, resource) => {
          if (nextState.kind !== "closed" && !current.isCurrent(nextState.key)) {
            return false;
          }
          if (nextState.kind !== "closed") {
            previewOwnerRef.current = nextState.key;
          }
          setPreviewSessionState(nextState);
          setPreviewResource(resource);
          const publication = mapPreviewSessionPublication(nextState);
          setSelected(publication.selected);
          setPreviewOpen(publication.previewOpen);
          setPreviewError(publication.previewError);
          setLoadingPreview(publication.loadingPreview);
          setPendingPreviewUpdate(publication.pendingPreviewUpdate);
          setPreviewCacheState(publication.previewCacheState);
          if (publication.clearOpenedEntry) {
            inputRef.current.callbacks.onOpenedEntryClear();
          }
          return true;
        }
      },
      cachePublication: {
        publishSnapshot: (key, snapshot) => {
          if (!current.isCurrent(key)) return false;
          const composition = compositionRef.current;
          if (composition.accountId !== key.accountId || composition.cacheNamespace !== key.cacheNamespace) return false;
          inputRef.current.callbacks.onPublishCacheSummary(snapshot);
          return true;
        },
        publishEvent: (event: PreviewCacheEvent) => {
          if (!current.isCurrent(event.key)) return false;
          const composition = compositionRef.current;
          if (composition.accountId !== event.key.accountId || composition.cacheNamespace !== event.key.cacheNamespace) return false;
          const callbacks = inputRef.current.callbacks;
          if (event.kind === "stream-cache-ready") {
            callbacks.onStreamCacheReady(event.key.path, composition.accountName);
          } else {
            callbacks.onStreamCacheFailed(event.key.path, composition.accountName);
          }
          return true;
        }
      },
      failurePublication: {
        publishFailure: (key, failure) => {
          if (!current.isCurrent(key)) return false;
          const composition = compositionRef.current;
          if (composition.accountId !== key.accountId || composition.cacheNamespace !== key.cacheNamespace) return false;
          const callbacks = inputRef.current.callbacks;
          if (failure.kind === "session-terminal") {
            callbacks.onResetSession(failure.message, failure.reason === "reconnect-required");
            return true;
          }
          if (failure.kind === "backend-unavailable") {
            callbacks.onMarkWorkerUnavailable();
          }
          return true;
        }
      },
      clock: adapters.clock
    });
  }

  const controller = controllerRef.current;
  const adapters = adaptersRef.current;
  const selectedBlobUrl = previewResource ? adapters.resolveResourceUrl(previewResource) : undefined;

  useLayoutEffect(() => {
    compositionRef.current = {
      accountId: input.accountId,
      cacheNamespace: input.cacheNamespace,
      accountName: input.accountName
    };
  }, [input.accountId, input.accountName, input.cacheNamespace]);

  useLayoutEffect(() => {
    controller.invalidate();
    previewOwnerRef.current = undefined;
    previewTokenRef.current = input.token;
    previewContextGenerationRef.current += 1;
    setPreviewResource(undefined);
    setPreviewSessionState({ kind: "closed" });
    const reset = resetPreviewUiState();
    setSelected(reset.selected);
    setPreviewOpen(reset.previewOpen);
    setPreviewError(reset.previewError);
    setLoadingPreview(reset.loadingPreview);
    setPendingPreviewUpdate(reset.pendingPreviewUpdate);
    setPreviewCacheState(reset.previewCacheState);
    inputRef.current.callbacks.onOpenedEntryClear();
  }, [controller, input.accountId, input.cacheNamespace, input.token, input.cacheOnlyMode]);

  useEffect(() => () => {
    controller.invalidate();
  }, [controller]);

  const clearOwner = useCallback(() => {
    previewOwnerRef.current = undefined;
  }, []);

  const close = useCallback(() => {
    controller.close();
    previewOwnerRef.current = undefined;
    openedEntryPathRef.current = undefined;
  }, [controller]);

  const invalidatePrefetch = useCallback(() => {
    for (const aborter of previewPrefetchAbortersRef.current) {
      aborter.abort();
    }
    previewPrefetchAbortersRef.current.clear();
  }, []);

  const open = useCallback((request: PreviewOpenRequest) => controller.open(request), [controller]);
  const applyRefresh = useCallback(() => controller.applyRefresh(), [controller]);

  const setOpenedEntryPath = useCallback((path: string) => {
    openedEntryPathRef.current = path;
  }, []);

  const clearOpenedEntryPath = useCallback(() => {
    openedEntryPathRef.current = undefined;
  }, []);

  return {
    controller,
    sessionState: previewSessionState,
    selected,
    setSelected,
    previewResource,
    selectedBlobUrl,
    previewOpen,
    previewOpenRef,
    loadingPreview,
    previewError,
    setPreviewError,
    setPreviewOpen,
    setLoadingPreview,
    setPendingPreviewUpdate,
    setPreviewCacheState,
    previewCacheState,
    pendingPreviewUpdate,
    clearOwner,
    close,
    open,
    applyRefresh,
    invalidatePrefetch,
    prefetchPort: adapters.prefetch,
    abortPort: adapters.abort,
    contextGenerationRef: previewContextGenerationRef,
    openedEntryPathRef,
    setOpenedEntryPath,
    clearOpenedEntryPath,
    prefetchContext: {
      getContextGeneration: () => String(previewContextGenerationRef.current),
      getAccountId: () => inputRef.current.accountId ?? "",
      getCacheNamespace: () => inputRef.current.cacheNamespace ?? "",
      isStillCurrent: (accountId: string, namespace: string, contextGeneration: string) => {
        const current = inputRef.current;
        return current.accountId === accountId
          && current.cacheNamespace === namespace
          && String(previewContextGenerationRef.current) === contextGeneration;
      },
      nextPrefetchSequence: () => ++previewPrefetchSequenceRef.current,
      trackPrefetchAbort: (aborter: { abort(): void }) => {
        previewPrefetchAbortersRef.current.add(aborter);
      },
      untrackPrefetchAbort: (aborter: { abort(): void }) => {
        previewPrefetchAbortersRef.current.delete(aborter);
      },
      createAbort: () => adapters.abort.create()
    }
  };
}
