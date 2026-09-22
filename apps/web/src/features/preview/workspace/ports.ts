import type { ConnectedAccount, FileEntry } from "@davora/shared";

import type { PreviewOpenOptions } from "../open";
import type { FolderAudioRuntimePorts } from "../folderAudio";
import type { PreviewSessionCompositionFactories } from "../session";
import type { PreviewModalRuntimePorts, PreviewModalStageProps } from "../shell";
import type { RetentionAccount, RetentionPreviewRead } from "../../offline/retention";
import type { PreviewCacheSnapshot } from "../session";

/** Browser capabilities assembled once by the application composition root. */
export interface PreviewRuntimePort {
  readonly session: PreviewSessionCompositionFactories;
  readonly modal: PreviewModalRuntimePorts;
  readonly folderAudio: FolderAudioRuntimePorts;
}

export interface PreviewApplicationPorts {
  readonly runtime: PreviewRuntimePort;
  readonly session: {
    readonly reset: (message: string, reconnectRequired: boolean) => void;
    readonly markWorkerUnavailable: () => void;
    readonly publishCacheSummary: (snapshot: PreviewCacheSnapshot) => void;
    readonly streamCacheReady: (displayPath: string, accountName: string) => void;
    readonly streamCacheFailed: (displayPath: string, accountName: string) => void;
  };
  readonly navigation: {
    readonly pushPreviewSurface: () => void;
    readonly closeNavigation: () => void;
    readonly closeMobileDetails: () => void;
    readonly closePreview: () => void;
  };
  readonly operation: {
    readonly isCurrent: () => boolean;
    readonly canDownload: (path: string) => boolean;
    readonly download: (path: string, label: string) => Promise<void>;
    readonly saveLocal: (blob: Blob, filename: string) => void;
  };
  readonly retention: {
    readonly readPreview: (account: RetentionAccount, path: string) => Promise<RetentionPreviewRead | undefined>;
    readonly isCurrent: (account: RetentionAccount) => boolean;
    readonly refreshSummary: () => Promise<void>;
    readonly publishSummary: (snapshot: PreviewCacheSnapshot) => void;
  };
  readonly presentation: {
    readonly announce: (message: string) => void;
    readonly reportListError: (error?: Error) => void;
    readonly clearListError: () => void;
    readonly markWorkerAvailable: () => void;
    readonly onImageFitModeChange: (mode: PreviewModalStageProps["imageFitMode"]) => void;
    readonly onVideoMutedChange: (muted: boolean) => void;
    readonly toDisplayPath: (path: string) => string;
  };
}

export interface PreviewWorkspaceContext {
  readonly activeAccount: Pick<ConnectedAccount, "id" | "cacheNamespace" | "displayName"> | undefined;
  readonly accountName?: string;
  readonly token: string | undefined;
  readonly cacheNamespace: string | undefined;
  readonly cacheOnlyMode: boolean;
  readonly currentPath: string;
  readonly visibleItems: readonly FileEntry[];
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  readonly workerUnavailable?: boolean;
}

export interface PreviewWorkspaceSettings {
  readonly experimentalHeicPreviewEnabled: boolean;
  readonly previewFreshnessIntervalSeconds: number;
  readonly maxCacheableFileSizeBytes: number;
  readonly fileSizeDisplayMode?: PreviewModalStageProps["fileSizeDisplayMode"];
  readonly imageFitMode?: PreviewModalStageProps["imageFitMode"];
  readonly videoMuted?: PreviewModalStageProps["videoMuted"];
}

export interface PreviewWorkspacePorts {
  readonly application: PreviewApplicationPorts;
}

export type PreviewWorkspaceOpenOptions = PreviewOpenOptions;
