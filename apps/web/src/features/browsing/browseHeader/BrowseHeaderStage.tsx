import {
  Check,
  Copy,
  Download,
  FolderPlus,
  FolderUp,
  HardDriveDownload,
  House,
  Search,
  Trash2,
  Upload,
  WifiOff,
  X
} from "lucide-react";
import type { ChangeEvent, RefCallback } from "react";

import { FILE_SIZE_DISPLAY_OPTIONS, type FileSizeDisplayMode } from "../../../lib/fileSize";
import { SORT_MODE_OPTIONS, isSortMode, type SortMode } from "../model";
import type { BreadcrumbItem } from "../presentation";

export interface BrowseHeaderStageProps {
  readonly currentFolderLabel: string;
  readonly browseStatusLabel: string;
  readonly currentPath: string;
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly showBreadcrumbs: boolean;
  readonly staleInfo?: string;
  readonly searchActive: boolean;
  readonly searchQuery: string;
  readonly selectionSummaryLabel?: string;
  readonly status: string;
  readonly cacheOnlyMode: boolean;
  readonly refreshingFolder: boolean;
  readonly staleFolder: boolean;
  readonly canDownloadBatchSelection: boolean;
  readonly canSyncBatchOffline: boolean;
  readonly canCopyMoveBatchSelection: boolean;
  readonly canDeleteBatchSelection: boolean;
  readonly mutationBusy: boolean;
  readonly fileSizeDisplayMode: FileSizeDisplayMode;
  readonly sortMode: SortMode;
  readonly canCreateFolder: boolean;
  readonly canUploadFiles: boolean;
  readonly canUploadFolders: boolean;
  readonly folderDropActive: boolean;
  readonly currentLocationLabel: string;
  readonly onNavigateToPath: (path: string) => void;
  readonly onClearSearch: () => void;
  readonly onDownloadSelection: () => void;
  readonly onKeepOfflineSelection: () => void;
  readonly onCopyMoveSelection: () => void;
  readonly onDeleteSelection: () => void;
  readonly onClearSelection: () => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onFileSizeDisplayModeChange: (mode: FileSizeDisplayMode) => void;
  readonly onSortModeChange: (mode: SortMode) => void;
  readonly onCreateFolder: () => void;
  readonly onUploadFiles: (files: FileList | null) => void;
  readonly directoryUploadInputRef: RefCallback<HTMLInputElement>;
}

function buildUploadTip(props: Pick<BrowseHeaderStageProps, "canUploadFolders" | "canUploadFiles" | "cacheOnlyMode" | "currentLocationLabel">): string {
  if (props.canUploadFolders) {
    return `Tip: drag and drop files anywhere in this folder view, or use Upload folder to keep directory structure under ${props.currentLocationLabel}.`;
  }
  if (props.canUploadFiles) {
    return `Tip: drag and drop files anywhere in this folder view to upload them under ${props.currentLocationLabel}.`;
  }
  if (props.cacheOnlyMode) {
    return "Uploads are unavailable while cached-shell mode is active.";
  }
  return "Uploads are unavailable when this account is read-only.";
}

