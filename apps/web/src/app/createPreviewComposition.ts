import {
  createRetentionPreviewCacheAdapter,
  createRetentionPreviewPrefetchAdapter,
  createPreviewRequestKey,
  type PreviewRequestKey,
  type PreviewSessionCompositionFactories,
  type RetentionPreviewPrefetchRuntime,
  type RetentionPreviewRuntime
} from "../features/preview/session";
import type { PreviewModalRuntimePorts } from "../features/preview/shell";
import type { FolderAudioRuntimePorts } from "../features/preview/folderAudio";
import type { PreviewRuntimePort } from "../features/preview/workspace";
import type { RetentionRepository } from "../features/offline/retention";
import {
  BrowserPreviewAbortPort,
  BrowserPreviewLiveAdapter,
  BrowserPreviewMaterialStore,
  BrowserPreviewResourcePort,
  type BrowserPreviewRequestKey,
  type PreviewTransport
} from "../platform/preview/browserPreviewAdapters";
import { createPreviewFailureClassifier } from "../platform/preview/browserPreviewFailureClassifier";
import {
  createBrowserPreviewModalRuntime,
  type BrowserPreviewModalRuntime
} from "../platform/preview/browserPreviewModalRuntime";
import { createBrowserFolderAudioPorts } from "../platform/preview/browserFolderAudioPorts";

export type PreviewComposition = PreviewRuntimePort;

export interface CreatePreviewCompositionInput {
  readonly retentionRepository: RetentionRepository;
  /** A deterministic transport seam for composition tests; production uses the authoritative API helpers. */
  readonly previewTransport?: PreviewTransport;
  readonly modalRuntime?: BrowserPreviewModalRuntime;
  readonly folderAudioRuntime?: FolderAudioRuntimePorts;
}

function featureRequestKey(key: BrowserPreviewRequestKey): PreviewRequestKey {
  return createPreviewRequestKey({ ...key, requestSequence: 0 });
}

export function createPreviewComposition(input: CreatePreviewCompositionInput): PreviewComposition {
  const browserRuntime = input.modalRuntime ?? createBrowserPreviewModalRuntime();
  const session = {
    createSessionAdapters: ({ tokenFor }) => {
      const materials = new BrowserPreviewMaterialStore();
      const resources = new BrowserPreviewResourcePort(materials);
      const live = new BrowserPreviewLiveAdapter({
        materials,
        tokenFor: (key) => tokenFor(featureRequestKey(key)),
        ...(input.previewTransport === undefined ? {} : { transport: input.previewTransport })
      });
      const runtime = live satisfies RetentionPreviewRuntime;
      const prefetchRuntime = live satisfies RetentionPreviewPrefetchRuntime;
      const cache = createRetentionPreviewCacheAdapter(input.retentionRepository, runtime);
      const prefetch = createRetentionPreviewPrefetchAdapter(cache, prefetchRuntime);
      return {
        cache,
        live,
        abort: new BrowserPreviewAbortPort(),
        resources,
        failures: createPreviewFailureClassifier(),
        prefetch,
        clock: { now: browserRuntime.now },
        resolveResourceUrl: (resource) => resources.url(resource)
      };
    }
  } satisfies PreviewSessionCompositionFactories;
  const modal = browserRuntime satisfies PreviewModalRuntimePorts;

  return Object.freeze({ session, modal, folderAudio: input.folderAudioRuntime ?? createBrowserFolderAudioPorts() });
}
