import type {
  PreviewAbortPort,
  PreviewCachePort,
  PreviewCacheSnapshot,
  PreviewClockPort,
  PreviewFailureClassifier,
  PreviewLivePort,
  PreviewResource,
  PreviewResourcePort
} from "./ports";
import type { PreviewRequestKey } from "./model";
import type { PreviewPrefetchPort } from "./retentionPreviewCacheAdapter";

export interface PreviewSessionAdapterBundle {
  readonly cache: PreviewCachePort;
  readonly live: PreviewLivePort;
  readonly abort: PreviewAbortPort;
  readonly resources: PreviewResourcePort;
  readonly failures: PreviewFailureClassifier;
  readonly prefetch: PreviewPrefetchPort;
  readonly clock: PreviewClockPort;
  readonly resolveResourceUrl: (resource: PreviewResource) => string | undefined;
}

export interface PreviewSessionCompositionFactories {
  createSessionAdapters(input: {
    readonly tokenFor: (key: PreviewRequestKey) => string | undefined;
  }): PreviewSessionAdapterBundle;
}

export interface PreviewSessionRuntimeCallbacks {
  readonly onResetSession: (message: string, reconnectRequired: boolean) => void;
  readonly onMarkWorkerUnavailable: () => void;
  readonly onPublishCacheSummary: (snapshot: PreviewCacheSnapshot) => void;
  readonly onStreamCacheReady: (displayPath: string, accountName: string) => void;
  readonly onStreamCacheFailed: (displayPath: string, accountName: string) => void;
  readonly onOpenedEntryClear: () => void;
}

export interface UsePreviewSessionInput {
  readonly accountId: string | undefined;
  readonly cacheNamespace: string | undefined;
  readonly accountName: string;
  readonly token: string | undefined;
  readonly cacheOnlyMode: boolean;
  readonly openedEntryPath: string | undefined;
  readonly composition: PreviewSessionCompositionFactories;
  readonly callbacks: PreviewSessionRuntimeCallbacks;
}