export function BrowseHeaderStage(props: BrowseHeaderStageProps) {
  const uploadTip = buildUploadTip(props);

  const handleFileSizeDisplayChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextMode = FILE_SIZE_DISPLAY_OPTIONS.find((option) => option.value === event.target.value)?.value;
    if (nextMode) {
      props.onFileSizeDisplayModeChange(nextMode);
    }
  };

  const handleSortModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (isSortMode(event.target.value)) {
      props.onSortModeChange(event.target.value);
    }
  };

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    props.onUploadFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  return (
    <section className="browse-header panel panel-subtle">
      <div className="browse-header-main">
        <div className="browse-title-row">
          <div className="browse-title-stack">
            <p className="eyebrow section-eyebrow">Files</p>
            <h2>{props.currentFolderLabel}</h2>
            <span className="status browse-title-count">{props.browseStatusLabel}</span>
          </div>
          <span className={`operation-pill browser-status ${props.cacheOnlyMode ? "disabled" : props.refreshingFolder || props.staleFolder || props.searchActive ? "secondary" : "enabled"}`}>
            {props.cacheOnlyMode ? <WifiOff aria-hidden="true" /> : <Check aria-hidden="true" />}
            {props.cacheOnlyMode ? "Read-only" : props.refreshingFolder ? "Refreshing" : props.staleFolder ? "Cached" : props.searchActive ? "Search active" : "Ready"}
          </span>
        </div>

        {props.showBreadcrumbs ? (
          <nav aria-label="Breadcrumbs" className="breadcrumbs">
            {props.breadcrumbs.map((item) => (
              <div className="breadcrumb-segment" key={item.value || "root"}>
                <button aria-label={item.ariaLabel} onClick={() => props.onNavigateToPath(item.value)} type="button">
                  {item.value ? item.label : <House aria-hidden="true" />}
                </button>
                {item.value !== props.currentPath ? <span aria-hidden="true" className="breadcrumb-separator">/</span> : null}
              </div>
            ))}
          </nav>
        ) : null}

        {props.staleInfo || props.searchActive ? (
          <div className="browse-context-row">
            {props.staleInfo ? <span className="status stale-info">{props.staleInfo}</span> : null}
            {props.searchActive ? <button className="quiet-button" onClick={props.onClearSearch} type="button">Clear search</button> : null}
          </div>
        ) : null}

        {props.selectionSummaryLabel ? (
          <div className="browse-selection-row">
            <span className="status">{props.selectionSummaryLabel}</span>
            <div className="browse-selection-actions">
              <button className="button-with-icon" disabled={!props.canDownloadBatchSelection} onClick={props.onDownloadSelection} type="button"><Download aria-hidden="true" />Download selected</button>
              <button className="button-with-icon" disabled={!props.canSyncBatchOffline} onClick={props.onKeepOfflineSelection} type="button"><HardDriveDownload aria-hidden="true" />Keep offline</button>
              <button className="button-with-icon" disabled={!props.canCopyMoveBatchSelection || props.mutationBusy} onClick={props.onCopyMoveSelection} type="button"><Copy aria-hidden="true" />Copy or move selected</button>
              <button className={`button-with-icon${props.canDeleteBatchSelection ? " button-danger" : ""}`} disabled={!props.canDeleteBatchSelection || props.mutationBusy} onClick={props.onDeleteSelection} type="button"><Trash2 aria-hidden="true" />Delete selected</button>
              <button className="quiet-button button-with-icon" onClick={props.onClearSelection} type="button"><X aria-hidden="true" />Clear selection</button>
            </div>
          </div>
        ) : null}

        <p className="status browse-status-note">{props.status}</p>
      </div>

      <div className="browse-header-controls">
        <div className="toolbar-search search-block">
          <Search aria-hidden="true" />
          <input
            aria-label="Search files"
            onChange={(event) => props.onSearchQueryChange(event.target.value)}
            placeholder="Search files and folders"
            value={props.searchQuery}
          />
        </div>
        <div className="folder-actions-inline">
          <label className="stacked-field file-size-toolbar-field">
            <span className="summary-label">File size display</span>
            <select
              aria-label="File size display in file list"
              onChange={handleFileSizeDisplayChange}
              value={props.fileSizeDisplayMode}
            >
              {FILE_SIZE_DISPLAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="stacked-field file-size-toolbar-field">
            <span className="summary-label">Sort by</span>
            <select
              aria-label="Sort files and folders"
              onChange={handleSortModeChange}
              value={props.sortMode}
            >
              {SORT_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button className="button-with-icon" disabled={!props.canCreateFolder || props.mutationBusy} onClick={props.onCreateFolder} type="button"><FolderPlus aria-hidden="true" />Create folder</button>
          <label className={`upload-label ${!props.canUploadFiles || props.mutationBusy ? "disabled" : ""}`}>
            <Upload aria-hidden="true" />Upload files
            <input
              aria-label="Upload files"
              disabled={!props.canUploadFiles || props.mutationBusy}
              multiple
              onChange={handleUploadChange}
              type="file"
            />
          </label>
          <label className={`upload-label ${!props.canUploadFolders || props.mutationBusy ? "disabled" : ""}`}>
            <FolderUp aria-hidden="true" />Upload folder
            <input
              aria-label="Upload folder"
              disabled={!props.canUploadFolders || props.mutationBusy}
              onChange={handleUploadChange}
              ref={props.directoryUploadInputRef}
              type="file"
            />
          </label>
        </div>
        <p className={`status drop-upload-note${props.folderDropActive ? " active" : ""}`}>{uploadTip}</p>
      </div>
    </section>
  );
}
