import type { FileEntry, NormalizedPath, SearchResult } from "@davora/shared";
import type { Ref } from "react";

import type { BrowseHeaderStageProps } from "../browseHeader";
import { buildFileListItemSubtitle, type FileListStageProps } from "../fileList";

interface BrowsingSurfaceOwners {
  readonly browse: {
    readonly context: { readonly path: string };
    readonly mode: { readonly cacheOnly: boolean };
    readonly query: { readonly raw: string; readonly active: boolean; set(value: string): void; clear(): void };
    readonly folder: { readonly refreshing: boolean; readonly stale: boolean };
    readonly list: { readonly items: readonly (FileEntry | SearchResult)[] };
    readonly presentation: {
      readonly breadcrumbs: BrowseHeaderStageProps["breadcrumbs"];
      readonly browseStatusLabel: string;
      readonly folderLabel: string;
      readonly locationLabel: string;
      readonly folderCachedAt?: string;
      readonly empty: Pick<FileListStageProps, "emptyStatus" | "emptyTitle" | "showEmptyState"> & { readonly listRecoveryAvailable: boolean };
      readonly showBreadcrumbs: boolean;
    };
    readonly sort: {
      readonly mode: BrowseHeaderStageProps["sortMode"];
      select: BrowseHeaderStageProps["onSortModeChange"];
      readonly reset: BrowseHeaderStageProps["sortReset"];
    };
  };
  readonly selection: {
    readonly fileList: Pick<FileListStageProps, "batchModeActive" | "selectionModeActive" | "selectAllState" | "canSelectAll" | "canDeselectAll" | "onToggleSelectAll" | "isItemBatchSelected" | "isItemSelected" | "clearRowOpenSuppression" | "getRowOpenSuppressed" | "onRowPointerCancel" | "onRowPointerDown" | "onRowPointerLeave" | "onRowPointerUp" | "onToggleBatchSelection" | "onToggleEntrySelection" | "suppressNarrowScreenContextMenu">;
    readonly presentation: { readonly selectionSummaryLabel?: string };
    readonly interaction: { readonly clearBatchSelection: () => void };
    readonly batch: {
      readonly entries: readonly FileEntry[];
      readonly archiveInput?: { readonly roots: readonly { readonly entry: FileEntry; readonly archiveRoot: string }[]; readonly archiveLabel: string };
      capture(): { readonly accountId?: string; readonly memberships: readonly { readonly identity: { readonly accountId: string; readonly path: NormalizedPath }; readonly membershipVersion: number }[] };
    };
  };
  readonly operation: {
    readonly capabilities: Pick<BrowseHeaderStageProps, "canCopyMoveBatchSelection" | "canCreateFolder" | "canDeleteBatchSelection" | "canDownloadBatchSelection" | "canSyncBatchOffline" | "canUploadFiles" | "canUploadFolders"> & Pick<FileListStageProps, "canMarkForBatchDownload">;
    readonly mutation: { readonly state: { readonly busy: boolean } };
    readonly commands: { readonly openCreateFolder: () => void; readonly openDeleteSelection: () => void; readonly openCopyMoveSelection: () => void };
    readonly download: { downloadBatch(): Promise<void> | void };
    readonly upload: { uploadFiles(files: FileList | File[] | null): Promise<void> | void; readonly drop: { readonly active: boolean; readonly onDragEnter: FileListStageProps["onDragEnter"]; readonly onDragLeave: FileListStageProps["onDragLeave"]; readonly onDragOver: FileListStageProps["onDragOver"]; readonly onDrop: FileListStageProps["onDrop"] } };
  };
  readonly offline: { readonly explicitOfflineMode: boolean; readonly isItemAvailableOffline: FileListStageProps["isItemAvailableOffline"] };
  readonly navigation: { getCurrentPath(): string; readonly navigateToPath: BrowseHeaderStageProps["onNavigateToPath"] };
  readonly settings: { readonly preferences: Pick<BrowseHeaderStageProps, "fileSizeDisplayMode">; readonly commands: { readonly handleFileSizeDisplayModeChange: BrowseHeaderStageProps["onFileSizeDisplayModeChange"] } };
  readonly status: { readonly message: string };
  readonly pullToRefresh: { readonly fileListRef: Ref<HTMLElement> };
  readonly viewport: { readonly isNarrowScreen: boolean };
}

export interface BrowsingSurfaceInput {
  readonly owners: BrowsingSurfaceOwners;
  readonly ports: {
    readonly directoryUploadInputRef: BrowseHeaderStageProps["directoryUploadInputRef"];
    loadFolder(path: string): Promise<unknown> | void;
    openFile(item: FileEntry | SearchResult): void;
    openOfflineSync(entries: readonly FileEntry[], archiveInput: BrowsingSurfaceOwners["selection"]["batch"]["archiveInput"], capture: ReturnType<BrowsingSurfaceOwners["selection"]["batch"]["capture"]>): void;
  };
}

