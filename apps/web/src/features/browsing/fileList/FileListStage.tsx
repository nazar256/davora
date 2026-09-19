import { dirname, toDisplayPath, type FileEntry, type SearchResult } from "@davora/shared";
import {
  FileArchive,
  FileCode2,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  HardDriveDownload,
  MoreVertical,
  type LucideIcon
} from "lucide-react";
import { forwardRef, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";

import { formatFileSize, type FileSizeDisplayMode } from "../../../lib/fileSize";

export interface FileListStageProps {
  readonly items: readonly (FileEntry | SearchResult)[];
  readonly folderDropActive: boolean;
  readonly batchModeActive: boolean;
  readonly showEmptyState: boolean;
  readonly emptyTitle: string;
  readonly emptyStatus: string;
  readonly showClearSearchButton: boolean;
  readonly showRetryFolderButton: boolean;
  readonly canMarkForBatchDownload: boolean;
  readonly selectionModeActive: boolean;
  readonly fileSizeDisplayMode: FileSizeDisplayMode;
  readonly suppressNarrowScreenContextMenu: boolean;
  readonly isItemBatchSelected: (item: FileEntry | SearchResult) => boolean;
  readonly isItemSelected: (item: FileEntry | SearchResult) => boolean;
  readonly isItemAvailableOffline: (item: FileEntry | SearchResult) => boolean;
  readonly getItemSubtitle: (item: FileEntry | SearchResult) => string | undefined;
  readonly onClearSearch: () => void;
  readonly onRetryFolder: () => void;
  readonly onToggleBatchSelection: (item: FileEntry | SearchResult) => void;
  readonly onRowOpenClick: (item: FileEntry | SearchResult) => void;
  readonly getRowOpenSuppressed: () => boolean;
  readonly clearRowOpenSuppression: () => void;
  readonly onToggleEntrySelection: (item: FileEntry | SearchResult) => void;
  readonly onRowPointerDown: (item: FileEntry | SearchResult) => void;
  readonly onRowPointerCancel: () => void;
  readonly onRowPointerLeave: () => void;
  readonly onRowPointerUp: () => void;
  readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
  readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
}

function formatFileTimestampCompact(value: string | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getUTCMonth()];
  const day = date.getUTCDate();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hour}:${minute}`;
}

function formatBytes(value: number | undefined, mode: FileSizeDisplayMode): string {
  return formatFileSize(value, mode);
}

function FileEntryIcon({ item }: { item: FileEntry | SearchResult }) {
  let Icon: LucideIcon = FileText;
  let kind = "document";
  const mimeType = item.mimeType?.toLowerCase() ?? "";
  const filename = item.name.toLowerCase();

  if (item.isFolder) {
    Icon = Folder;
    kind = "folder";
  } else if (mimeType.startsWith("image/")) {
    Icon = FileImage;
    kind = "image";
  } else if (mimeType.startsWith("audio/")) {
    Icon = FileMusic;
    kind = "audio";
  } else if (mimeType.startsWith("video/")) {
    Icon = FileVideo;
    kind = "video";
  } else if (/\.(?:xlsx?|csv|ods)$/i.test(filename)) {
    Icon = FileSpreadsheet;
    kind = "spreadsheet";
  } else if (/\.(?:zip|7z|rar|tar|gz)$/i.test(filename)) {
    Icon = FileArchive;
    kind = "archive";
  } else if (/\.(?:json|[cm]?[jt]sx?|html?|css|ya?ml|xml|sh|go|rs)$/i.test(filename)) {
    Icon = FileCode2;
    kind = "code";
  }

  return <Icon aria-hidden="true" className={`item-icon item-icon-${kind}`} />;
}

function handleRowContextMenu(
  event: ReactMouseEvent<HTMLDivElement>,
  suppressNarrowScreenContextMenu: boolean
) {
  if (suppressNarrowScreenContextMenu) {
    event.preventDefault();
  }
}

export const FileListStage = forwardRef<HTMLElement, FileListStageProps>(function FileListStage(props, ref) {
  const handleRowPrimaryClick = (item: FileEntry | SearchResult) => {
    if (props.selectionModeActive) {
      props.onToggleBatchSelection(item);
      return;
    }
    if (props.getRowOpenSuppressed()) {
      props.clearRowOpenSuppression();
      return;
    }
    props.onRowOpenClick(item);
  };

  return (
    <section
      className={`file-list-panel${props.folderDropActive ? " file-list-panel-drop-active" : ""}${props.batchModeActive ? " batch-download-mode" : ""}`}
      ref={ref}
      onDragEnter={props.onDragEnter}
      onDragLeave={props.onDragLeave}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <div aria-hidden="true" className="list-head">
        <span className="list-head-spacer" />
        <span>Name</span>
        <span>Modified</span>
        <span>Size</span>
        <span>Actions</span>
      </div>

      <ul className="file-list-items">
        {props.items.map((item) => {
          const isSelected = props.isItemSelected(item);
          const isMarkedForDownload = props.isItemBatchSelected(item);
          const selectForDownloadLabel = `${isMarkedForDownload ? "Deselect" : "Select"} ${item.name} ${item.isFolder ? "folder" : "file"}`;
          const openLabel = props.selectionModeActive
            ? selectForDownloadLabel
            : `${item.isFolder ? "Open folder" : "Open file"} ${item.name}`;
          const detailLabel = `${isSelected ? "Close" : "Open"} actions for ${item.name}`;
          const availableOffline = props.isItemAvailableOffline(item);
          const subtitle = props.getItemSubtitle(item);

          return (
            <li key={item.path}>
              <div
                className={`item-row ${isSelected ? "selected" : ""}${isMarkedForDownload ? " batch-selected" : ""}`}
                onContextMenu={(event) => handleRowContextMenu(event, props.suppressNarrowScreenContextMenu)}
                onPointerCancel={props.onRowPointerCancel}
                onPointerDown={() => props.onRowPointerDown(item)}
                onPointerLeave={props.onRowPointerLeave}
                onPointerUp={props.onRowPointerUp}
              >
                <label className="item-batch-control">
                  <input
                    aria-label={selectForDownloadLabel}
                    checked={isMarkedForDownload}
                    className="item-batch-checkbox"
                    disabled={!props.canMarkForBatchDownload}
                    onChange={() => props.onToggleBatchSelection(item)}
                    type="checkbox"
                  />
                </label>
                <button
                  aria-label={openLabel}
                  className="item-open-button"
                  onClick={() => handleRowPrimaryClick(item)}
                  type="button"
                >
                  <span className="item-primary">
                    <FileEntryIcon item={item} />
                    <span className="item-text">
                      <span className="item-name">{item.name}</span>
                      {subtitle ? <span className="item-subtitle">{subtitle}</span> : null}
                    </span>
                    {availableOffline ? (
                      <span aria-label={`${item.name} is available offline`} className="offline-availability" title="Available offline">
                        <HardDriveDownload aria-hidden="true" />
                        <span>Offline</span>
                      </span>
                    ) : null}
                  </span>
                </button>
                <span className="meta item-secondary item-modified">
                  {formatFileTimestampCompact(item.lastModified)}
                </span>
                <span className="meta item-secondary item-size">
                  {item.isFolder ? "—" : formatBytes(item.size, props.fileSizeDisplayMode)}
                </span>
                <button
                  aria-label={detailLabel}
                  aria-pressed={isSelected}
                  className={`item-select-button ${isSelected ? "active" : ""}`}
                  onClick={() => props.onToggleEntrySelection(item)}
                  type="button"
                >
                  <span className="item-select-label">{isSelected ? "Actions" : "More"}</span>
                  <span aria-hidden="true" className="item-select-icon"><MoreVertical /></span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {props.showEmptyState ? (
        <div className="empty-state">
          <p className="empty empty-title">{props.emptyTitle}</p>
          <p className="status">{props.emptyStatus}</p>
          <div className="empty-actions">
            {props.showClearSearchButton ? <button onClick={props.onClearSearch} type="button">Clear search</button> : null}
            {props.showRetryFolderButton ? <button onClick={props.onRetryFolder} type="button">Retry folder</button> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
});

export function buildFileListItemSubtitle(
  item: FileEntry | SearchResult,
  searchActive: boolean
): string | undefined {
  return searchActive ? toDisplayPath(dirname(item.path)) : undefined;
}
