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
  House,
  MoreVertical,
  type LucideIcon
} from "lucide-react";
import { forwardRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";

import { formatFileSize, type FileSizeDisplayMode } from "../../../lib/fileSize";
import type { BreadcrumbItem } from "../presentation";
import { foldFileListBreadcrumbs } from "./breadcrumbPresentation";

export interface FileListStageProps {
  readonly items: readonly (FileEntry | SearchResult)[];
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly currentPath: string;
  readonly showBreadcrumbs: boolean;
  readonly onNavigateToPath: (path: string) => void;
  readonly folderDropActive: boolean;
  readonly batchModeActive: boolean;
  readonly showEmptyState: boolean;
  readonly emptyTitle: string;
  readonly emptyStatus: string;
  readonly showClearSearchButton: boolean;
  readonly showRetryFolderButton: boolean;
  readonly canMarkForBatchDownload: boolean;
  readonly selectionModeActive: boolean;
  readonly selectAllState: "none" | "partial" | "all";
  readonly canSelectAll: boolean;
  readonly canDeselectAll: boolean;
  readonly onToggleSelectAll: () => void;
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

interface FileListBreadcrumbsProps {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly currentPath: string;
  readonly onNavigateToPath: (path: string) => void;
}

function FileListBreadcrumbs(props: FileListBreadcrumbsProps) {
  const [expanded, setExpanded] = useState(false);
  const nodes = expanded
    ? props.breadcrumbs.map((item) => ({ kind: "item" as const, item }))
    : foldFileListBreadcrumbs(props.breadcrumbs);
  return (
    <nav aria-label="Breadcrumbs" className="breadcrumbs file-list-breadcrumbs">
      {nodes.map((node, index) => (
        <div className="breadcrumb-segment" key={node.kind === "ellipsis" ? "ellipsis" : node.item.value || "root"}>
          {node.kind === "ellipsis" ? (
            <button
              aria-label="Show all folders in this path"
              className="breadcrumb-ellipsis"
              onClick={() => setExpanded(true)}
              type="button"
            >
              …
            </button>
          ) : (
            <button
              aria-current={node.item.value === props.currentPath ? "page" : undefined}
              aria-label={node.item.ariaLabel}
              onClick={() => props.onNavigateToPath(node.item.value)}
              type="button"
            >
              {node.item.value ? node.item.label : <House aria-hidden="true" />}
            </button>
          )}
          {index < nodes.length - 1 ? <span aria-hidden="true" className="breadcrumb-separator">/</span> : null}
        </div>
      ))}
    </nav>
  );
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
      {props.showBreadcrumbs ? (
        <FileListBreadcrumbs
          breadcrumbs={props.breadcrumbs}
          currentPath={props.currentPath}
          key={props.currentPath}
          onNavigateToPath={props.onNavigateToPath}
        />
      ) : null}
      <div className="list-head">
        <span className="list-head-select-all">
          <label className="item-batch-control">
            <input
              aria-checked={props.selectAllState === "partial" ? "mixed" : props.selectAllState === "all"}
              aria-label={props.selectAllState === "all" ? "Deselect all items in this folder" : "Select all items in this folder"}
              checked={props.selectAllState === "all"}
              className="item-batch-checkbox"
              disabled={!props.canSelectAll && !props.canDeselectAll}
              onChange={props.onToggleSelectAll}
              ref={(element) => {
                if (element) {
                  element.indeterminate = props.selectAllState === "partial";
                }
              }}
              type="checkbox"
            />
          </label>
        </span>
        <span aria-hidden="true">Name</span>
        <span aria-hidden="true">Modified</span>
        <span aria-hidden="true">Size</span>
        <span aria-hidden="true">Actions</span>
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