export interface BrowsingSurfaceBindings {
  readonly browseHeader: BrowseHeaderStageProps;
  readonly fileList: { readonly props: FileListStageProps; readonly ref?: Ref<HTMLElement> };
}

export function projectBrowsingSurfaceBindings(input: BrowsingSurfaceInput): BrowsingSurfaceBindings {
  const { browse, selection, operation, offline, navigation, settings, status, pullToRefresh } = input.owners;
  const { ports } = input;
  const capabilities = operation.capabilities;
  return {
    browseHeader: {
      browseStatusLabel: browse.presentation.browseStatusLabel,
      breadcrumbs: browse.presentation.breadcrumbs,
      cacheOnlyMode: browse.mode.cacheOnly,
      canCopyMoveBatchSelection: capabilities.canCopyMoveBatchSelection,
      canCreateFolder: capabilities.canCreateFolder,
      canDeleteBatchSelection: capabilities.canDeleteBatchSelection,
      canDownloadBatchSelection: capabilities.canDownloadBatchSelection,
      canSyncBatchOffline: capabilities.canSyncBatchOffline,
      canUploadFiles: capabilities.canUploadFiles,
      canUploadFolders: capabilities.canUploadFolders,
      currentFolderLabel: browse.presentation.folderLabel,
      currentLocationLabel: browse.presentation.locationLabel,
      currentPath: browse.context.path,
      directoryUploadInputRef: ports.directoryUploadInputRef,
      fileSizeDisplayMode: settings.preferences.fileSizeDisplayMode,
      folderDropActive: operation.upload.drop.active,
      mutationBusy: operation.mutation.state.busy,
      onClearSearch: browse.query.clear,
      onClearSelection: selection.interaction.clearBatchSelection,
      onCopyMoveSelection: operation.commands.openCopyMoveSelection,
      onCreateFolder: operation.commands.openCreateFolder,
      onDeleteSelection: operation.commands.openDeleteSelection,
      onDownloadSelection: () => { void operation.download.downloadBatch(); },
      onFileSizeDisplayModeChange: settings.commands.handleFileSizeDisplayModeChange,
      onKeepOfflineSelection: () => ports.openOfflineSync(selection.batch.entries, selection.batch.archiveInput, selection.batch.capture()),
      onNavigateToPath: navigation.navigateToPath,
      onSearchQueryChange: browse.query.set,
      onSortModeChange: browse.sort.select,
      onUploadFiles: (files) => { void operation.upload.uploadFiles(files); },
      refreshingFolder: browse.folder.refreshing,
      searchActive: browse.query.active,
      searchQuery: browse.query.raw,
      selectionSummaryLabel: selection.presentation.selectionSummaryLabel,
      showBreadcrumbs: browse.presentation.showBreadcrumbs,
      sortMode: browse.sort.mode,
      sortReset: browse.sort.reset,
      staleFolder: browse.folder.stale,
      status: status.message
    },
    fileList: {
      props: {
        ...selection.fileList,
        breadcrumbs: browse.presentation.breadcrumbs,
        canMarkForBatchDownload: capabilities.canMarkForBatchDownload,
        currentPath: browse.context.path,
        emptyStatus: browse.presentation.empty.emptyStatus,
        emptyTitle: browse.presentation.empty.emptyTitle,
        fileSizeDisplayMode: settings.preferences.fileSizeDisplayMode,
        folderDropActive: operation.upload.drop.active,
        getItemSubtitle: (item) => buildFileListItemSubtitle(item, browse.query.active),
        isItemAvailableOffline: offline.isItemAvailableOffline,
        items: browse.list.items,
        onClearSearch: browse.query.clear,
        onDragEnter: operation.upload.drop.onDragEnter,
        onDragLeave: operation.upload.drop.onDragLeave,
        onDragOver: operation.upload.drop.onDragOver,
        onDrop: operation.upload.drop.onDrop,
        onNavigateToPath: navigation.navigateToPath,
        onRetryFolder: () => { void ports.loadFolder(browse.context.path); },
        onRowOpenClick: (item) => item.isFolder ? navigation.navigateToPath(item.path) : ports.openFile(item),
        showBreadcrumbs: browse.presentation.showBreadcrumbs && input.owners.viewport.isNarrowScreen,
        showClearSearchButton: browse.query.active,
        showEmptyState: browse.presentation.empty.showEmptyState,
        showRetryFolderButton: browse.presentation.empty.listRecoveryAvailable
      },
      ref: pullToRefresh.fileListRef
    }
  };
}
