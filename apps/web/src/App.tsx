import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

import type {
  CapabilitySet,
  ConnectedAccount,
  FileEntry,
  HealthResponse,
  FilePreview,
  MutationResult,
  SearchResult,
  ViewerKind
} from "@davora/shared";
import { basename, dirname, getViewerKind, toDisplayPath } from "@davora/shared";

import {
  ApiRequestError,
  clearStoredAccountSession,
  connectAccount,
  copyFile,
  createFolder,
  createSession,
  createStreamingFileUrl,
  deleteConnectedAccount,
  deleteFile,
  downloadFile,
  fetchDownloadBlob,
  fetchOriginalFile,
  getFile,
  getHealth,
  listFiles,
  loadStoredAccounts,
  markStoredAccountReconnectRequired,
  moveFile,
  removeAccountFromStorage,
  saveActiveAccount,
  searchFiles,
  triggerBrowserDownload,
  uploadFileWithProgress
} from "./lib/api";
import { buildBatchDownloadPlan, downloadSelectionAsZip, type BatchDownloadPlan } from "./lib/batchDownload";
import { buildUploadSelectionPlan } from "./lib/uploadPlan";
import {
  cacheFolder,
  cacheSearch,
  clearFolderCacheForPath,
  clearFolderAndSearchCache,
  readFolderCacheEnvelope,
  readSearchCache
} from "./lib/cache";
import {
  clearAudioPreviewPosition,
  loadAudioPreviewPosition,
  saveAudioPreviewPosition,
  type AudioPreviewResumeTarget
} from "./lib/audioResume";
import {
  cacheOpenedFile,
  clearOpenedFileCache,
  configureOpenedFileCache,
  DEFAULT_OPENED_FILE_CACHE_LIMIT,
  getCachedOpenedFile,
  getOpenedFileCacheSummary,
  listOfflineFileCacheEntries,
  removeOfflineRoot,
  type OpenedFileCacheEntry
} from "./lib/openedFileCache";
import { APP_BUILD_LABEL } from "./lib/appBuild";
import { FILE_SIZE_DISPLAY_OPTIONS, formatFileSize, getFileSizeDisplayModeLabel, type FileSizeDisplayMode } from "./lib/fileSize";
import { DEFAULT_UI_SETTINGS, loadUiSettings, saveUiSettings, type SortMode } from "./lib/uiSettings";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { ReloadPrompt, usePwaPromptState } from "./components/ReloadPrompt";
import { SettingsDialog } from "./components/SettingsDialog";
import { decodeHeicPreview, HEIC_PREVIEW_MAX_SOURCE_BYTES, isHeicLikeFile } from "./lib/heicPreview";
import { StateBanner } from "./components/StateBanner";
import { TransferTray, type TransferTask } from "./components/TransferTray";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfLoadingTask = ReturnType<PdfJsModule["getDocument"]>;
type PdfRenderTask = { cancel: () => void; promise: Promise<unknown> };
type PdfZoomMode = "fit-width" | "fit-page" | "custom";

const PDF_MIN_ZOOM = 0.5;
const PDF_MAX_ZOOM = 3;
const PDF_ZOOM_STEP = 0.2;
const IMAGE_MIN_ZOOM = 0.25;
const IMAGE_MAX_ZOOM = 4;
const IMAGE_ZOOM_STEP = 0.15;

let pdfJsModulePromise: Promise<PdfJsModule> | undefined;

function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsModulePromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
    module.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return module;
  });
  return pdfJsModulePromise;
}

interface StoredAccountRecord {
  account: ConnectedAccount;
  session?: {
    token: string;
    expiresAt: string;
    rootPath: string;
    capabilities?: CapabilitySet;
  };
  pendingReconnect?: {
    baseUrl: string;
    username: string;
    label?: string;
  };
}

type ActionDialogState =
  | { kind: "createFolder"; value: string }
  | { kind: "delete" }
  | undefined;

type DestinationOperation = "move" | "copy";
type DestinationActionKind = DestinationOperation | "copyMove";

interface DestinationPickerState {
  kind: DestinationActionKind;
  folderPath: string;
  name: string;
  nameEdited: boolean;
  manualPath: string;
  manualMode: boolean;
  entries: FileEntry[];
  loading: boolean;
  reloadKey: number;
  error?: string;
}

interface AccountFormState {
  mode: "add" | "reconnect";
  accountId?: string;
  cacheNamespace?: string;
  baseUrl: string;
  username: string;
  appPassword: string;
  rootPath: string;
  label: string;
}

interface PreviewCacheState {
  source: "none" | "live" | "cache";
  cachedAt?: string;
  refreshing: boolean;
  stale: boolean;
  updateReady: boolean;
}

interface PendingPreviewUpdate {
  file: FilePreview;
  blob?: Blob;
}

interface OfflineSyncDialogState {
  entries: FileEntry[];
  phase: "estimating" | "ready" | "unknown";
  plan?: BatchDownloadPlan;
  error?: string;
}

interface OfflineSyncRootSummary {
  rootPath: string;
  name: string;
  kind: "file" | "folder" | "batch";
  fileCount: number;
  totalBytes: number;
  addedAt?: string;
}

const DEFAULT_PREVIEW_CACHE_STATE: PreviewCacheState = {
  source: "none",
  refreshing: false,
  stale: false,
  updateReady: false
};

const AUDIO_PREVIEW_RESUME_END_TOLERANCE_SECONDS = 1;
const MEDIA_STREAM_RETRY_DELAYS_MS = [500, 1000, 2000];

const PREVIEW_PREFETCH_AHEAD_COUNT = 1;
const MEDIA_GALLERY_VIEWERS = new Set<ViewerKind>(["image", "audio", "video"]);

function canRestoreAudioPreviewPosition(audio: HTMLAudioElement, positionSeconds: number): boolean {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) {
    return false;
  }

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return positionSeconds < Math.max(0, audio.duration - AUDIO_PREVIEW_RESUME_END_TOLERANCE_SECONDS);
  }

  return true;
}

function breadcrumbs(path: string) {
  const parts = path.split("/").filter(Boolean);
  return [{ label: "🏠", ariaLabel: "Go to home folder", value: "" }, ...parts.map((part, index) => ({ label: part, ariaLabel: `Go to /${parts.slice(0, index + 1).join("/")}`, value: parts.slice(0, index + 1).join("/") }))];
}

function joinPath(parentPath: string, name: string): string {
  const trimmedName = name.trim();
  if (!parentPath) {
    return trimmedName;
  }
  return `${parentPath}/${trimmedName}`;
}

function isSameOrDescendantPath(path: string, possibleAncestor: string): boolean {
  return path === possibleAncestor || path.startsWith(`${possibleAncestor}/`);
}

function splitNameForConflictSuffix(name: string): { stem: string; extension: string } {
  const finalDot = name.lastIndexOf(".");
  if (finalDot > 0 && finalDot < name.length - 1) {
    return { stem: name.slice(0, finalDot), extension: name.slice(finalDot) };
  }
  return { stem: name, extension: "" };
}

function addConflictSuffix(name: string, suffix: number): string {
  const { stem, extension } = splitNameForConflictSuffix(name);
  return `${stem} (${suffix})${extension}`;
}

function destinationNameExists(entries: FileEntry[], name: string, selectedEntry: FileEntry, operation: DestinationOperation): boolean {
  return entries.some((entry) => entry.name === name && (operation === "copy" || entry.path !== selectedEntry.path));
}

function suggestDestinationName(entries: FileEntry[], name: string, selectedEntry: FileEntry, operation: DestinationOperation): string {
  const trimmedName = name.trim();
  if (!destinationNameExists(entries, trimmedName, selectedEntry, operation)) {
    return trimmedName;
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = addConflictSuffix(trimmedName, index);
    if (!destinationNameExists(entries, candidate, selectedEntry, operation)) {
      return candidate;
    }
  }
  return addConflictSuffix(trimmedName, Date.now());
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",")[1]! : value);
    };
    reader.readAsDataURL(file);
  });
}

function readFileAsBase64WithProgress(
  file: File,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onprogress = (event) => {
      if (typeof event.loaded === "number" && typeof event.total === "number" && event.total > 0) {
        onProgress?.(event.loaded, event.total);
      }
    };
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",")[1]! : value);
    };
    reader.readAsDataURL(file);
  });
}

function isFolderAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && /folder already exists/i.test(error.message);
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildUploadSuccessMessage(fileCount: number, directoryCount: number, currentLocationLabel: string, source: "picker" | "drop"): string {
  const directorySuffix = directoryCount > 0 ? ` from ${pluralize(directoryCount, "folder")}` : "";
  const sourceSuffix = source === "drop" ? " via drag and drop" : "";
  return `Uploaded ${pluralize(fileCount, "file")}${directorySuffix} into ${currentLocationLabel}${sourceSuffix}`;
}

function buildUploadPartialFailureMessage(completedFileCount: number, totalFileCount: number, currentLocationLabel: string): string {
  return `Upload stopped after ${pluralize(completedFileCount, "file")} of ${totalFileCount} into ${currentLocationLabel}`;
}

function buildDownloadSelectionLabel(fileCount: number, directoryCount: number): string {
  const parts = [fileCount > 0 ? pluralize(fileCount, "file") : undefined, directoryCount > 0 ? pluralize(directoryCount, "folder") : undefined].filter(Boolean);
  return parts.join(" and ") || "0 items";
}

function buildBatchDownloadReadyMessage(plan: BatchDownloadPlan, activeAccountName: string): string {
  return `Preparing ${buildDownloadSelectionLabel(plan.selectedFileCount, plan.selectedDirectoryCount)} as ${plan.archiveName} in ${activeAccountName}.`;
}

function buildBatchDownloadSuccessMessage(plan: BatchDownloadPlan, activeAccountName: string): string {
  const failedCount = plan.failedFiles.length;
  const baseMessage = `Downloaded ${buildDownloadSelectionLabel(plan.selectedFileCount, plan.selectedDirectoryCount)} as ${plan.archiveName} in ${activeAccountName}.`;
  if (failedCount > 0) {
    return `${baseMessage} ${buildBatchDownloadPartialSummary(plan)}.`;
  }
  return baseMessage;
}

function buildBatchDownloadPartialSummary(plan: BatchDownloadPlan): string {
  const failedCount = plan.failedFiles.length;
  const succeededCount = Math.max(0, plan.files.length - failedCount);
  return `Downloaded ${succeededCount} of ${plan.files.length} files; ${failedCount} failed`;
}

function applyDirectoryUploadAttributes(input: HTMLInputElement | null) {
  if (!input) {
    return;
  }

  input.multiple = true;
  input.setAttribute("multiple", "");
  input.setAttribute("webkitdirectory", "");
  input.setAttribute("directory", "");
  (input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }).webkitdirectory = true;
  (input as HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }).directory = true;
}

function classifyState(error: ApiRequestError | Error | undefined, cacheOnlyMode: boolean, stale: boolean, refreshing: boolean, offline: boolean): { kind: "loading" | "error" | "offline" | "stale" | "permission" | "idle"; message: string } {
  if (cacheOnlyMode && stale) {
    return {
      kind: "stale",
      message: offline
        ? "Showing cached data while offline."
        : "Showing cached data while the local server is unavailable."
    };
  }
  if (refreshing && stale) {
    return { kind: "stale", message: "Showing cached data while checking for changes in the background." };
  }
  if (stale) {
    return { kind: "stale", message: "Showing cached data because live refresh did not replace it." };
  }
  if (cacheOnlyMode) {
    return {
      kind: "offline",
      message: offline
        ? "Offline mode: cached reads are available, mutations stay disabled until you reconnect."
        : "Local server unavailable: cached reads are available, mutations stay disabled until Davora can reach the server again."
    };
  }
  if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403 || error.code === "permission_denied")) {
    return { kind: "permission", message: error.message };
  }
  if (error) {
    return { kind: "error", message: error.message };
  }
  return { kind: "idle", message: "" };
}

function isHiddenEntry(entry: { name: string }): boolean {
  return entry.name.startsWith(".");
}

function viewerHeading(viewer: ViewerKind | undefined): string {
  switch (viewer) {
    case "markdown":
      return "Markdown preview";
    case "image":
      return "Image preview";
    case "audio":
      return "Audio preview";
    case "video":
      return "Video preview";
    case "pdf":
      return "PDF preview";
    case "unsupported":
      return "Unsupported preview";
    default:
      return "Text preview";
  }
}

function formatBytes(value: number | undefined, mode: FileSizeDisplayMode): string {
  return formatFileSize(value, mode);
}

function sortAndGroupEntries(entries: FileEntry[], sortMode: SortMode): FileEntry[] {
  const sortFn = (left: FileEntry, right: FileEntry): number => {
    switch (sortMode) {
      case "name-asc":
        return left.name.localeCompare(right.name);
      case "name-desc":
        return right.name.localeCompare(left.name);
      case "modified-desc":
        return (right.lastModified ?? "").localeCompare(left.lastModified ?? "");
      case "modified-asc":
        return (left.lastModified ?? "").localeCompare(right.lastModified ?? "");
      case "size-desc":
        return (right.size ?? 0) - (left.size ?? 0);
      case "size-asc":
        return (left.size ?? 0) - (right.size ?? 0);
      default:
        return left.name.localeCompare(right.name);
    }
  };

  return [...entries].sort((left, right) => {
    if (left.isFolder !== right.isFolder) {
      return left.isFolder ? -1 : 1;
    }
    return sortFn(left, right);
  });
}

const SORT_MODE_LABELS: Record<SortMode, string> = {
  "name-asc": "Name A-Z",
  "name-desc": "Name Z-A",
  "modified-desc": "Modified newest",
  "modified-asc": "Modified oldest",
  "size-desc": "Size largest",
  "size-asc": "Size smallest"
};

const SORT_MODE_COMPACT_LABELS: Record<SortMode, string> = {
  "name-asc": "A-Z",
  "name-desc": "Z-A",
  "modified-desc": "New",
  "modified-asc": "Old",
  "size-desc": "Big",
  "size-asc": "Small"
};

const SORT_MODE_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "modified-desc", label: "Modified newest" },
  { value: "modified-asc", label: "Modified oldest" },
  { value: "size-desc", label: "Size largest" },
  { value: "size-asc", label: "Size smallest" }
];

function formatFileTimestamp(value: string | undefined, variant: "compact" | "full" = "full"): string {
  if (!value) {
    return "Unknown";
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

  if (variant === "compact") {
    return `${month} ${day}, ${hour}:${minute}`;
  }

  return `${month} ${day}, ${date.getUTCFullYear()}, ${hour}:${minute}`;
}

function dismissOnScrimClick(event: { currentTarget: EventTarget & Element; target: EventTarget | null }, onDismiss: () => void) {
  if (event.target === event.currentTarget) {
    onDismiss();
  }
}

function normalizeMimeType(mimeType: string | undefined): string | undefined {
  return mimeType?.split(";", 1)[0]?.trim();
}

function formatCacheTimestamp(value: string | undefined): string | undefined {
  return value ? new Date(value).toLocaleString() : undefined;
}

function buildPreviewFingerprint(file: FilePreview, options?: { blob?: Blob; mimeType?: string; filename?: string }): string {
  return JSON.stringify({
    path: file.path,
    name: file.name,
    size: file.size,
    mimeType: normalizeMimeType(file.mimeType),
    lastModified: file.lastModified,
    etag: file.etag,
    viewer: file.viewer,
    content: file.content,
    encoding: file.encoding,
    truncated: file.truncated,
    bytesRead: file.bytesRead,
    unsupportedReason: file.unsupportedReason,
    requiresOriginalBlob: file.requiresOriginalBlob,
    blobSize: options?.blob?.size,
    blobType: options?.blob?.type ?? normalizeMimeType(options?.mimeType),
    filename: options?.filename
  });
}

function buildCachedPreviewFingerprint(entry: OpenedFileCacheEntry, blob?: Blob): string {
  return buildPreviewFingerprint(entry.preview, { blob, mimeType: entry.mimeType, filename: entry.filename });
}

function createCachedPreviewFromBlob(path: string, blob: Blob, fallbackName?: string, fallbackSize?: number): FilePreview {
  const mimeType = blob.type || "application/octet-stream";
  const viewer = getViewerKind(mimeType);
  const name = fallbackName ?? basename(path);
  if (viewer === "text" || viewer === "markdown") {
    return {
      path,
      name,
      isFolder: false,
      mimeType,
      viewer,
      content: "",
      encoding: "utf8",
      truncated: false,
      bytesRead: blob.size,
      requiresOriginalBlob: false,
      size: fallbackSize ?? blob.size
    };
  }

  return {
    path,
    name,
    isFolder: false,
    mimeType,
    viewer,
    content: "",
    encoding: "none",
    truncated: false,
    bytesRead: 0,
    requiresOriginalBlob: viewer === "image" || viewer === "audio" || viewer === "video" || viewer === "pdf",
    size: fallbackSize ?? blob.size
  };
}

function summarizeOfflineRoots(entries: OpenedFileCacheEntry[]): OfflineSyncRootSummary[] {
  const roots = new Map<string, OfflineSyncRootSummary>();
  for (const entry of entries) {
    const rootPath = entry.keepOfflineRoot ?? entry.path;
    const addedAt = entry.keepOfflineAddedAt ?? entry.cachedAt;
    const existing = roots.get(rootPath);
    if (existing) {
      existing.fileCount += 1;
      existing.totalBytes += entry.blobSize;
      if (!existing.addedAt || Date.parse(addedAt) < Date.parse(existing.addedAt)) {
        existing.addedAt = addedAt;
      }
      continue;
    }
    roots.set(rootPath, {
      rootPath,
      name: entry.keepOfflineRootName ?? (basename(rootPath) || "Offline selection"),
      kind: entry.keepOfflineRootKind ?? "file",
      fileCount: 1,
      totalBytes: entry.blobSize,
      addedAt
    });
  }
  return Array.from(roots.values()).sort((left, right) => Date.parse(right.addedAt ?? "") - Date.parse(left.addedAt ?? ""));
}

function collectOfflineFolderCachePaths(entries: OpenedFileCacheEntry[]): string[] {
  const paths = new Set<string>();
  entries.forEach((entry) => {
    let path = entry.path;
    while (path.includes("/")) {
      path = dirname(path);
      if (path) {
        paths.add(path);
      }
    }
  });
  return [...paths].sort();
}

function isCachedPreviewFreshEnough(cachedAt: string | undefined, freshnessIntervalSeconds: number): boolean {
  if (!cachedAt) {
    return false;
  }

  const cachedTime = Date.parse(cachedAt);
  if (!Number.isFinite(cachedTime)) {
    return false;
  }

  return Date.now() - cachedTime < freshnessIntervalSeconds * 1000;
}

function getPreviewNotice(cacheState: PreviewCacheState, cacheOnlyMode: boolean, offline: boolean): { kind: "loading" | "stale"; message: string } | undefined {
  if (cacheState.source !== "cache") {
    return undefined;
  }

  const cachedAt = formatCacheTimestamp(cacheState.cachedAt);
  const cachedSuffix = cachedAt ? ` from ${cachedAt}` : "";

  if (cacheState.updateReady) {
    return {
      kind: "stale",
      message: `A fresher version is ready. You are still reading the cached preview${cachedSuffix}. Apply refresh when you are ready.`
    };
  }

  if (cacheOnlyMode) {
    return {
      kind: "stale",
      message: offline
        ? `Showing cached preview${cachedSuffix} while offline.`
        : `Showing cached preview${cachedSuffix} while the local server is unavailable.`
    };
  }

  if (cacheState.refreshing) {
    return {
      kind: "stale",
      message: `Showing cached preview${cachedSuffix} while checking for changes in the background.`
    };
  }

  if (cacheState.stale) {
    return {
      kind: "stale",
      message: `Still showing cached preview${cachedSuffix} because live refresh did not replace it.`
    };
  }

  return undefined;
}

interface PreviewPayload {
  file: FilePreview;
  blob?: Blob;
  streamUrl?: string;
  mimeType: string;
  filename: string;
  fingerprint: string;
}

function createHeicUnsupportedPreview(file: FilePreview | FileEntry, reason: string): FilePreview {
  return {
    path: file.path,
    name: file.name,
    isFolder: false,
    mimeType: file.mimeType ?? "image/heic",
    viewer: "unsupported",
    content: "",
    encoding: "none",
    truncated: false,
    bytesRead: 0,
    size: file.size,
    lastModified: file.lastModified,
    unsupportedReason: reason,
    requiresOriginalBlob: false
  };
}

function isHeicUnsupportedPreview(file: FilePreview): boolean {
  return file.viewer === "unsupported" && isHeicLikeFile(file);
}

function shouldShowUnsupportedPreview(file: FilePreview): boolean {
  return isHeicUnsupportedPreview(file);
}

function isMediaGalleryEntry(entry: FileEntry, experimentalHeicPreviewEnabled: boolean): boolean {
  if (isHeicLikeFile(entry)) {
    return experimentalHeicPreviewEnabled;
  }
  return isMediaGalleryViewer(getViewerKind(entry.mimeType));
}

async function loadPreviewPayload(path: string, token: string, options: { experimentalHeicPreviewEnabled: boolean }): Promise<PreviewPayload> {
  const response = await getFile(path, token);
  if (isHeicLikeFile(response.file)) {
    const mimeType = response.file.mimeType ?? "image/heic";
    const filename = response.file.name;
    if (!options.experimentalHeicPreviewEnabled) {
      const file = createHeicUnsupportedPreview(response.file, "HEIC preview is experimental and disabled in this browser. Enable experimental HEIC preview in Profile & settings to try local decoding, or open/download the original file.");
      return {
        file,
        mimeType,
        filename,
        fingerprint: buildPreviewFingerprint(file, { mimeType, filename })
      };
    }

    if (typeof response.file.size === "number" && response.file.size > HEIC_PREVIEW_MAX_SOURCE_BYTES) {
      const file = createHeicUnsupportedPreview(response.file, `HEIC preview is limited to files up to ${Math.round(HEIC_PREVIEW_MAX_SOURCE_BYTES / (1024 * 1024))} MB.`);
      return {
        file,
        mimeType,
        filename,
        fingerprint: buildPreviewFingerprint(file, { mimeType, filename })
      };
    }

    const original = await fetchOriginalFile(path, token);
    try {
      const decoded = await decodeHeicPreview(original.blob);
      const file: FilePreview = {
        ...response.file,
        viewer: "image",
        content: "",
        encoding: "none",
        truncated: false,
        bytesRead: 0,
        requiresOriginalBlob: true,
        unsupportedReason: undefined
      };
      return {
        file,
        blob: decoded.blob,
        mimeType: decoded.mimeType,
        filename: `${filename}.jpg`,
        fingerprint: buildPreviewFingerprint(file, {
          blob: decoded.blob,
          mimeType: decoded.mimeType,
          filename: `${filename}.jpg`
        })
      };
    } catch (error) {
      const file = createHeicUnsupportedPreview(response.file, error instanceof Error
        ? `HEIC preview could not be decoded locally: ${error.message}`
        : "HEIC preview could not be decoded locally. You can still open or download the original file.");
      return {
        file,
        mimeType: original.mimeType || mimeType,
        filename,
        fingerprint: buildPreviewFingerprint(file, { mimeType: original.mimeType || mimeType, filename })
      };
    }
  }

  if (response.file.requiresOriginalBlob) {
    if (response.file.viewer === "audio" || response.file.viewer === "video") {
      const mimeType = response.file.mimeType ?? "application/octet-stream";
      const filename = response.file.name;
      return {
        file: response.file,
        streamUrl: await createStreamingFileUrl(path, token),
        mimeType,
        filename,
        fingerprint: buildPreviewFingerprint(response.file, { mimeType, filename })
      };
    }

    const original = await fetchOriginalFile(path, token);
    return {
      file: response.file,
      blob: original.blob,
      mimeType: original.mimeType,
      filename: original.filename,
      fingerprint: buildPreviewFingerprint(response.file, {
        blob: original.blob,
        mimeType: original.mimeType,
        filename: original.filename
      })
    };
  }

  const mimeType = response.file.mimeType ?? "text/plain";
  const filename = response.file.name;
  return {
    file: response.file,
    mimeType,
    filename,
    fingerprint: buildPreviewFingerprint(response.file, { mimeType, filename })
  };
}

function requiresOriginalBlobViewer(viewer: ViewerKind | undefined): boolean {
  return viewer === "image" || viewer === "audio" || viewer === "video" || viewer === "pdf";
}

function isStreamingMediaViewer(viewer: ViewerKind | undefined): boolean {
  return viewer === "audio" || viewer === "video";
}

function isMediaGalleryViewer(viewer: ViewerKind | undefined): boolean {
  return viewer ? MEDIA_GALLERY_VIEWERS.has(viewer) : false;
}

function buildMediaRetryUrl(source: string, retryKey: number): string {
  if (retryKey <= 0 || source.startsWith("blob:")) {
    return source;
  }

  const url = new URL(source, window.location.href);
  url.searchParams.set("streamRetry", String(retryKey));
  return source.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function canUseCachedPreview(cached: Awaited<ReturnType<typeof getCachedOpenedFile>> | undefined, options: { token?: string; experimentalHeicPreviewEnabled: boolean }): boolean {
  if (!cached) {
    return false;
  }

  if (isHeicLikeFile(cached.entry.preview) && !options.experimentalHeicPreviewEnabled) {
    return false;
  }

  return !requiresOriginalBlobViewer(cached.entry.preview.viewer) || Boolean(cached.blob) || (isStreamingMediaViewer(cached.entry.preview.viewer) && Boolean(options.token));
}

function openBlobInNewTab(blob: Blob, existingPopup?: Window | null): void {
  const objectUrl = URL.createObjectURL(blob);
  const openUrl = blob.type === "application/pdf"
    ? URL.createObjectURL(new Blob(
      [
        `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>PDF</title></head><body style="margin:0"><iframe src="${objectUrl}" style="position:fixed;inset:0;width:100%;height:100%;border:0" title="PDF"></iframe></body></html>`
      ],
      { type: "text/html" }
    ))
    : objectUrl;
  const popup = existingPopup && !existingPopup.closed
    ? existingPopup
    : (typeof window.open === "function" ? window.open("about:blank", "_blank") : null);

  // Pop-up blockers are sensitive to async work; pre-opening the window in the click handler
  // and then navigating it once the blob is ready is the most robust option.
  if (popup && !popup.closed) {
    try {
      // Best-effort: prevent the opened page from reaching back into this window.
      popup.opener = null;
    } catch {
      // ignore
    }
    try {
      popup.location.href = openUrl;
    } catch {
      // If navigation fails, fall back to an anchor click.
      const anchor = document.createElement("a");
      anchor.href = openUrl;
      anchor.rel = "noopener noreferrer";
      anchor.target = "_blank";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  } else {
    const anchor = document.createElement("a");
    anchor.href = openUrl;
    anchor.rel = "noopener noreferrer";
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    if (openUrl !== objectUrl) {
      URL.revokeObjectURL(openUrl);
    }
  }, 5 * 60_000);
}

interface PdfCanvasPreviewProps {
  blobUrl: string;
  fileName: string;
  onError: () => void;
}

function clampPdfZoom(value: number): number {
  return Math.max(PDF_MIN_ZOOM, Math.min(PDF_MAX_ZOOM, value));
}

function clampImageZoom(value: number): number {
  return Math.max(IMAGE_MIN_ZOOM, Math.min(IMAGE_MAX_ZOOM, value));
}

function getTouchDistance(touches: React.TouchList): number {
  if (touches.length < 2) {
    return 0;
  }
  const first = touches.item(0);
  const second = touches.item(1);
  if (!first || !second) {
    return 0;
  }
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function PdfCanvasPreview(props: PdfCanvasPreviewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const onErrorRef = useRef(props.onError);
  const pinchRef = useRef<{ distance: number; zoom: number } | undefined>();
  const panRef = useRef<{ touchId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | undefined>();
  const [renderState, setRenderState] = useState<"loading" | "ready" | "failed">("loading");
  const [pageCount, setPageCount] = useState<number | undefined>();
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>("fit-width");
  const [zoomScale, setZoomScale] = useState(1);
  const [renderedScale, setRenderedScale] = useState(1);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    onErrorRef.current = props.onError;
  }, [props.onError]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      setLayoutVersion((version) => version + 1);
    });
    resizeObserver.observe(scrollElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const renderTasks: PdfRenderTask[] = [];
    let loadingTask: PdfLoadingTask | undefined;

    const renderPdf = async () => {
      setRenderState("loading");
      setPageCount(undefined);

      try {
        const response = await fetch(props.blobUrl);
        if (!response.ok) {
          throw new Error("PDF bytes could not be loaded.");
        }

        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) {
          return;
        }

        const pdfjsLib = await loadPdfJs();
        loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;
        const firstPage = await pdf.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const scrollElement = scrollRef.current;
        if (!scrollElement || cancelled) {
          return;
        }

        const availableWidth = Math.max(scrollElement.clientWidth - 32, 240);
        const availableHeight = Math.max(scrollElement.clientHeight - 32, 240);
        const fitWidthScale = clampPdfZoom(availableWidth / Math.max(firstViewport.width, 1));
        const fitPageScale = clampPdfZoom(
          Math.min(
            availableWidth / Math.max(firstViewport.width, 1),
            availableHeight / Math.max(firstViewport.height, 1)
          )
        );
        const cssScale = zoomMode === "fit-width" ? fitWidthScale : zoomMode === "fit-page" ? fitPageScale : clampPdfZoom(zoomScale);
        const outputScale = window.devicePixelRatio || 1;

        setPageCount(pdf.numPages);
        setRenderedScale(cssScale);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) {
            return;
          }
          const page = pageNumber === 1 ? firstPage : await pdf.getPage(pageNumber);
          const canvas = canvasRefs.current[pageNumber - 1];
          const context = canvas?.getContext("2d");
          if (!canvas || !context) {
            continue;
          }

          const viewport = page.getViewport({ scale: cssScale });
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          context.clearRect(0, 0, canvas.width, canvas.height);

          const renderTask = page.render({
            canvas,
            canvasContext: context,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
            viewport
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
        }

        if (!cancelled) {
          setRenderState("ready");
          window.requestAnimationFrame(updateCurrentPageFromScroll);
        }
      } catch (error) {
        if (!cancelled) {
          setRenderState("failed");
          onErrorRef.current();
        }
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
      renderTasks.forEach((renderTask) => {
        try {
          renderTask.cancel();
        } catch {
          // Render work may already be complete.
        }
      });
      void loadingTask?.destroy();
    };
  }, [layoutVersion, props.blobUrl, zoomMode, zoomScale]);

  const updateCurrentPageFromScroll = () => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !pageRefs.current.length) {
      return;
    }

    const viewportCenter = scrollElement.scrollTop + scrollElement.clientHeight / 2;
    let nextPage = 1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    pageRefs.current.forEach((pageElement, index) => {
      if (!pageElement) {
        return;
      }
      const pageCenter = pageElement.offsetTop + pageElement.offsetHeight / 2;
      const distance = Math.abs(pageCenter - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nextPage = index + 1;
      }
    });

    setCurrentPage(nextPage);
  };

  const scrollToPage = (pageNumber: number) => {
    const targetPage = Math.max(1, Math.min(pageCount ?? 1, pageNumber));
    pageRefs.current[targetPage - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(targetPage);
  };

  const setCustomZoom = (nextZoom: number) => {
    setZoomMode("custom");
    setZoomScale(clampPdfZoom(nextZoom));
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    setCustomZoom(renderedScale + (event.deltaY < 0 ? PDF_ZOOM_STEP : -PDF_ZOOM_STEP));
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const distance = getTouchDistance(event.touches);
      if (distance > 0) {
        pinchRef.current = { distance, zoom: renderedScale };
        panRef.current = undefined;
      }
      return;
    }

    const touch = event.touches.item(0);
    const scrollElement = scrollRef.current;
    if (touch && scrollElement) {
      panRef.current = {
        touchId: touch.identifier,
        clientX: touch.clientX,
        clientY: touch.clientY,
        scrollLeft: scrollElement.scrollLeft,
        scrollTop: scrollElement.scrollTop
      };
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchRef.current) {
      const nextDistance = getTouchDistance(event.touches);
      if (nextDistance <= 0) {
        return;
      }
      event.preventDefault();
      setCustomZoom(pinchRef.current.zoom * (nextDistance / pinchRef.current.distance));
      return;
    }

    const pan = panRef.current;
    const scrollElement = scrollRef.current;
    if (event.touches.length !== 1 || !pan || !scrollElement) {
      return;
    }
    let touch: React.Touch | undefined;
    for (let index = 0; index < event.touches.length; index += 1) {
      const candidate = event.touches.item(index);
      if (candidate?.identifier === pan.touchId) {
        touch = candidate;
        break;
      }
    }
    if (!touch) {
      return;
    }
    event.preventDefault();
    scrollElement.scrollLeft = pan.scrollLeft - (touch.clientX - pan.clientX);
    scrollElement.scrollTop = pan.scrollTop - (touch.clientY - pan.clientY);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      pinchRef.current = undefined;
    }
    if (event.touches.length === 0) {
      panRef.current = undefined;
    }
  };

  const renderedZoomLabel = `${Math.round(renderedScale * 100)}%`;
  const visiblePageCount = pageCount ?? 1;

  return (
    <div className="pdf-canvas-preview" aria-label={`PDF preview ${props.fileName}`}>
      <div className="pdf-canvas-toolbar">
        <span className="pdf-canvas-title">{props.fileName}</span>
        <span className="pdf-canvas-page-status" aria-live="polite">
          {pageCount ? `Page ${currentPage} of ${pageCount}` : "Rendering PDF"}
        </span>
        <div className="pdf-canvas-controls" aria-label="PDF controls">
          <button
            type="button"
            className="pdf-canvas-control"
            aria-label="Previous PDF page"
            disabled={currentPage <= 1 || renderState !== "ready"}
            onClick={() => scrollToPage(currentPage - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="pdf-canvas-control"
            aria-label="Next PDF page"
            disabled={currentPage >= visiblePageCount || renderState !== "ready"}
            onClick={() => scrollToPage(currentPage + 1)}
          >
            ›
          </button>
          <button
            type="button"
            className="pdf-canvas-control"
            aria-label="Zoom PDF out"
            disabled={renderState !== "ready" || renderedScale <= PDF_MIN_ZOOM}
            onClick={() => setCustomZoom(renderedScale - PDF_ZOOM_STEP)}
          >
            -
          </button>
          <span className="pdf-canvas-zoom" aria-label={`PDF zoom ${renderedZoomLabel}`} aria-live="polite">
            {renderedZoomLabel}
          </span>
          <button
            type="button"
            className="pdf-canvas-control"
            aria-label="Zoom PDF in"
            disabled={renderState !== "ready" || renderedScale >= PDF_MAX_ZOOM}
            onClick={() => setCustomZoom(renderedScale + PDF_ZOOM_STEP)}
          >
            +
          </button>
          <button
            type="button"
            className="pdf-canvas-control pdf-canvas-control-text"
            aria-label="Fit PDF to width"
            aria-pressed={zoomMode === "fit-width"}
            disabled={renderState !== "ready"}
            onClick={() => setZoomMode("fit-width")}
          >
            Fit width
          </button>
          <button
            type="button"
            className="pdf-canvas-control pdf-canvas-control-text"
            aria-label="Fit PDF to page"
            aria-pressed={zoomMode === "fit-page"}
            disabled={renderState !== "ready"}
            onClick={() => setZoomMode("fit-page")}
          >
            Fit page
          </button>
        </div>
      </div>
      <div
        className="pdf-canvas-scroll"
        ref={scrollRef}
        onScroll={updateCurrentPageFromScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="pdf-canvas-pages">
          {Array.from({ length: visiblePageCount }, (_, index) => (
            <div
              className="pdf-canvas-page"
              key={index + 1}
              ref={(element) => {
                pageRefs.current[index] = element;
              }}
            >
              <canvas
                aria-label={`PDF page ${index + 1}`}
                className="pdf-canvas"
                data-render-state={renderState}
                ref={(element) => {
                  canvasRefs.current[index] = element;
                }}
              />
              {pageCount ? <span className="pdf-canvas-page-label">Page {index + 1}</span> : null}
            </div>
          ))}
        </div>
        {renderState === "loading" ? <p className="pdf-canvas-status">Rendering PDF...</p> : null}
      </div>
    </div>
  );
}

function isUnauthorized(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 401;
}

function isTransientBootstrapError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.status >= 500 && error.code !== "config_error";
  }

  return error instanceof TypeError || (error instanceof Error && /fetch|network|proxy|socket|connection/i.test(error.message));
}

async function retryTransientBootstrap<T>(runner: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runner();
    } catch (error) {
      lastError = error;
      if (!isTransientBootstrapError(error) || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, attempt * 250));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Bootstrap retry failed.");
}

function getBootstrapErrorMessage(error: unknown, unlockFlow: boolean): string {
  if (error instanceof ApiRequestError && error.code === "invalid_unlock_code") {
    return "Unlock code is invalid. Ask the deployment operator for the current APP_UNLOCK_CODE and try again.";
  }
  if (error instanceof ApiRequestError && error.code === "config_error") {
    return error.message;
  }
  if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
    return "This account needs to be reconnected before a session can be created.";
  }
  if (error instanceof ApiRequestError && error.status >= 500) {
    return "Unable to reach the Worker successfully. Confirm the local worker is running and retry.";
  }
  if (isTransientBootstrapError(error)) {
    return "Davora could not restore the local worker yet. The app will keep retrying during startup; if it still fails, retry restore once the worker finishes launching.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return unlockFlow
    ? "Unable to unlock this deployment. Confirm the unlock code and retry."
    : "Unable to create a session. Confirm the Worker is running and retry.";
}

function getHealthConfigErrorMessage(health: HealthResponse): string | undefined {
  if (health.configLoaded) {
    return undefined;
  }

  if (health.missing?.includes("SESSION_SECRET")) {
    return "Worker configuration is incomplete: SESSION_SECRET is missing. Provision it in the Worker runtime before release.";
  }

  if (health.missing && health.missing.length > 0) {
    return `Worker configuration is incomplete. Missing: ${health.missing.join(", ")}.`;
  }

  return "Worker configuration is incomplete. Check the required environment variables and retry.";
}

function canAttemptAutoRestore(account: ConnectedAccount | undefined): boolean {
  return Boolean(account && (account.connectionState === "connected" || account.connectionState === "reconnect_required"));
}

function createEmptyAccountForm(mode: "add" | "reconnect" = "add", rootPath = ""): AccountFormState {
  return {
    mode,
    baseUrl: "",
    username: "",
    appPassword: "",
    rootPath,
    label: ""
  };
}

function buildReconnectForm(record: StoredAccountRecord): AccountFormState {
  return {
    mode: "reconnect",
    accountId: record.account.id,
    cacheNamespace: record.account.cacheNamespace,
    baseUrl: record.pendingReconnect?.baseUrl ?? record.account.baseUrl,
    username: record.pendingReconnect?.username ?? record.account.username,
    appPassword: "",
    rootPath: record.account.rootPath,
    label: record.pendingReconnect?.label ?? record.account.label ?? ""
  };
}

interface ActionDialogProps {
  title: string;
  description: string;
  submitLabel: string;
  busy: boolean;
  error?: string;
  danger?: boolean;
  label?: string;
  supportingText?: string;
  targetText?: string;
  value?: string;
  onChange?: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function ActionDialog(props: ActionDialogProps) {
  return (
    <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, props.onClose)} role="presentation">
      <section aria-label={props.title} aria-modal="true" className="dialog-card panel" role="dialog">
        <div className="panel-header">
          <div>
            <p className="eyebrow section-eyebrow">Context action</p>
            <h2>{props.title}</h2>
          </div>
        </div>
        <p className="subtitle dialog-copy">{props.description}</p>
        {props.supportingText ? <p className="status">{props.supportingText}</p> : null}
        {props.targetText ? <p className="dialog-target">{props.targetText}</p> : null}
        {props.error ? <StateBanner kind="error" message={props.error} /> : null}
        <form className="dialog-form" onSubmit={props.onSubmit}>
          {props.label && props.onChange ? (
            <label>
              {props.label}
              <input
                aria-label={props.label}
                autoFocus
                disabled={props.busy}
                onChange={(event) => props.onChange?.(event.target.value)}
                value={props.value ?? ""}
              />
            </label>
          ) : null}
          <div className="dialog-actions">
            <button autoFocus={!props.label} onClick={props.onClose} type="button">Cancel</button>
            <button className={props.danger ? "button-danger" : undefined} disabled={props.busy} type="submit">{props.submitLabel}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

interface DestinationPickerDialogProps {
  kind: DestinationActionKind;
  selectedEntry: FileEntry;
  folderPath: string;
  entries: FileEntry[];
  name: string;
  manualPath: string;
  manualMode: boolean;
  busy: boolean;
  loading: boolean;
  error?: string;
  actionError?: string;
  validationMessage?: string;
  destinationPath: string;
  onClose: () => void;
  onSubmit: (operation: DestinationOperation, event?: FormEvent<HTMLFormElement>) => void;
  onFolderChange: (path: string) => void;
  onNameChange: (value: string) => void;
  onManualModeChange: (value: boolean) => void;
  onManualPathChange: (value: string) => void;
  onReload: () => void;
}

function DestinationPickerDialog(props: DestinationPickerDialogProps) {
  const title = props.kind === "copyMove" ? "Copy or move item" : props.kind === "copy" ? "Copy item" : "Move item";
  const submitLabel = props.kind === "copy" ? "Copy here" : "Move here";
  const description = props.kind === "copyMove"
    ? "Choose a destination folder, keep or edit the destination name, then copy or move here."
    : props.kind === "copy"
      ? "Choose a destination folder and optional copy name."
      : "Choose a destination folder and optional new name.";
  const defaultOperation: DestinationOperation = props.kind === "move" ? "move" : "copy";
  const folders = sortAndGroupEntries(props.entries.filter((entry) => entry.isFolder), "name-asc");
  const submitDisabled = props.busy || props.loading || Boolean(props.validationMessage) || Boolean(props.error);

  return (
    <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, props.onClose)} role="presentation">
      <section aria-label={title} aria-modal="true" className="dialog-card panel destination-picker-dialog" role="dialog">
        <div className="panel-header">
          <div>
            <p className="eyebrow section-eyebrow">Destination</p>
            <h2>{title}</h2>
          </div>
        </div>
        <p className="subtitle dialog-copy">{description}</p>
        <div className="destination-summary">
          <p><span className="summary-label">Selected</span> {props.selectedEntry.path}</p>
          <p><span className="summary-label">Destination</span> {toDisplayPath(props.folderPath)}</p>
        </div>
        {props.actionError ? <StateBanner kind="error" message={props.actionError} /> : null}
        {props.error ? <StateBanner kind="error" message={props.error} /> : null}
        {props.validationMessage ? <StateBanner kind="error" message={props.validationMessage} /> : null}
        <form className="destination-picker-form" onSubmit={(event) => props.onSubmit(defaultOperation, event)}>
          <label>
            Destination name
            <input
              aria-label="Destination name"
              disabled={props.busy || props.manualMode}
              onChange={(event) => props.onNameChange(event.target.value)}
              value={props.name}
            />
          </label>
          <nav aria-label="Destination folder path" className="breadcrumbs destination-breadcrumbs">
            {breadcrumbs(props.folderPath).map((item) => (
              <span className="breadcrumb-segment" key={item.value || "home"}>
                <button
                  aria-label={item.ariaLabel}
                  aria-current={item.value === props.folderPath ? "page" : undefined}
                  disabled={props.busy || props.loading || item.value === props.folderPath}
                  onClick={() => props.onFolderChange(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
                {item.value !== props.folderPath ? <span aria-hidden="true" className="breadcrumb-separator">/</span> : null}
              </span>
            ))}
          </nav>
          <div className="destination-folder-list" role="list" aria-label="Destination folders">
            {props.loading ? <p className="status">Loading folders...</p> : null}
            {!props.loading && folders.length === 0 ? <p className="status">No folders in this destination.</p> : null}
            {folders.map((folder) => (
              <button
                aria-label={`Open destination folder ${folder.name}`}
                disabled={props.busy}
                key={folder.path}
                onClick={() => props.onFolderChange(folder.path)}
                type="button"
              >
                <span aria-hidden="true" className="item-icon">📁</span>
                <span>{folder.name}</span>
              </button>
            ))}
          </div>
          <div className="destination-manual-path">
            <button
              aria-expanded={props.manualMode}
              className="quiet-button"
              disabled={props.busy}
              onClick={() => props.onManualModeChange(!props.manualMode)}
              type="button"
            >
              Manual path
            </button>
            {props.manualMode ? (
              <label>
                Full destination path
                <input
                  aria-label="Full destination path"
                  disabled={props.busy}
                  onChange={(event) => props.onManualPathChange(event.target.value)}
                  value={props.manualPath}
                />
              </label>
            ) : null}
          </div>
          <p className="status">Resolved destination: {props.destinationPath ? toDisplayPath(props.destinationPath) : "Choose a destination name"}</p>
          <div className="dialog-actions destination-picker-actions">
            <button onClick={props.onClose} type="button">Cancel</button>
            <button disabled={props.busy || props.loading} onClick={props.onReload} type="button">Refresh folders</button>
            {props.kind === "copyMove" ? (
              <>
                <button disabled={submitDisabled} onClick={() => props.onSubmit("copy")} type="button">Copy here</button>
                <button disabled={submitDisabled} onClick={() => props.onSubmit("move")} type="button">Move here</button>
              </>
            ) : <button disabled={submitDisabled} onClick={() => props.onSubmit(defaultOperation)} type="button">{submitLabel}</button>}
          </div>
        </form>
      </section>
    </div>
  );
}

interface AccountFormProps {
  form: AccountFormState;
  busy: boolean;
  error?: string;
  title: string;
  eyebrow: string;
  description: string;
  submitLabel: string;
  onChange: (next: AccountFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
}

function AccountForm(props: AccountFormProps) {
  return (
    <form className="account-form" onSubmit={props.onSubmit}>
      <div>
        <p className="eyebrow section-eyebrow">{props.eyebrow}</p>
        <h2>{props.title}</h2>
        <p className="subtitle">{props.description}</p>
      </div>
      {props.error ? <StateBanner kind="error" message={props.error} /> : null}
      <div className="account-form-grid">
        <label>
          Base URL
          <input
            aria-label="Base URL"
            autoComplete="url"
            disabled={props.busy}
            onChange={(event) => props.onChange({ ...props.form, baseUrl: event.target.value })}
            placeholder="https://nextcloud.example.com"
            value={props.form.baseUrl}
          />
        </label>
        <label>
          Username
          <input
            aria-label="Username"
            autoComplete="username"
            disabled={props.busy}
            onChange={(event) => props.onChange({ ...props.form, username: event.target.value })}
            placeholder="username"
            value={props.form.username}
          />
        </label>
        <label>
          App password
          <input
            aria-label="App password"
            autoComplete="current-password"
            disabled={props.busy}
            onChange={(event) => props.onChange({ ...props.form, appPassword: event.target.value })}
            placeholder="Enter Nextcloud app password"
            type="password"
            value={props.form.appPassword}
          />
        </label>
        <label>
          Root folder
          <input
            aria-label="Root folder"
            disabled={props.busy}
            onChange={(event) => props.onChange({ ...props.form, rootPath: event.target.value })}
            placeholder=".davora-agent-test"
            value={props.form.rootPath}
          />
        </label>
        <label>
          Label (optional)
          <input
            aria-label="Label"
            disabled={props.busy}
            onChange={(event) => props.onChange({ ...props.form, label: event.target.value })}
            placeholder="Personal cloud"
            value={props.form.label}
          />
        </label>
      </div>
      <p className="status">The app password is sent to the Worker only for this connect step and is not persisted in browser storage.</p>
      <div className="dialog-actions">
        {props.onCancel ? <button disabled={props.busy} onClick={props.onCancel} type="button">Cancel</button> : null}
        <button disabled={props.busy} type="submit">{props.submitLabel}</button>
      </div>
    </form>
  );
}

interface PreviewModalProps {
  open: boolean;
  accountId?: string;
  entry?: FileEntry;
  file?: FilePreview;
  blobUrl?: string;
  offline: boolean;
  workerUnavailable?: boolean;
  loading: boolean;
  error?: Error | ApiRequestError;
  token?: string;
  cacheState: PreviewCacheState;
  fileSizeDisplayMode: FileSizeDisplayMode;
  imageFitMode: "fill" | "fit";
  maxCacheableFileSizeBytes: number;
  onImageFitModeChange: (mode: "fill" | "fit") => void;
  onApplyRefresh?: () => void;
  onDownload?: (path: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
}

function PreviewModal(props: PreviewModalProps) {
  const [openingOriginal, setOpeningOriginal] = useState(false);
  const [originalOpenError, setOriginalOpenError] = useState<string | undefined>();
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [pdfPreviewFailed, setPdfPreviewFailed] = useState(false);
  const [mediaStreamState, setMediaStreamState] = useState<"idle" | "buffering" | "retrying" | "failed">("idle");
  const [mediaRetryAttempt, setMediaRetryAttempt] = useState(0);
  const [mediaRetryKey, setMediaRetryKey] = useState(0);
  const [imagePan, setImagePan] = useState({ x: 50, y: 50 });
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | undefined>();
  const [imageZoomScale, setImageZoomScale] = useState<number | undefined>();
  const imagePanStartRef = useRef<{ pointerId: number; clientX: number; clientY: number; startX: number; startY: number; moved: boolean } | undefined>();
  const imagePinchRef = useRef<{ distance: number; zoom: number } | undefined>();
  const imageScrollPanRef = useRef<{ touchId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | undefined>();
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const suppressImageAdvanceRef = useRef(false);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const lastPersistedAudioSecondRef = useRef<number | undefined>();
  const mediaRetryTimeoutRef = useRef<number | undefined>();
  const previewViewer = props.file?.viewer ?? getViewerKind(props.entry?.mimeType);
  const showGalleryControls = isMediaGalleryViewer(previewViewer) && (props.onPrevious || props.onNext);
  const imageStageAdvances = previewViewer === "image" && Boolean(props.onNext);
  const audioResumeAccountId = props.open && props.accountId && props.file?.viewer === "audio" ? props.accountId : undefined;
  const audioResumePath = props.open && props.file?.viewer === "audio" ? props.file?.path : undefined;
  const audioResumeTarget: AudioPreviewResumeTarget | undefined = audioResumeAccountId && audioResumePath
    ? { accountId: audioResumeAccountId, path: audioResumePath }
    : undefined;
  const streamMediaSource = isStreamingMediaViewer(previewViewer) && props.blobUrl && !props.blobUrl.startsWith("blob:");
  const effectiveMediaSource = props.blobUrl && streamMediaSource ? buildMediaRetryUrl(props.blobUrl, mediaRetryKey) : props.blobUrl;
  const [mediaAutoplayBlocked, setMediaAutoplayBlocked] = useState(false);

  useEffect(() => {
    setOpeningOriginal(false);
    setOriginalOpenError(undefined);
  }, [props.open, props.file?.path, props.file?.viewer]);

  useEffect(() => {
    setImagePreviewFailed(false);
    setPdfPreviewFailed(false);
    setImagePan({ x: 50, y: 50 });
    setImageNaturalSize(undefined);
    setImageZoomScale(undefined);
    setMediaStreamState("idle");
    setMediaRetryAttempt(0);
    setMediaRetryKey(0);
    setMediaAutoplayBlocked(false);
    if (mediaRetryTimeoutRef.current !== undefined) {
      window.clearTimeout(mediaRetryTimeoutRef.current);
      mediaRetryTimeoutRef.current = undefined;
    }
  }, [props.open, props.file?.path, props.file?.viewer, props.blobUrl]);

  useEffect(() => {
    return () => {
      if (mediaRetryTimeoutRef.current !== undefined) {
        window.clearTimeout(mediaRetryTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (props.imageFitMode === "fit") {
      setImagePan({ x: 50, y: 50 });
    }
  }, [props.imageFitMode]);

  useEffect(() => {
    if (!props.open || !effectiveMediaSource || !isStreamingMediaViewer(previewViewer)) {
      return;
    }

    const media = previewViewer === "audio" ? audioPreviewRef.current : videoPreviewRef.current;
    if (!media) {
      return;
    }

    let cancelled = false;
    setMediaAutoplayBlocked(false);
    try {
      const playResult = media.play();
      if (playResult && typeof playResult.then === "function") {
        playResult.catch(() => {
          if (!cancelled) {
            setMediaAutoplayBlocked(true);
          }
        });
      }
    } catch {
      if (!cancelled) {
        setMediaAutoplayBlocked(true);
      }
    }

    return () => {
      cancelled = true;
      try {
        media.pause();
      } catch {
        // Best-effort cleanup; media may already be detached.
      }
    };
  }, [effectiveMediaSource, previewViewer, props.file?.path, props.open]);

  useEffect(() => {
    lastPersistedAudioSecondRef.current = undefined;
  }, [audioResumeAccountId, audioResumePath, props.blobUrl]);

  useEffect(() => {
    const audio = audioPreviewRef.current;
    if (!props.open || !audioResumeTarget || !audio) {
      return;
    }

    const applyStoredPosition = (validateAgainstDuration: boolean) => {
      const storedPosition = loadAudioPreviewPosition(audioResumeTarget);
      if (storedPosition === undefined) {
        return;
      }

      if (validateAgainstDuration && !canRestoreAudioPreviewPosition(audio, storedPosition)) {
        clearAudioPreviewPosition(audioResumeTarget);
        try {
          audio.currentTime = 0;
        } catch {
          // Best-effort only.
        }
        return;
      }

      try {
        audio.currentTime = storedPosition;
      } catch {
        // Best-effort only. If the browser rejects the seek, playback stays at 0:00.
      }
    };

    const persistPosition = (force: boolean) => {
      const currentTime = audio.currentTime;
      if (!Number.isFinite(currentTime) || currentTime <= 0) {
        if (force && lastPersistedAudioSecondRef.current !== undefined) {
          clearAudioPreviewPosition(audioResumeTarget);
          lastPersistedAudioSecondRef.current = 0;
        }
        return;
      }

      const roundedSecond = Math.floor(currentTime);
      if (!force && lastPersistedAudioSecondRef.current === roundedSecond) {
        return;
      }

      saveAudioPreviewPosition(audioResumeTarget, currentTime);
      lastPersistedAudioSecondRef.current = roundedSecond;
    };

    const clearPosition = () => {
      clearAudioPreviewPosition(audioResumeTarget);
      lastPersistedAudioSecondRef.current = 0;
    };

    const handleTimeUpdate = () => persistPosition(false);
    const handlePause = () => {
      if (!audio.ended) {
        persistPosition(true);
      }
    };
    const handleEnded = () => clearPosition();

    const handleLoadedMetadata = () => applyStoredPosition(true);

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    applyStoredPosition(false);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);

      if (!audio.ended) {
        persistPosition(true);
      }
    };
  }, [audioResumeAccountId, audioResumePath, props.open]);

  useEffect(() => {
    if (!props.open || !showGalleryControls) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) {
        return;
      }

      if ((event.key === " " || event.code === "Space") && imageStageAdvances && props.onNext) {
        event.preventDefault();
        props.onNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imageStageAdvances, props.onNext, props.open, showGalleryControls]);

  if (!props.open) {
    return null;
  }

  const previewPath = props.file?.path ?? props.entry?.path;
  const handleDownload = previewPath && props.onDownload ? () => props.onDownload?.(previewPath) : undefined;
  const displayPath = toDisplayPath(previewPath ?? props.entry?.path ?? "");
  const fileName = props.file?.name ?? props.entry?.name ?? "file";
  const previewMode = viewerHeading(previewViewer);
  const previewKind = normalizeMimeType(props.file?.mimeType) ?? (props.entry?.isFolder ? "Folder" : "Unknown");
  const immersivePreview = previewViewer === "image" || previewViewer === "video" || previewViewer === "pdf";
  const canOpenOriginal = Boolean(previewPath && props.token && !props.entry?.isFolder);
  const previewIsHeic = isHeicLikeFile(props.file ?? props.entry ?? {});
  const showOpenOriginalAction = canOpenOriginal && (previewViewer === "pdf" || (previewIsHeic && previewViewer === "image"));
  const openOriginalLabel = previewViewer === "pdf" ? "Open PDF in new tab" : "Open original in new tab";
  const openOriginalVisibleLabel = previewViewer === "pdf" ? "Open PDF" : "Open original";
  const previewNotice = getPreviewNotice(props.cacheState, props.offline || Boolean(props.workerUnavailable), props.offline);
  const imagePreviewUnavailable = previewViewer === "image" && (!props.blobUrl || imagePreviewFailed);
  const mediaStreamingNote = isStreamingMediaViewer(previewViewer) && props.blobUrl
    ? props.blobUrl.startsWith("blob:")
      ? "Offline-retained media copy is playing from browser cache."
      : props.file?.size !== undefined && props.file.size <= props.maxCacheableFileSizeBytes
        ? "Streaming now. An offline cache copy continues saving in the background."
        : "Streaming-only playback. This file is above the offline cache size limit."
    : undefined;
  const imageHasCustomZoom = previewViewer === "image" && imageZoomScale !== undefined;
  const imageZoomLabel = `${Math.round((imageZoomScale ?? 1) * 100)}%`;

  const setCustomImageZoom = (nextZoom: number) => {
    setImageZoomScale(clampImageZoom(nextZoom));
  };

  const getDisplayedImageZoom = () => {
    const stageElement = imageStageRef.current;
    if (!stageElement || !imageNaturalSize) {
      return imageZoomScale ?? 1;
    }

    const widthScale = stageElement.clientWidth / Math.max(imageNaturalSize.width, 1);
    const heightScale = stageElement.clientHeight / Math.max(imageNaturalSize.height, 1);
    const displayedScale = props.imageFitMode === "fill"
      ? Math.max(widthScale, heightScale)
      : Math.min(widthScale, heightScale);

    return clampImageZoom(displayedScale);
  };

  const getCurrentImageZoom = () => imageZoomScale ?? getDisplayedImageZoom();

  const handleImageFitModeChange = (mode: "fill" | "fit") => {
    setImageZoomScale(undefined);
    props.onImageFitModeChange(mode);
  };

  const handleImagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewViewer !== "image" || imageHasCustomZoom || props.imageFitMode !== "fill") {
      return;
    }
    imagePanStartRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, startX: imagePan.x, startY: imagePan.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleImagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = imagePanStartRef.current;
    if (!start || start.pointerId !== event.pointerId || imageHasCustomZoom || props.imageFitMode !== "fill") {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - start.clientX) / Math.max(rect.width, 1)) * 100;
    const deltaY = ((event.clientY - start.clientY) / Math.max(rect.height, 1)) * 100;
    if (Math.abs(event.clientX - start.clientX) > 6 || Math.abs(event.clientY - start.clientY) > 6) {
      start.moved = true;
      suppressImageAdvanceRef.current = true;
    }
    setImagePan({ x: Math.min(100, Math.max(0, start.startX - deltaX)), y: Math.min(100, Math.max(0, start.startY - deltaY)) });
  };

  const handleImagePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = imagePanStartRef.current;
    if (start?.pointerId === event.pointerId) {
      imagePanStartRef.current = undefined;
    }
  };

  const handleImageWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (previewViewer !== "image" || (!event.ctrlKey && !event.metaKey)) {
      return;
    }
    event.preventDefault();
    suppressImageAdvanceRef.current = true;
    setCustomImageZoom(getCurrentImageZoom() + (event.deltaY < 0 ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP));
  };

  const handleImageTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (previewViewer !== "image") {
      return;
    }

    if (event.touches.length === 2) {
      const distance = getTouchDistance(event.touches);
      if (distance > 0) {
        imagePinchRef.current = { distance, zoom: getCurrentImageZoom() };
        imageScrollPanRef.current = undefined;
        suppressImageAdvanceRef.current = true;
      }
      return;
    }

    const touch = event.touches.item(0);
    const stageElement = imageStageRef.current;
    if (touch && stageElement && imageHasCustomZoom) {
      imageScrollPanRef.current = {
        touchId: touch.identifier,
        clientX: touch.clientX,
        clientY: touch.clientY,
        scrollLeft: stageElement.scrollLeft,
        scrollTop: stageElement.scrollTop
      };
    }
  };

  const handleImageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (previewViewer !== "image") {
      return;
    }

    if (event.touches.length === 2 && imagePinchRef.current) {
      const nextDistance = getTouchDistance(event.touches);
      if (nextDistance <= 0) {
        return;
      }
      event.preventDefault();
      suppressImageAdvanceRef.current = true;
      setCustomImageZoom(imagePinchRef.current.zoom * (nextDistance / imagePinchRef.current.distance));
      return;
    }

    const pan = imageScrollPanRef.current;
    const stageElement = imageStageRef.current;
    if (!imageHasCustomZoom || event.touches.length !== 1 || !pan || !stageElement) {
      return;
    }

    let touch: React.Touch | undefined;
    for (let index = 0; index < event.touches.length; index += 1) {
      const candidate = event.touches.item(index);
      if (candidate?.identifier === pan.touchId) {
        touch = candidate;
        break;
      }
    }
    if (!touch) {
      return;
    }

    event.preventDefault();
    suppressImageAdvanceRef.current = true;
    stageElement.scrollLeft = pan.scrollLeft - (touch.clientX - pan.clientX);
    stageElement.scrollTop = pan.scrollTop - (touch.clientY - pan.clientY);
  };

  const handleImageTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      imagePinchRef.current = undefined;
    }
    if (event.touches.length === 0) {
      imageScrollPanRef.current = undefined;
    }
  };

  const imageStyle: React.CSSProperties | undefined = imageHasCustomZoom
    ? {
      width: imageNaturalSize ? `${Math.round(imageNaturalSize.width * (imageZoomScale ?? 1))}px` : undefined,
      height: imageNaturalSize ? `${Math.round(imageNaturalSize.height * (imageZoomScale ?? 1))}px` : undefined
    }
    : props.imageFitMode === "fill"
      ? { objectPosition: `${imagePan.x}% ${imagePan.y}%` }
      : undefined;

  const handleMediaWaiting = () => {
    if (streamMediaSource && mediaStreamState !== "retrying" && mediaStreamState !== "failed") {
      setMediaStreamState("buffering");
    }
  };

  const handleMediaReady = () => {
    if (streamMediaSource) {
      setMediaStreamState("idle");
    }
  };

  const handleMediaPlaying = () => {
    handleMediaReady();
    setMediaAutoplayBlocked(false);
  };

  const startMediaPlayback = async () => {
    const media = previewViewer === "audio" ? audioPreviewRef.current : videoPreviewRef.current;
    if (!media) {
      return;
    }
    setMediaAutoplayBlocked(false);
    try {
      await media.play();
    } catch {
      setMediaAutoplayBlocked(true);
    }
  };

  const retryMediaStreamNow = () => {
    if (mediaRetryTimeoutRef.current !== undefined) {
      window.clearTimeout(mediaRetryTimeoutRef.current);
      mediaRetryTimeoutRef.current = undefined;
    }
    setMediaRetryAttempt(0);
    setMediaStreamState("buffering");
    setMediaRetryKey((current) => current + 1);
  };

  const handleMediaError = () => {
    if (!streamMediaSource) {
      return;
    }

    if (mediaRetryAttempt < MEDIA_STREAM_RETRY_DELAYS_MS.length) {
      const nextAttempt = mediaRetryAttempt + 1;
      setMediaRetryAttempt(nextAttempt);
      setMediaStreamState("retrying");
      if (mediaRetryTimeoutRef.current !== undefined) {
        window.clearTimeout(mediaRetryTimeoutRef.current);
      }
      mediaRetryTimeoutRef.current = window.setTimeout(() => {
        mediaRetryTimeoutRef.current = undefined;
        setMediaStreamState("buffering");
        setMediaRetryKey((current) => current + 1);
      }, MEDIA_STREAM_RETRY_DELAYS_MS[nextAttempt - 1]);
      return;
    }

    setMediaStreamState("failed");
  };

  const handleOpenOriginal = async () => {
    if (!previewPath || !props.token) {
      return;
    }

    // Open the tab synchronously on user activation to avoid pop-up blockers; we'll navigate it once the blob is ready.
    const popup = typeof window.open === "function" ? window.open("about:blank", "_blank") : null;

    setOpeningOriginal(true);
    setOriginalOpenError(undefined);
    try {
      const original = await fetchOriginalFile(previewPath, props.token);
      openBlobInNewTab(original.blob, popup);
    } catch (error) {
      setOriginalOpenError(error instanceof Error ? error.message : "Unable to open the original file in a new tab.");
      try {
        popup?.close();
      } catch {
        // ignore
      }
    } finally {
      setOpeningOriginal(false);
    }
  };

  const renderFallbackState = (title: string, message: string) => (
    <div className="empty-state preview-empty">
      <p className="empty empty-title">{title}</p>
      <p className="status">{message}</p>
      <div className="preview-stage-actions">
        {canOpenOriginal ? <button disabled={openingOriginal} onClick={() => void handleOpenOriginal()} type="button">{openingOriginal ? "Opening original…" : openOriginalLabel}</button> : null}
        {handleDownload ? <button onClick={handleDownload} type="button">Download file</button> : null}
      </div>
    </div>
  );

  const renderGalleryControls = (variant: "overlay" | "inline" = "overlay") => {
    if (!showGalleryControls) {
      return null;
    }

    const handlePrevious = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.onPrevious?.();
    };

    const handleNext = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.onNext?.();
    };

    return (
      <div className={`preview-gallery-controls${variant === "inline" ? " preview-gallery-controls-inline" : ""}`}>
        {props.onPrevious ? <button aria-label="Previous media item" className="preview-gallery-button preview-gallery-button-previous" onClick={handlePrevious} type="button">←</button> : null}
        {props.onNext ? <button aria-label="Next media item" className="preview-gallery-button preview-gallery-button-next" onClick={handleNext} type="button">→</button> : null}
      </div>
    );
  };

  return (
    <div className="modal-scrim preview-scrim" onClick={(event) => dismissOnScrimClick(event, props.onClose)} role="presentation">
      <section aria-label={`Preview ${fileName}`} aria-modal="true" className="preview-modal panel" role="dialog">
        <header className="preview-header">
          <div className="preview-header-context">
            <div className="preview-title-block">
              <div className="preview-title-row">
                <h2>{fileName}</h2>
                <span className="operation-pill preview-mode-pill">{previewMode}</span>
              </div>
              <div className="preview-context-row">
                <p className="status preview-path">{displayPath || "Opening file"}</p>
                {props.offline || props.workerUnavailable ? (
                  <span className="status preview-secondary-note">
                    {props.offline
                      ? "Cached previews stay available, but changes remain disabled until you reconnect."
                      : "Cached previews stay available, but changes remain disabled until the local server is reachable again."}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className={`preview-header-actions${previewViewer === "image" ? " preview-header-actions-image" : ""}`}>
            <details className="preview-details-disclosure">
              <summary aria-label="File details">Details</summary>
              <dl className="metadata preview-metadata">
                <div>
                  <dt>Kind</dt>
                  <dd>{previewKind}</dd>
                </div>
                <div>
                  <dt>Modified</dt>
                  <dd>{formatFileTimestamp(props.file?.lastModified ?? props.entry?.lastModified)}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(props.file?.size ?? props.entry?.size, props.fileSizeDisplayMode)}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{displayPath}</dd>
                </div>
              </dl>
            </details>
            {previewViewer === "image" ? (
              <>
                <button
                  aria-label={props.imageFitMode === "fill" && !imageHasCustomZoom ? "Fit entire image" : "Fill preview area"}
                  aria-pressed={props.imageFitMode === "fill" && !imageHasCustomZoom}
                  className="preview-fit-toggle"
                  onClick={() => handleImageFitModeChange(props.imageFitMode === "fill" && !imageHasCustomZoom ? "fit" : "fill")}
                  type="button"
                >
                  {props.imageFitMode === "fill" && !imageHasCustomZoom ? "Fit" : "Fill"}
                </button>
                <button
                  aria-label={`Show image at original size. Current zoom ${imageZoomLabel}`}
                  aria-pressed={imageZoomScale === 1}
                  className="preview-fit-toggle"
                  onClick={() => setCustomImageZoom(1)}
                  type="button"
                >
                  100%
                </button>
              </>
            ) : null}
            {showOpenOriginalAction ? (
              <button
                aria-label={openOriginalLabel}
                disabled={openingOriginal}
                onClick={() => void handleOpenOriginal()}
                type="button"
              >
                {openingOriginal ? "Opening..." : openOriginalVisibleLabel}
              </button>
            ) : null}
            {handleDownload ? <button onClick={handleDownload} type="button">Download</button> : null}
            <button aria-label="Back to files" className="quiet-button preview-dismiss-button" onClick={props.onClose} type="button">Back</button>
          </div>
        </header>

        <section className={`preview-stage ${immersivePreview ? "preview-stage-immersive" : ""}`}>
          <div className={`preview-stage-shell ${immersivePreview ? "preview-stage-shell-immersive" : ""}`}>
            {props.loading ? <div className="preview-transient-status"><StateBanner kind="loading" message="Opening file…" /></div> : null}
            {previewNotice ? (
              <div className="preview-cache-status">
                <StateBanner kind={previewNotice.kind} message={previewNotice.message} />
                {props.cacheState.updateReady && props.onApplyRefresh ? (
                  <div className="preview-stage-actions">
                    <button onClick={props.onApplyRefresh} type="button">Apply refreshed version</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {props.error ? <div className="preview-transient-status"><StateBanner kind={props.error instanceof ApiRequestError && (props.error.status === 401 || props.error.status === 403) ? "permission" : "error"} message={props.error.message} /></div> : null}
            {originalOpenError ? <div className="preview-transient-status"><StateBanner kind="error" message={originalOpenError} /></div> : null}
            {props.file?.truncated ? <p className="status preview-notice">Showing the first {props.file.bytesRead} bytes.</p> : null}
            {mediaStreamingNote ? <p className="status preview-notice">{mediaStreamingNote}</p> : null}
            {mediaAutoplayBlocked && isStreamingMediaViewer(previewViewer) ? (
              <div className="preview-transient-status">
                <StateBanner kind="permission" message="Autoplay was blocked by the browser. Use Play media to start playback." />
                <div className="preview-stage-actions">
                  <button onClick={() => void startMediaPlayback()} type="button">Play media</button>
                </div>
              </div>
            ) : null}
            {!mediaAutoplayBlocked && streamMediaSource && mediaStreamState === "buffering" ? <p className="status preview-notice">Buffering media stream…</p> : null}
            {!mediaAutoplayBlocked && streamMediaSource && mediaStreamState === "retrying" ? <p className="status preview-notice">Stream interrupted. Retrying playback shortly ({mediaRetryAttempt}/{MEDIA_STREAM_RETRY_DELAYS_MS.length}).</p> : null}
            {!mediaAutoplayBlocked && streamMediaSource && mediaStreamState === "failed" ? (
              <div className="preview-transient-status">
                <StateBanner kind="error" message="Media playback could not continue after several retries." />
                <div className="preview-stage-actions">
                  <button onClick={retryMediaStreamNow} type="button">Retry playback</button>
                </div>
              </div>
            ) : null}
            {props.file ? (
              <>
                {props.file.viewer === "markdown" ? <div className="preview-document"><MarkdownPreview content={props.file.content} /></div> : null}
                {props.file.viewer === "text" ? <pre className="preview-text">{props.file.content}</pre> : null}
                {props.file.viewer === "image" && props.blobUrl && !imagePreviewFailed ? (
                  <div
                    aria-label={imageStageAdvances ? `Open next photo after ${props.file.name}` : undefined}
                    className={`preview-media-stage preview-media-stage-image${imageHasCustomZoom ? " preview-media-stage-image-zoomed" : ""}${imageStageAdvances ? " preview-media-stage-clickable" : ""}`}
                    onClick={imageStageAdvances ? () => {
                      if (suppressImageAdvanceRef.current) {
                        suppressImageAdvanceRef.current = false;
                        return;
                      }
                      props.onNext?.();
                    } : undefined}
                    onKeyDown={imageStageAdvances ? (event) => {
                      if ((event.key === "Enter" || event.key === " ") && props.onNext) {
                        event.preventDefault();
                        props.onNext();
                      }
                    } : undefined}
                    onPointerCancel={handleImagePointerEnd}
                    onPointerDown={handleImagePointerDown}
                    onPointerMove={handleImagePointerMove}
                    onPointerUp={handleImagePointerEnd}
                    onTouchCancel={handleImageTouchEnd}
                    onTouchEnd={handleImageTouchEnd}
                    onTouchMove={handleImageTouchMove}
                    onTouchStart={handleImageTouchStart}
                    onWheel={handleImageWheel}
                    ref={imageStageRef}
                    role={imageStageAdvances ? "button" : undefined}
                    tabIndex={imageStageAdvances ? 0 : undefined}
                  >
                    {renderGalleryControls()}
                    <img
                      alt={props.file.name}
                      className={`media-preview media-preview-image media-preview-image-${imageHasCustomZoom ? "zoomed" : props.imageFitMode}`}
                      style={imageStyle}
                      onLoad={(event) => {
                        const { naturalWidth, naturalHeight } = event.currentTarget;
                        if (naturalWidth > 0 && naturalHeight > 0) {
                          setImageNaturalSize({ width: naturalWidth, height: naturalHeight });
                        }
                      }}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                        setImagePreviewFailed(true);
                      }}
                      src={props.blobUrl}
                    />
                  </div>
                ) : null}
                {props.file.viewer === "audio" && effectiveMediaSource ? (
                  <div className="preview-media-stage">
                    {renderGalleryControls("inline")}
                    <audio
                      autoPlay
                      className="media-preview media-preview-audio"
                      controls
                      key={effectiveMediaSource}
                      onCanPlay={handleMediaReady}
                      onError={handleMediaError}
                      onPlay={handleMediaPlaying}
                      onPlaying={handleMediaPlaying}
                      onWaiting={handleMediaWaiting}
                      ref={audioPreviewRef}
                      src={effectiveMediaSource}
                    />
                  </div>
                ) : null}
                {props.file.viewer === "video" && effectiveMediaSource ? (
                  <div className="preview-media-stage">
                    {renderGalleryControls("inline")}
                    <video
                      aria-label={`Video preview ${props.file.name}`}
                      autoPlay
                      className="media-preview media-preview-video"
                      controls
                      key={effectiveMediaSource}
                      muted
                      onCanPlay={handleMediaReady}
                      onError={handleMediaError}
                      onPlay={handleMediaPlaying}
                      onPlaying={handleMediaPlaying}
                      onWaiting={handleMediaWaiting}
                      playsInline
                      ref={videoPreviewRef}
                      src={effectiveMediaSource}
                    />
                  </div>
                ) : null}
                {props.file.viewer === "pdf" && props.blobUrl ? (
                  <div className="preview-media-stage preview-media-stage-pdf" title={`PDF preview ${props.file.name}`}>
                    {!pdfPreviewFailed ? (
                      <PdfCanvasPreview
                        blobUrl={props.blobUrl}
                        fileName={props.file.name}
                        onError={() => setPdfPreviewFailed(true)}
                      />
                    ) : renderFallbackState(
                      "PDF preview is unavailable right now",
                      props.file.unsupportedReason ?? "You can still open the original PDF in a new tab or download it."
                    )}
                  </div>
                ) : null}
                {(props.file.viewer === "unsupported" || imagePreviewUnavailable || (props.file.viewer === "pdf" && !props.blobUrl) || (requiresOriginalBlobViewer(props.file.viewer) && !props.blobUrl && !imagePreviewUnavailable))
                  ? renderFallbackState(
                    props.file.viewer === "pdf"
                      ? "PDF preview is unavailable right now"
                      : props.file.viewer === "image"
                        ? "Image preview is unavailable right now"
                        : "This file opens outside the preview pane",
                    props.file.unsupportedReason ?? (props.file.viewer === "pdf"
                      ? "You can still open the original PDF in a new tab or download it."
                      : props.file.viewer === "image"
                        ? "You can still open the original image in a new tab or download it."
                        : "You can still open the original file in a new tab or download it.")
                  )
                  : null}
              </>
            ) : !props.loading && !props.error ? (
              <div className="empty-state preview-empty">
                <p className="empty empty-title">Preview unavailable</p>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </div>
  );
}
export default function App() {
  const initialAccountState = loadStoredAccounts();
  const [accountState, setAccountState] = useState(initialAccountState);
  const [healthLoading, setHealthLoading] = useState(true);
  const [unlockRequired, setUnlockRequired] = useState(false);
  const [healthRootPath, setHealthRootPath] = useState(".davora-agent-test");
  const [bootstrapError, setBootstrapError] = useState<string | undefined>();
  const [unlockCode, setUnlockCode] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [items, setItems] = useState<FileEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | undefined>();
  const [downloadSelection, setDownloadSelection] = useState<FileEntry[]>([]);
  const [openedEntry, setOpenedEntry] = useState<FileEntry | undefined>();
  const [selected, setSelected] = useState<FilePreview | undefined>();
  const [selectedBlobUrl, setSelectedBlobUrl] = useState<string | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [mobileSheetDetailsExpanded, setMobileSheetDetailsExpanded] = useState(false);
  const [navigationDrawerOpen, setNavigationDrawerOpen] = useState(false);
  const navigationDrawerRef = useRef<HTMLElement & { inert?: boolean }>(null);
  const rowLongPressTimerRef = useRef<number | undefined>();
  const rowLongPressHandledRef = useRef(false);
  const [actionDialog, setActionDialog] = useState<ActionDialogState>();
  const [destinationPicker, setDestinationPicker] = useState<DestinationPickerState>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState(accountState.accounts.length > 0 ? "Restoring account state…" : "Connect an account to begin.");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [listError, setListError] = useState<ApiRequestError | Error | undefined>();
  const [previewError, setPreviewError] = useState<ApiRequestError | Error | undefined>();
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [refreshingFolder, setRefreshingFolder] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewCacheState, setPreviewCacheState] = useState<PreviewCacheState>(DEFAULT_PREVIEW_CACHE_STATE);
  const [pendingPreviewUpdate, setPendingPreviewUpdate] = useState<PendingPreviewUpdate | undefined>();
  const [mutationBusy, setMutationBusy] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [autoRestorePausedForAccountId, setAutoRestorePausedForAccountId] = useState<string | undefined>();
  const [accountBusy, setAccountBusy] = useState(false);
  const [staleFolder, setStaleFolder] = useState(false);
  const [workerUnavailable, setWorkerUnavailable] = useState(false);
  const [cacheSummary, setCacheSummary] = useState({ itemCount: 0, totalBytes: 0, limitBytes: DEFAULT_OPENED_FILE_CACHE_LIMIT });
  const [offlineEntries, setOfflineEntries] = useState<OpenedFileCacheEntry[]>([]);
  const [offlineSyncDialog, setOfflineSyncDialog] = useState<OfflineSyncDialogState | undefined>();
  const [offlineSyncBusy, setOfflineSyncBusy] = useState(false);
  const [uiSettings, setUiSettings] = useState(loadUiSettings);
  const [showZeroStateForm, setShowZeroStateForm] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [accountForm, setAccountForm] = useState<AccountFormState>(createEmptyAccountForm("add", ".davora-agent-test"));
  const [accountFormError, setAccountFormError] = useState<string | undefined>();
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [removeAccountTarget, setRemoveAccountTarget] = useState<ConnectedAccount | undefined>();
  const [removeAccountConfirmation, setRemoveAccountConfirmation] = useState("");
  const [removeAccountError, setRemoveAccountError] = useState<string | undefined>();
  const [folderDropActive, setFolderDropActive] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>([]);
  const pwaPrompt = usePwaPromptState();
  const folderRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const activeAccountIdRef = useRef<string | undefined>();
  const currentPathRef = useRef(currentPath);
  const openedEntryPathRef = useRef<string | undefined>();
  const previewOpenRef = useRef(previewOpen);
  const actionDialogOpenRef = useRef(false);
  const destinationPickerOpenRef = useRef(false);
  const accountDialogOpenRef = useRef(showAccountDialog);
  const removeAccountDialogOpenRef = useRef(false);
  const settingsDialogOpenRef = useRef(showSettingsDialog);
  const mobileSearchOpenRef = useRef(mobileSearchOpen);
  const navigationDrawerOpenRef = useRef(navigationDrawerOpen);
  const mobileDetailsOpenRef = useRef(mobileDetailsOpen);
  const transferOpenRef = useRef(transferOpen);
  const [pullToRefreshProgress, setPullToRefreshProgress] = useState(0);
  const pullStartYRef = useRef(0);
  const pullActiveRef = useRef(false);
  const fileListPanelRef = useRef<HTMLElement | null>(null);
  const [pullToRefreshVisible, setPullToRefreshVisible] = useState(false);
  const [pullToRefreshRefreshing, setPullToRefreshRefreshing] = useState(false);
  const accountEffectRan = useRef(false);
  const urlSyncRan = useRef(false);

  const activeRecord = accountState.accounts.find((record) => record.account.id === accountState.activeAccountId) ?? accountState.accounts[0];
  const activeAccount = activeRecord?.account;
  const token = activeRecord?.session?.token;
  const capabilities = activeRecord?.session?.capabilities;
  const backend = activeAccount?.backend;
  const cacheNamespace = activeAccount?.cacheNamespace;
  const fileSizeDisplayMode = uiSettings.fileSizeDisplayMode;
  const maxCacheableFileSizeBytes = uiSettings.maxCacheableFileSizeBytes;
  const imagePreviewFitMode = uiSettings.imagePreviewFitMode;
  const previewFreshnessIntervalSeconds = uiSettings.previewFreshnessIntervalSeconds;
  const cacheOnlyMode = offline || workerUnavailable;

  const addTransferTask = (task: Omit<TransferTask, "startedAt" | "loadedBytes"> & { loadedBytes?: number }) => {
    const now = new Date().toISOString();
    const record: TransferTask = {
      startedAt: now,
      loadedBytes: task.loadedBytes ?? 0,
      ...task
    };
    setTransferTasks((previous) => [record, ...previous].slice(0, 12));
    return record.id;
  };

  const updateTransferTask = (id: string, patch: Partial<TransferTask>) => {
    setTransferTasks((previous) => previous.map((task) => task.id === id ? { ...task, ...patch } : task));
  };

  const clearFinishedTransfers = () => {
    setTransferTasks((previous) => previous.filter((task) => task.phase !== "done" && task.phase !== "error"));
  };

  activeAccountIdRef.current = activeAccount?.id;
  currentPathRef.current = currentPath;
  openedEntryPathRef.current = openedEntry?.path;
  previewOpenRef.current = previewOpen;
  actionDialogOpenRef.current = Boolean(actionDialog);
  destinationPickerOpenRef.current = Boolean(destinationPicker);
  accountDialogOpenRef.current = showAccountDialog;
  removeAccountDialogOpenRef.current = Boolean(removeAccountTarget);
  settingsDialogOpenRef.current = showSettingsDialog;
  mobileSearchOpenRef.current = mobileSearchOpen;
  navigationDrawerOpenRef.current = navigationDrawerOpen;
  mobileDetailsOpenRef.current = mobileDetailsOpen;
  transferOpenRef.current = transferOpen;

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const updateViewport = (event?: MediaQueryListEvent) => setIsNarrowScreen(event ? event.matches : mediaQuery.matches);
    updateViewport();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    mediaQuery.addEventListener("change", updateViewport);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      mediaQuery.removeEventListener("change", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (navigationDrawerRef.current) {
      navigationDrawerRef.current.inert = !navigationDrawerOpen;
    }
  }, [navigationDrawerOpen]);

  const buildAppHistoryState = (path = currentPathRef.current, surface?: string) => ({
    davora: true,
    accountId: activeAccountIdRef.current,
    path,
    surface
  });

  const replaceAppHistoryState = (path = currentPathRef.current) => {
    window.history.replaceState(buildAppHistoryState(path), "");
  };

  const pushAppHistoryState = (path = currentPathRef.current, surface?: string) => {
    window.history.pushState(buildAppHistoryState(path, surface), "");
  };

  const pushCurrentSurfaceHistory = (surface: string) => {
    pushAppHistoryState(currentPathRef.current, surface);
  };

  const openTransferTray = () => {
    if (!transferOpenRef.current) {
      pushCurrentSurfaceHistory("transfers");
    }
    setTransferOpen(true);
  };

  const syncPathToUrl = (path: string, accountId?: string) => {
    const url = new URL(window.location.href);
    if (path) {
      url.searchParams.set("path", path);
      if (accountId) {
        url.searchParams.set("account", accountId);
      }
    } else {
      url.searchParams.delete("path");
      url.searchParams.delete("account");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const readPathFromUrl = (): { path: string; accountId?: string } => {
    const url = new URL(window.location.href);
    return {
      path: url.searchParams.get("path") ?? "",
      accountId: url.searchParams.get("account") ?? undefined
    };
  };

  const getFileListScrollTop = () => fileListPanelRef.current?.scrollTop ?? 0;

  const handlePullToRefreshStart = (event: React.TouchEvent) => {
    if (
      window.scrollY > 0 ||
      getFileListScrollTop() > 0 ||
      !currentPathRef.current ||
      !token ||
      previewOpenRef.current ||
      actionDialogOpenRef.current ||
      destinationPickerOpenRef.current ||
      accountDialogOpenRef.current ||
      removeAccountDialogOpenRef.current ||
      settingsDialogOpenRef.current ||
      mobileSearchOpenRef.current ||
      navigationDrawerOpenRef.current ||
      mobileDetailsOpenRef.current ||
      transferOpenRef.current
    ) {
      return;
    }
    pullStartYRef.current = event.touches[0].clientY;
    pullActiveRef.current = true;
  };

  const handlePullToRefreshMove = (event: React.TouchEvent) => {
    if (!pullActiveRef.current || window.scrollY > 0 || getFileListScrollTop() > 0) {
      return;
    }
    const diff = event.touches[0].clientY - pullStartYRef.current;
    if (diff > 0) {
      const progress = Math.min(diff / 120, 1);
      setPullToRefreshProgress(progress);
      setPullToRefreshVisible(progress > 0.1);
    }
  };

  const handlePullToRefreshEnd = () => {
    if (!pullActiveRef.current) {
      return;
    }
    pullActiveRef.current = false;
    if (pullToRefreshProgress >= 1) {
      setPullToRefreshProgress(1);
      setPullToRefreshRefreshing(true);
      setPullToRefreshVisible(true);
      void loadFolder(currentPathRef.current, { preferCache: false }).finally(() => {
        setPullToRefreshProgress(0);
        setPullToRefreshRefreshing(false);
        setPullToRefreshVisible(false);
      });
    } else {
      setPullToRefreshProgress(0);
      setPullToRefreshRefreshing(false);
      setPullToRefreshVisible(false);
    }
  };

  useEffect(() => {
    replaceAppHistoryState(currentPathRef.current);

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { davora?: boolean; path?: unknown } | null;
      const nextPath = state?.davora && typeof state.path === "string" ? state.path : currentPathRef.current;

      if (previewOpenRef.current) {
        closePreview();
      } else if (actionDialogOpenRef.current) {
        setActionDialog(undefined);
      } else if (destinationPickerOpenRef.current) {
        setDestinationPicker(undefined);
      } else if (accountDialogOpenRef.current) {
        setShowAccountDialog(false);
      } else if (removeAccountDialogOpenRef.current) {
        setRemoveAccountTarget(undefined);
      } else if (settingsDialogOpenRef.current) {
        setShowSettingsDialog(false);
      } else if (mobileSearchOpenRef.current) {
        setMobileSearchOpen(false);
      } else if (navigationDrawerOpenRef.current) {
        setNavigationDrawerOpen(false);
      } else if (mobileDetailsOpenRef.current) {
        setMobileDetailsOpen(false);
      } else if (transferOpenRef.current) {
        setTransferOpen(false);
      }

      if (state?.davora && nextPath !== currentPathRef.current) {
        setSelected(undefined);
        clearSelectedBlob();
        setSelectedEntry(undefined);
        setDownloadSelection([]);
        setMobileDetailsOpen(false);
        setNavigationDrawerOpen(false);
        setOpenedEntry(undefined);
        setCurrentPath(nextPath);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!urlSyncRan.current) {
      urlSyncRan.current = true;
      return;
    }
    syncPathToUrl(currentPath, activeAccount?.id);
  }, [currentPath, activeAccount?.id]);

  useEffect(() => {
    void (async () => {
      setHealthLoading(true);
      try {
        const health = await retryTransientBootstrap(() => getHealth());
        setUnlockRequired(health.unlockRequired);
        setHealthRootPath(health.rootPath);
        setWorkerUnavailable(false);
        setBootstrapError(getHealthConfigErrorMessage(health));
      } catch (error) {
        if (isTransientBootstrapError(error)) {
          setWorkerUnavailable(true);
        }
        setBootstrapError(getBootstrapErrorMessage(error, false));
      } finally {
        setHealthLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!cacheNamespace) {
      setCacheSummary({ itemCount: 0, totalBytes: 0, limitBytes: DEFAULT_OPENED_FILE_CACHE_LIMIT });
      setOfflineEntries([]);
      return;
    }
    void refreshCacheSummary();
  }, [cacheNamespace]);

  useEffect(() => {
    return () => {
      if (selectedBlobUrl) {
        URL.revokeObjectURL(selectedBlobUrl);
      }
    };
  }, [selectedBlobUrl]);

  useEffect(() => {
    closePreview();
    setSelected(undefined);
    clearSelectedBlob();
    setSelectedEntry(undefined);
    setDownloadSelection([]);
    setMobileDetailsOpen(false);

    if (!accountEffectRan.current) {
      accountEffectRan.current = true;
      const { path: urlPath } = readPathFromUrl();
      if (urlPath && activeAccount) {
        setCurrentPath(urlPath);
      } else {
        setCurrentPath("");
      }
    } else {
      setCurrentPath("");
      syncPathToUrl("", activeAccount?.id);
    }

    setSearchQuery("");
    setSearchResults([]);
    setListError(undefined);
    setLoadingFolder(false);
    setRefreshingFolder(false);
    setLoadingPreview(false);
    setPendingPreviewUpdate(undefined);
    setPreviewCacheState(DEFAULT_PREVIEW_CACHE_STATE);
    setStaleFolder(false);
    if (activeAccount) {
      setStatus(`Active account: ${activeAccountName}`);
    }
    setAutoRestorePausedForAccountId(undefined);
  }, [activeAccount?.id]);

  useEffect(() => {
    if (!canAttemptAutoRestore(activeAccount) || token || unlockRequired || healthLoading || sessionBusy || offline || autoRestorePausedForAccountId === activeAccount.id) {
      return;
    }
    void ensureSessionForAccount(activeAccount.id, undefined, "auto");
  }, [activeAccount, token, unlockRequired, healthLoading, sessionBusy, offline, autoRestorePausedForAccountId]);

  const clearSelectedBlob = () => {
    if (selectedBlobUrl) {
      URL.revokeObjectURL(selectedBlobUrl);
    }
    setSelectedBlobUrl(undefined);
  };

  const closePreview = () => {
    previewRequestIdRef.current += 1;
    openedEntryPathRef.current = undefined;
    setPreviewOpen(false);
    setOpenedEntry(undefined);
    setNavigationDrawerOpen(false);
    setPreviewError(undefined);
    setLoadingPreview(false);
    setPendingPreviewUpdate(undefined);
    setPreviewCacheState(DEFAULT_PREVIEW_CACHE_STATE);
  };

  const isCurrentFolderRequest = (requestId: number, accountId: string, path: string) => {
    return folderRequestIdRef.current === requestId && activeAccountIdRef.current === accountId && currentPathRef.current === path;
  };

  const isCurrentPreviewRequest = (requestId: number, accountId: string, path: string) => {
    return previewRequestIdRef.current === requestId && activeAccountIdRef.current === accountId && openedEntryPathRef.current === path;
  };

  const applyPreviewContent = (file: FilePreview, blob?: Blob, streamUrl?: string) => {
    clearSelectedBlob();
    setSelected(file);
    if (blob) {
      setSelectedBlobUrl(URL.createObjectURL(blob));
    } else if (streamUrl) {
      setSelectedBlobUrl(streamUrl);
    }
  };

  const applyPendingPreviewRefresh = () => {
    if (!pendingPreviewUpdate || !activeAccount) {
      return;
    }

    applyPreviewContent(pendingPreviewUpdate.file, pendingPreviewUpdate.blob);
    setPreviewError(undefined);
    setPendingPreviewUpdate(undefined);
    setPreviewCacheState({
      source: "live",
      refreshing: false,
      stale: false,
      updateReady: false
    });
    setStatus(`Applied refreshed preview for ${toDisplayPath(pendingPreviewUpdate.file.path)} in ${activeAccountName}`);
  };

  const refreshAccountState = () => setAccountState(loadStoredAccounts());

  async function refreshCacheSummary() {
    if (!cacheNamespace) {
      setCacheSummary({ itemCount: 0, totalBytes: 0, limitBytes: DEFAULT_OPENED_FILE_CACHE_LIMIT });
      setOfflineEntries([]);
      return;
    }
    const [summary, entries] = await Promise.all([
      getOpenedFileCacheSummary(cacheNamespace),
      listOfflineFileCacheEntries(cacheNamespace)
    ]);
    setCacheSummary(summary);
    setOfflineEntries(entries);
  }

  function resetActiveSession(message: string, reconnectRequired = false) {
    if (!activeAccount) {
      return;
    }
    folderRequestIdRef.current += 1;
    previewRequestIdRef.current += 1;
    if (reconnectRequired) {
      setAccountState(markStoredAccountReconnectRequired(activeAccount.id));
    } else {
      setAccountState(clearStoredAccountSession(activeAccount.id));
    }
    clearSelectedBlob();
    setSelected(undefined);
    setSelectedEntry(undefined);
    setDownloadSelection([]);
    setMobileDetailsOpen(false);
    setOpenedEntry(undefined);
    setPreviewOpen(false);
    setPreviewError(undefined);
    setPendingPreviewUpdate(undefined);
    setPreviewCacheState(DEFAULT_PREVIEW_CACHE_STATE);
    setLoadingFolder(false);
    setRefreshingFolder(false);
    setLoadingPreview(false);
    setListError(undefined);
    setBootstrapError(message);
    setStatus(message);
  }

  async function ensureSessionForAccount(accountId: string, candidateUnlockCode?: string, source: "auto" | "manual" = "manual") {
    setSessionBusy(true);
    setBootstrapError(undefined);
    setAutoRestorePausedForAccountId(undefined);
    try {
      const session = await retryTransientBootstrap(() => createSession(candidateUnlockCode ? { accountId, unlockCode: candidateUnlockCode } : { accountId }));
      refreshAccountState();
      setWorkerUnavailable(false);
      setStatus(`Restored workspace access for ${session.account.displayName}`);
      setBootstrapError(undefined);
      setAutoRestorePausedForAccountId(undefined);
      return session;
    } catch (error) {
      if (isTransientBootstrapError(error)) {
        setWorkerUnavailable(true);
      }
      if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
        setAccountState(markStoredAccountReconnectRequired(accountId));
      } else if (error instanceof ApiRequestError && error.status === 401) {
        setAccountState(clearStoredAccountSession(accountId));
      }
      if (source === "auto") {
        setAutoRestorePausedForAccountId(accountId);
      }
      setBootstrapError(getBootstrapErrorMessage(error, Boolean(candidateUnlockCode)));
      setStatus(candidateUnlockCode ? "Unlock failed" : "Workspace restore paused");
      return undefined;
    } finally {
      setSessionBusy(false);
    }
  }

  async function submitUnlockCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeAccount) {
      return;
    }
    const candidate = unlockCode.trim();
    if (!candidate) {
      setBootstrapError("Enter the deployment unlock code to create a session.");
      return;
    }
    await ensureSessionForAccount(activeAccount.id, candidate, "manual");
  }

  async function submitAccountForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBaseUrl = accountForm.baseUrl.trim();
    const trimmedUsername = accountForm.username.trim();
    const trimmedPassword = accountForm.appPassword.trim();
    if (!trimmedBaseUrl || !trimmedUsername || !trimmedPassword) {
      setAccountFormError("Base URL, username, and app password are required.");
      return;
    }

    setAccountBusy(true);
    setAccountFormError(undefined);
    try {
      const trimmedRootPath = accountForm.rootPath.trim();
      const result = await connectAccount({
        type: "nextcloud",
        accountId: accountForm.accountId,
        cacheNamespace: accountForm.cacheNamespace,
        baseUrl: trimmedBaseUrl,
        username: trimmedUsername,
        appPassword: trimmedPassword,
        ...(trimmedRootPath ? { rootPath: trimmedRootPath } : {}),
        ...(accountForm.label.trim() ? { label: accountForm.label.trim() } : {})
      });
      refreshAccountState();
      setAccountForm(createEmptyAccountForm("add", healthRootPath));
      setShowAccountDialog(false);
      setShowZeroStateForm(false);
      setStatus(`Connected account ${result.account.displayName}`);
      if (!unlockRequired) {
        await ensureSessionForAccount(result.account.id);
      }
    } catch (error) {
      setAccountFormError(error instanceof Error ? error.message : "Unable to connect account.");
    } finally {
      setAccountBusy(false);
    }
  }

  function openAddAccountDialog() {
    setAccountForm(createEmptyAccountForm("add", healthRootPath));
    setAccountFormError(undefined);
    pushCurrentSurfaceHistory("account");
    setShowAccountDialog(true);
  }

  function openReconnectDialog(record: StoredAccountRecord) {
    setAccountForm(buildReconnectForm(record));
    setAccountFormError(undefined);
    pushCurrentSurfaceHistory("account");
    setShowAccountDialog(true);
  }

  function openSettingsDialog() {
    pushCurrentSurfaceHistory("settings");
    setShowSettingsDialog(true);
  }

  function handleActiveAccountChange(accountId: string) {
    saveActiveAccount(accountId);
    setAccountState(loadStoredAccounts());
  }

  function handleFileSizeDisplayModeChange(mode: FileSizeDisplayMode) {
    const nextSettings = saveUiSettings({ ...DEFAULT_UI_SETTINGS, ...uiSettings, fileSizeDisplayMode: mode });
    setUiSettings(nextSettings);
    setStatus(`File sizes now use ${getFileSizeDisplayModeLabel(mode)}.`);
  }

  function handleMaxCacheableFileSizeChange(limitBytes: number) {
    const nextSettings = saveUiSettings({ ...DEFAULT_UI_SETTINGS, ...uiSettings, maxCacheableFileSizeBytes: limitBytes });
    setUiSettings(nextSettings);
    setStatus(`Files up to ${formatBytes(nextSettings.maxCacheableFileSizeBytes, fileSizeDisplayMode)} stay eligible for browser blob caching.`);
  }

  function handleImagePreviewFitModeChange(mode: "fill" | "fit") {
    const nextSettings = saveUiSettings({ ...DEFAULT_UI_SETTINGS, ...uiSettings, imagePreviewFitMode: mode });
    setUiSettings(nextSettings);
  }

  function handlePreviewFreshnessIntervalChange(intervalSeconds: number) {
    const nextSettings = saveUiSettings({ ...DEFAULT_UI_SETTINGS, ...uiSettings, previewFreshnessIntervalSeconds: intervalSeconds });
    setUiSettings(nextSettings);
    setStatus(`Cached previews will be checked after ${nextSettings.previewFreshnessIntervalSeconds} seconds.`);
  }

  function handleShowHiddenFilesChange(show: boolean) {
    const nextSettings = saveUiSettings({ ...DEFAULT_UI_SETTINGS, ...uiSettings, showHiddenFiles: show });
    setUiSettings(nextSettings);
    setStatus(show ? "Hidden files and folders are now visible." : "Hidden files and folders are now hidden.");
  }

  function handleExperimentalHeicPreviewEnabledChange(enabled: boolean) {
    const nextSettings = saveUiSettings({ ...DEFAULT_UI_SETTINGS, ...uiSettings, experimentalHeicPreviewEnabled: enabled });
    setUiSettings(nextSettings);
    setStatus(enabled ? "Experimental HEIC preview is enabled for this browser." : "Experimental HEIC preview is disabled.");
  }

  function handleSortModeChange(mode: SortMode) {
    const nextSettings = saveUiSettings({ ...DEFAULT_UI_SETTINGS, ...uiSettings, sortMode: mode });
    setUiSettings(nextSettings);
    setStatus(`Sorted by ${SORT_MODE_LABELS[mode]}.`);
  }

  async function prefetchUpcomingMedia(startIndex: number) {
    if (!token || !cacheNamespace || !activeAccount || cacheOnlyMode || startIndex < 0) {
      return;
    }

    const upcomingItems = mediaItems.slice(startIndex + 1, startIndex + 1 + PREVIEW_PREFETCH_AHEAD_COUNT);
    await Promise.all(upcomingItems.map(async (item) => {
      try {
        const cached = await getCachedOpenedFile(cacheNamespace, item.path);
        if (canUseCachedPreview(cached, { token, experimentalHeicPreviewEnabled: uiSettings.experimentalHeicPreviewEnabled })) {
          return;
        }

        const payload = await loadPreviewPayload(item.path, token, { experimentalHeicPreviewEnabled: uiSettings.experimentalHeicPreviewEnabled });
        if (!isMediaGalleryViewer(payload.file.viewer)) {
          return;
        }

        await cacheOpenedFile(cacheNamespace, {
          path: item.path,
          preview: payload.file,
          blob: payload.blob,
          mimeType: payload.mimeType,
          filename: payload.filename,
          maxBlobBytes: maxCacheableFileSizeBytes
        });
      } catch {
        // best-effort prefetch only
      }
    }));
    await refreshCacheSummary();
  }

  function openAdjacentMedia(offset: -1 | 1) {
    const target = offset < 0 ? previousMediaItem : nextMediaItem;
    if (!target) {
      return;
    }
    void openFile(target);
  }

  async function handleCacheLimitChange(limitBytes: number) {
    if (!cacheNamespace) {
      return;
    }
    await configureOpenedFileCache(cacheNamespace, limitBytes);
    await refreshCacheSummary();
    setStatus(activeAccount ? `Opened-file cache limit set to ${formatBytes(limitBytes, fileSizeDisplayMode)} for ${activeAccountName}.` : `Opened-file cache limit set to ${formatBytes(limitBytes, fileSizeDisplayMode)}.`);
  }

  function openAddAccountFromSettings() {
    setShowSettingsDialog(false);
    openAddAccountDialog();
  }

  function openReconnectFromSettings() {
    if (!activeRecord) {
      return;
    }
    setShowSettingsDialog(false);
    openReconnectDialog(activeRecord);
  }

  function openRemoveFromSettings() {
    if (!activeAccount) {
      return;
    }
    setShowSettingsDialog(false);
    pushCurrentSurfaceHistory("remove-account");
    setRemoveAccountTarget(activeAccount);
    setRemoveAccountConfirmation("");
    setRemoveAccountError(undefined);
  }

  async function confirmRemoveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!removeAccountTarget) {
      return;
    }
    if (removeAccountConfirmation.trim() !== removeAccountTarget.displayName) {
      setRemoveAccountError("Type the active account label exactly to remove it.");
      return;
    }

    setAccountBusy(true);
    setRemoveAccountError(undefined);
    try {
      await clearOpenedFileCache(removeAccountTarget.cacheNamespace);
      clearFolderAndSearchCache(removeAccountTarget.cacheNamespace);
      await deleteConnectedAccount(removeAccountTarget.id);
      setAccountState(loadStoredAccounts());
      setRemoveAccountTarget(undefined);
      setRemoveAccountConfirmation("");
      setStatus(`Removed account ${removeAccountTarget.displayName}`);
    } catch (error) {
      removeAccountFromStorage(removeAccountTarget.id);
      setAccountState(loadStoredAccounts());
      setStatus(`Removed account ${removeAccountTarget.displayName} from browser state.`);
      setRemoveAccountTarget(undefined);
      setRemoveAccountConfirmation("");
      setRemoveAccountError(error instanceof Error ? error.message : undefined);
    } finally {
      setAccountBusy(false);
    }
  }

  const navigateToPath = (path: string) => {
    pushAppHistoryState(path);
    closePreview();
    setSelected(undefined);
    clearSelectedBlob();
    setSelectedEntry(undefined);
    setDownloadSelection([]);
    setMobileDetailsOpen(false);
    setNavigationDrawerOpen(false);
    setOpenedEntry(undefined);
    setCurrentPath(path);
  };

  const loadFolder = async (path: string, options: { preferCache?: boolean } = {}) => {
    if ((!token && !cacheOnlyMode) || !cacheNamespace || !activeAccount) {
      return;
    }

    const requestId = ++folderRequestIdRef.current;
    const requestAccountId = activeAccount.id;
    const preferCache = options.preferCache ?? true;
    const cachedEnvelope = preferCache ? readFolderCacheEnvelope<FileEntry[]>(cacheNamespace, path) : undefined;
    const cachedItems = Array.isArray(cachedEnvelope?.value) ? cachedEnvelope.value : undefined;
    const hasCachedItems = cachedItems !== undefined;
    const displayPath = toDisplayPath(path);

    const applyCachedFolderState = () => {
      if (!isCurrentFolderRequest(requestId, requestAccountId, path)) {
        return false;
      }
      setItems(cachedItems ?? []);
      setStaleFolder(true);
      setLoadingFolder(false);
      setRefreshingFolder(!cacheOnlyMode);
      setListError(undefined);
        setStatus(
        offline
          ? `Offline snapshot for ${displayPath} in ${activeAccountName}`
          : workerUnavailable
            ? `Cached snapshot for ${displayPath} in ${activeAccountName} while the local server is unavailable.`
            : `Showing cached folder for ${displayPath} in ${activeAccountName} while checking for changes.`
      );
      return true;
    };

    const applyLiveFolderState = (nextItems: FileEntry[], message: string) => {
      if (!isCurrentFolderRequest(requestId, requestAccountId, path)) {
        return false;
      }
      setItems(nextItems);
      cacheFolder(cacheNamespace, path, nextItems);
      setStaleFolder(false);
      setLoadingFolder(false);
      setRefreshingFolder(false);
      setListError(undefined);
      setStatus(message);
      return true;
    };

    const handleFolderFailure = (error: unknown) => {
      if (!isCurrentFolderRequest(requestId, requestAccountId, path)) {
        return;
      }
      if (isUnauthorized(error)) {
        resetActiveSession("Session expired. Create a fresh session for this account.");
        return;
      }
      if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
        resetActiveSession("This account needs to be reconnected before browsing files.", true);
        return;
      }

      if (hasCachedItems) {
        setItems(cachedItems ?? []);
        setStaleFolder(true);
        setLoadingFolder(false);
        setRefreshingFolder(false);
        setListError(undefined);
        if (isTransientBootstrapError(error)) {
          setWorkerUnavailable(true);
        }
        setStatus(`Still showing cached folder for ${displayPath} in ${activeAccountName} because live refresh failed.`);
        return;
      }

      setItems([]);
      setStaleFolder(false);
      setLoadingFolder(false);
      setRefreshingFolder(false);
      if (isTransientBootstrapError(error)) {
        setWorkerUnavailable(true);
      }
      setListError(error instanceof Error ? error : new Error("Unable to load folder."));
    };

    setListError(undefined);

    if (hasCachedItems) {
      applyCachedFolderState();
      if (cacheOnlyMode) {
        return;
      }

      void (async () => {
        try {
          if (!token) {
            return;
          }
          const response = await listFiles(path, token);
          const nextItems = Array.isArray(response.items) ? response.items : [];
          applyLiveFolderState(nextItems, `Refreshed ${displayPath} in ${activeAccountName}`);
        } catch (error) {
          handleFolderFailure(error);
        }
      })();
      return;
    }

    setItems([]);
    setStaleFolder(false);
    setLoadingFolder(true);
    setRefreshingFolder(false);

    if (cacheOnlyMode) {
      setLoadingFolder(false);
      setListError(new Error(offline ? "Offline and no cached snapshot is available for this folder yet." : "The local server is unavailable and no cached snapshot is available for this folder yet."));
      setStatus(offline
        ? `Offline and no cached folder is available for ${displayPath} in ${activeAccountName}`
        : `Local server unavailable and no cached folder is available for ${displayPath} in ${activeAccountName}`);
      return;
    }

    try {
      if (!token) {
        return;
      }
      const response = await listFiles(path, token);
      const nextItems = Array.isArray(response.items) ? response.items : [];
      setWorkerUnavailable(false);
      applyLiveFolderState(nextItems, `Viewing ${displayPath} in ${activeAccountName}`);
    } catch (error) {
      handleFolderFailure(error);
    }
  };

  useEffect(() => {
    if ((!token && !cacheOnlyMode) || !activeAccount) {
      setItems([]);
      return;
    }
    void loadFolder(currentPath);
  }, [currentPath, token, cacheOnlyMode, activeAccount?.id]);

  useEffect(() => {
    if (!destinationPicker || !token || cacheOnlyMode) {
      return;
    }

    let cancelled = false;
    const folderPath = destinationPicker.folderPath;

    setDestinationPicker((previous) => previous
      ? { ...previous, loading: true, error: undefined }
      : previous);

    listFiles(folderPath, token)
      .then((response) => {
        if (cancelled) {
          return;
        }
        const nextEntries = Array.isArray(response.items) ? response.items : [];
        setDestinationPicker((previous) => previous && previous.folderPath === folderPath
          ? {
              ...previous,
              entries: nextEntries,
              name: !previous.nameEdited && selectedEntry && (previous.kind === "copy" || previous.kind === "copyMove")
                ? suggestDestinationName(nextEntries, selectedEntry.name, selectedEntry, "copy")
                : previous.name,
              manualPath: !previous.manualMode && !previous.nameEdited && selectedEntry && (previous.kind === "copy" || previous.kind === "copyMove")
                ? joinPath(previous.folderPath, suggestDestinationName(nextEntries, selectedEntry.name, selectedEntry, "copy"))
                : previous.manualPath,
              loading: false,
              error: undefined
            }
          : previous);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (isUnauthorized(error)) {
          resetActiveSession("Session expired. Create a fresh session for this account.");
          setDestinationPicker(undefined);
          return;
        }
        if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
          resetActiveSession("This account needs to be reconnected before choosing a destination.", true);
          setDestinationPicker(undefined);
          return;
        }
        setDestinationPicker((previous) => previous && previous.folderPath === folderPath
          ? { ...previous, entries: [], loading: false, error: error instanceof Error ? error.message : "Unable to load destination folder." }
          : previous);
      });

    return () => {
      cancelled = true;
    };
  }, [destinationPicker?.folderPath, destinationPicker?.reloadKey, token, cacheOnlyMode, selectedEntry?.name, selectedEntry?.path]);

  useEffect(() => {
    if (!token || !searchQuery.trim() || !cacheNamespace || !activeAccount) {
      setSearchResults([]);
      return;
    }

    searchFiles(currentPath, searchQuery, token)
      .then((response) => {
        const nextItems = Array.isArray(response.items) ? response.items : [];
        setSearchResults(nextItems);
        cacheSearch(cacheNamespace, currentPath, searchQuery, nextItems);
      })
      .catch((error) => {
        if (isUnauthorized(error)) {
          resetActiveSession("Session expired. Create a fresh session for this account.");
          return;
        }
        if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
          resetActiveSession("This account needs to be reconnected before searching.", true);
          return;
        }
        setSearchResults(readSearchCache<SearchResult[]>(cacheNamespace, currentPath, searchQuery) ?? []);
      });
  }, [currentPath, searchQuery, token, cacheNamespace, activeAccount?.id]);

  const toggleEntrySelection = (entry: FileEntry) => {
    const sameEntry = selectedEntry?.path === entry.path;
    if (sameEntry) {
      if (isNarrowScreen && !mobileDetailsOpen) {
        pushCurrentSurfaceHistory("mobile-details");
        setMobileDetailsOpen(true);
        return;
      }
      setSelectedEntry(undefined);
      setMobileDetailsOpen(false);
      setMobileSheetDetailsExpanded(false);
      return;
    }
    setSelectedEntry(entry);
    setMobileSheetDetailsExpanded(false);
    if (isNarrowScreen) {
      pushCurrentSurfaceHistory("mobile-details");
    }
    setMobileDetailsOpen(isNarrowScreen);
  };

  const toggleDownloadSelection = (entry: FileEntry) => {
    setDownloadSelection((previous) => {
      const exists = previous.some((item) => item.path === entry.path);
      const next = exists ? previous.filter((item) => item.path !== entry.path) : [...previous, entry];
      if (selectedEntry?.path === entry.path) {
        if (exists) {
          setSelectedEntry(undefined);
          setMobileDetailsOpen(false);
          setMobileSheetDetailsExpanded(false);
        }
        return next;
      }
      if (!exists) {
        setSelectedEntry(entry);
        setMobileDetailsOpen(false);
      }
      return next;
    });
  };

  const clearDownloadSelection = () => {
    setDownloadSelection([]);
    if (selectedEntry && !selected) {
      setSelectedEntry(undefined);
      setMobileDetailsOpen(false);
    }
  };

  const clearRowLongPressTimer = () => {
    if (rowLongPressTimerRef.current) {
      window.clearTimeout(rowLongPressTimerRef.current);
      rowLongPressTimerRef.current = undefined;
    }
  };

  const startRowLongPressSelection = (entry: FileEntry) => {
    if (!isNarrowScreen || !canMarkForBatchDownload) {
      return;
    }
    clearRowLongPressTimer();
    rowLongPressHandledRef.current = false;
    rowLongPressTimerRef.current = window.setTimeout(() => {
      rowLongPressHandledRef.current = true;
      toggleDownloadSelection(entry);
    }, 450);
  };

  const startDownloadWithTransfer = async (path: string, displayPath: string) => {
    if (!activeAccount || !token) {
      setListError(new Error("No session available for this action."));
      return;
    }
    if (cacheOnlyMode) {
      setListError(new Error(offline
        ? "Offline downloads are disabled. Reconnect to download files."
        : "Downloads are disabled while the local server is unavailable. Restore the server and retry."));
      return;
    }

    const transferId = crypto.randomUUID();
    addTransferTask({
      id: transferId,
      kind: "download",
      label: displayPath,
      phase: "queued",
      totalBytes: undefined
    });

    try {
      updateTransferTask(transferId, { phase: "transferring" });
      await downloadFile(path, token, {
        onProgress: (loadedBytes, totalBytes) => updateTransferTask(transferId, { loadedBytes, totalBytes, phase: "transferring" })
      });
      updateTransferTask(transferId, { phase: "done", finishedAt: new Date().toISOString() });
    } catch (error) {
      if (isUnauthorized(error)) {
        resetActiveSession("Session expired. Create a fresh session for this account.");
        return;
      }
      if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
        resetActiveSession("This account needs to be reconnected before downloading files.", true);
        return;
      }
      updateTransferTask(transferId, { phase: "error", finishedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : "Unable to download file." });
      setListError(error instanceof Error ? error : new Error("Unable to download file."));
    }
  };

  const startBatchDownloadWithTransfer = async (entries: FileEntry[]) => {
    if (entries.length === 1 && !entries[0]?.isFolder) {
      await startDownloadWithTransfer(entries[0].path, toDisplayPath(entries[0].path));
      return;
    }
    if (!activeAccount || !token) {
      setListError(new Error("No session available for this action."));
      return;
    }
    if (cacheOnlyMode) {
      setListError(new Error(offline
        ? "Offline downloads are disabled. Reconnect to download files."
        : "Downloads are disabled while the local server is unavailable. Restore the server and retry."));
      return;
    }

    const transferId = crypto.randomUUID();
    const reportedFailures: BatchDownloadPlan["failedFiles"] = [];
    addTransferTask({
      id: transferId,
      kind: "download",
      label: `${buildDownloadSelectionLabel(entries.filter((entry) => !entry.isFolder).length, entries.filter((entry) => entry.isFolder).length)} selected`,
      phase: "queued",
      totalBytes: undefined
    });

    try {
      updateTransferTask(transferId, { phase: "preparing" });
      const { blob, plan } = await downloadSelectionAsZip({
        entries,
        currentPath,
        searchActive,
        listFiles: (path) => listFiles(path, token),
        fetchFile: (path, callbacks) => fetchDownloadBlob(path, token, callbacks),
        onPlanReady: (plan) => {
          updateTransferTask(transferId, {
            label: plan.archiveName,
            phase: "transferring",
            loadedBytes: 0,
            totalBytes: plan.totalBytes
          });
          setStatus(buildBatchDownloadReadyMessage(plan, activeAccountName));
        },
        onFileProgress: (loadedBytes, totalBytes) => {
          updateTransferTask(transferId, {
            phase: "transferring",
            loadedBytes,
            totalBytes
          });
        },
        onArchiveProgress: () => {
          updateTransferTask(transferId, {
            phase: "preparing",
            loadedBytes: 0,
            totalBytes: undefined
          });
        },
        onFileFailed: (failure) => {
          reportedFailures.push(failure);
          updateTransferTask(transferId, {
            phase: "transferring",
            errorMessage: `${failure.sourcePath}: ${failure.error}`,
            failedFiles: [...reportedFailures]
          });
        }
      });

      triggerBrowserDownload(blob, plan.archiveName);
      const hasFailures = plan.failedFiles.length > 0;
      const partialSummary = hasFailures ? `${buildBatchDownloadPartialSummary(plan)}.` : undefined;
      updateTransferTask(transferId, {
        label: plan.archiveName,
        phase: hasFailures ? "partial" : "done",
        finishedAt: new Date().toISOString(),
        errorMessage: partialSummary,
        failedFiles: hasFailures ? plan.failedFiles : undefined
      });
      setStatus(buildBatchDownloadSuccessMessage(plan, activeAccountName));
      if (hasFailures) {
        setListError(new Error(`${partialSummary} Failed: ${plan.failedFiles.map((f) => `${f.sourcePath}: ${f.error}`).join("; ")}`));
      }
    } catch (error) {
      if (isUnauthorized(error)) {
        resetActiveSession("Session expired. Create a fresh session for this account.");
        return;
      }
      if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
        resetActiveSession("This account needs to be reconnected before downloading files.", true);
        return;
      }
      updateTransferTask(transferId, { phase: "error", finishedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : "Unable to prepare download." });
      setListError(error instanceof Error ? error : new Error("Unable to prepare download."));
    }
  };

  const openOfflineSyncDialog = async (entries: FileEntry[]) => {
    if (!activeAccount || !token) {
      setListError(new Error("No session available for offline sync."));
      return;
    }
    if (cacheOnlyMode) {
      setListError(new Error(offline
        ? "Reconnect before adding new offline sync items."
        : "Restore the local server before adding new offline sync items."));
      return;
    }
    const selectedEntries = entries.length > 0 ? entries : selectedEntry ? [selectedEntry] : [];
    if (selectedEntries.length === 0) {
      return;
    }

    setMobileDetailsOpen(false);
    setMobileSheetDetailsExpanded(false);
    setOfflineSyncDialog({ entries: selectedEntries, phase: "estimating" });
    try {
      const plan = await buildBatchDownloadPlan({
        entries: selectedEntries,
        currentPath,
        searchActive,
        listFiles: async (path) => {
          const response = await listFiles(path, token);
          if (cacheNamespace) {
            cacheFolder(cacheNamespace, path, response.items);
          }
          return response;
        }
      });
      setOfflineSyncDialog({ entries: selectedEntries, phase: plan.totalBytes === undefined ? "unknown" : "ready", plan });
    } catch (error) {
      setOfflineSyncDialog({
        entries: selectedEntries,
        phase: "unknown",
        error: error instanceof Error ? error.message : "Unable to estimate storage before sync."
      });
    }
  };

  const confirmOfflineSync = async () => {
    if (!offlineSyncDialog || !activeAccount || !token || !cacheNamespace) {
      return;
    }
    const selectedEntries = offlineSyncDialog.entries;
    const rootKind: "file" | "folder" | "batch" = selectedEntries.length > 1 ? "batch" : selectedEntries[0]?.isFolder ? "folder" : "file";
    const rootPath = selectedEntries.length === 1 ? selectedEntries[0]?.path ?? "" : `batch:${selectedEntries.map((entry) => entry.path).sort().join("|")}`;
    const rootName = selectedEntries.length === 1 ? selectedEntries[0]?.name ?? "Offline item" : `${pluralize(selectedEntries.length, "item")} offline batch`;
    const dedupeKey = `sync:${rootPath}`;
    const existingSync = transferTasks.find((task) => task.kind === "sync" && task.dedupeKey === dedupeKey && task.phase !== "done" && task.phase !== "partial" && task.phase !== "error");
    if (existingSync) {
      setOfflineSyncDialog(undefined);
      setOfflineSyncBusy(false);
      openTransferTray();
      setStatus(`Offline sync is already running for ${rootName}.`);
      return;
    }

    const transferId = crypto.randomUUID();
    const failures: BatchDownloadPlan["failedFiles"] = [];
    setOfflineSyncBusy(true);
    addTransferTask({
      id: transferId,
      kind: "sync",
      label: rootName,
      phase: "queued",
      totalBytes: offlineSyncDialog.plan?.totalBytes,
      syncRootEntries: selectedEntries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        isFolder: entry.isFolder
      })),
      dedupeKey
    });
    setOfflineSyncDialog(undefined);
    setOfflineSyncBusy(false);
    openTransferTray();
    setStatus(`Started offline sync for ${rootName} in ${activeAccountName}. You can keep browsing while it runs.`);

    void (async () => {
      try {
      updateTransferTask(transferId, { phase: "preparing", loadedBytes: 0, totalBytes: offlineSyncDialog.plan?.totalBytes });
      const plan = offlineSyncDialog.plan ?? await buildBatchDownloadPlan({
        entries: selectedEntries,
        currentPath,
        searchActive,
        listFiles: async (path) => {
          const response = await listFiles(path, token);
          cacheFolder(cacheNamespace, path, response.items);
          return response;
        }
      });
      let completedBytes = 0;
      updateTransferTask(transferId, { phase: "transferring", loadedBytes: 0, totalBytes: plan.totalBytes });

      for (const file of plan.files) {
        try {
          const response = await fetchDownloadBlob(file.sourcePath, token, {
            onProgress: (loadedBytes) => {
              updateTransferTask(transferId, {
                phase: "transferring",
                loadedBytes: completedBytes + loadedBytes,
                totalBytes: plan.totalBytes
              });
            }
          });
          const preview = createCachedPreviewFromBlob(file.sourcePath, response.blob, response.filename ?? basename(file.sourcePath), file.size);
          if ((preview.viewer === "text" || preview.viewer === "markdown") && typeof response.blob.text === "function") {
            preview.content = await response.blob.text();
            preview.bytesRead = preview.content.length;
          }
          await cacheOpenedFile(cacheNamespace, {
            path: file.sourcePath,
            preview,
            blob: response.blob,
            mimeType: response.blob.type || "application/octet-stream",
            filename: response.filename ?? basename(file.sourcePath),
            maxBlobBytes: Number.POSITIVE_INFINITY,
            keepOffline: true,
            keepOfflineRoot: rootPath,
            keepOfflineRootName: rootName,
            keepOfflineRootKind: rootKind
          });
          completedBytes += file.size ?? response.blob.size;
          updateTransferTask(transferId, { phase: "transferring", loadedBytes: completedBytes, totalBytes: plan.totalBytes });
        } catch (error) {
          failures.push({
            sourcePath: file.sourcePath,
            error: error instanceof Error ? error.message : "Unable to sync this file."
          });
          updateTransferTask(transferId, {
            phase: "transferring",
            errorMessage: `${file.sourcePath}: ${failures[failures.length - 1]?.error}`,
            failedFiles: [...failures]
          });
        }
      }

      await refreshCacheSummary();
      setOfflineSyncDialog(undefined);
      setDownloadSelection([]);
      const hasFailures = failures.length > 0;
      updateTransferTask(transferId, {
        phase: hasFailures ? "partial" : "done",
        loadedBytes: completedBytes,
        totalBytes: plan.totalBytes,
        finishedAt: new Date().toISOString(),
        errorMessage: hasFailures ? `${failures.length} file${failures.length === 1 ? "" : "s"} failed to sync.` : undefined,
        failedFiles: hasFailures ? failures : undefined
      });
      setStatus(hasFailures
        ? `Synced ${plan.files.length - failures.length} of ${plan.files.length} files for offline use in ${activeAccountName}.`
        : `Kept ${rootName} offline on this device for ${activeAccountName}.`);
      } catch (error) {
        updateTransferTask(transferId, { phase: "error", finishedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : "Unable to sync offline." });
        setListError(error instanceof Error ? error : new Error("Unable to sync offline."));
      }
    })();
  };

  const removeOfflineCopy = async (root: OfflineSyncRootSummary) => {
    if (!cacheNamespace) {
      return;
    }
    await removeOfflineRoot(cacheNamespace, root.rootPath);
    if (root.kind === "folder") {
      clearFolderCacheForPath(cacheNamespace, root.rootPath);
    } else if (root.kind === "batch") {
      clearFolderAndSearchCache(cacheNamespace);
    }
    await refreshCacheSummary();
    setStatus(`Removed offline copy for ${root.name} from this device. Server files were not deleted.`);
  };

  const retryFailedOfflineSync = (task: TransferTask) => {
    const retryEntries = task.syncRootEntries?.length
      ? task.syncRootEntries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        isFolder: entry.isFolder
      } satisfies FileEntry))
      : task.failedFiles?.map((failure) => ({
      path: failure.sourcePath,
      name: basename(failure.sourcePath),
      isFolder: false
    } satisfies FileEntry)) ?? [];
    if (retryEntries.length > 0) {
      void openOfflineSyncDialog(retryEntries);
    }
  };

  const downloadUnsupportedFile = async (path: string, displayPath: string, activeAccountName: string) => {
    closePreview();
    setSelected(undefined);
    clearSelectedBlob();
    if (cacheOnlyMode) {
      setListError(new Error(offline
        ? "This file type downloads instead of previewing. Reconnect to download it."
        : "This file type downloads instead of previewing. Restore the local server to download it."));
      setStatus(offline
        ? `Reconnect to download ${displayPath} in ${activeAccountName}. Unsupported files open by download instead of preview.`
        : `Restore the local server to download ${displayPath} in ${activeAccountName}. Unsupported files open by download instead of preview.`);
      return;
    }

    setListError(undefined);
    setStatus(`Starting browser download for ${displayPath} from ${activeAccountName} because this file type opens outside preview.`);
    await startDownloadWithTransfer(path, displayPath);
  };

  const openFile = async (entry: FileEntry) => {
    if ((!token && !cacheOnlyMode) || !cacheNamespace || !activeAccount) {
      return;
    }

    const displayPath = toDisplayPath(entry.path);
    if (getViewerKind(entry.mimeType) === "unsupported" && !isHeicLikeFile(entry)) {
      if (token) {
        await downloadUnsupportedFile(entry.path, displayPath, activeAccount.displayName);
      } else {
        setPreviewError(new Error(offline
          ? "Offline and no cached inline preview is available for this file type yet."
          : "The local server is unavailable and no cached inline preview is available for this file type yet."));
      }
      return;
    }

    const requestId = ++previewRequestIdRef.current;
    const requestAccountId = activeAccount.id;

    const applyCachedPreviewState = async (cached: Awaited<ReturnType<typeof getCachedOpenedFile>>) => {
      if (!cached || !isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
        return false;
      }
      const streamUrl = !cached.blob && token && isStreamingMediaViewer(cached.entry.preview.viewer)
        ? await createStreamingFileUrl(cached.entry.preview.path, token)
        : undefined;
      if (!isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
        return false;
      }
      applyPreviewContent(
        cached.entry.preview,
        cached.blob,
        streamUrl
      );
      setLoadingPreview(false);
      setPreviewError(undefined);
      const freshEnough = !cacheOnlyMode && isCachedPreviewFreshEnough(cached.entry.cachedAt, previewFreshnessIntervalSeconds);
      setPreviewCacheState({
        source: "cache",
        cachedAt: cached.entry.cachedAt,
        refreshing: !cacheOnlyMode && !freshEnough,
        stale: !freshEnough,
        updateReady: false
      });
      setStatus(
        offline
          ? `Showing cached preview for ${displayPath} in ${activeAccountName}`
          : workerUnavailable
            ? `Showing cached preview for ${displayPath} in ${activeAccountName} while the local server is unavailable.`
            : `Showing cached preview for ${displayPath} in ${activeAccountName} while checking for changes.`
      );
      return true;
    };

    const applyLivePreviewState = (payload: PreviewPayload, message: string) => {
      if (!isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
        return false;
      }
      applyPreviewContent(payload.file, payload.blob, payload.streamUrl);
      setLoadingPreview(false);
      setPreviewError(undefined);
      setPreviewCacheState({
        source: "live",
        refreshing: false,
        stale: false,
        updateReady: false
      });
      setPendingPreviewUpdate(undefined);
      setStatus(message);
      return true;
    };

    const cacheLivePreviewPayload = async (payload: PreviewPayload) => {
      if (isStreamingMediaViewer(payload.file.viewer) && payload.streamUrl) {
        if (!token || payload.file.size === undefined || payload.file.size > maxCacheableFileSizeBytes) {
          return;
        }
        const original = await fetchOriginalFile(payload.file.path, token);
        await cacheOpenedFile(cacheNamespace, {
          path: entry.path,
          preview: payload.file,
          blob: original.blob,
          mimeType: original.mimeType,
          filename: original.filename,
          maxBlobBytes: maxCacheableFileSizeBytes
        });
        await refreshCacheSummary();
        if (isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
          setStatus(`Streaming ${displayPath} in ${activeAccountName}; offline cache copy is ready.`);
        }
        return;
      }

      await cacheOpenedFile(cacheNamespace, {
        path: entry.path,
        preview: payload.file,
        blob: payload.blob,
        mimeType: payload.mimeType,
        filename: payload.filename,
        maxBlobBytes: maxCacheableFileSizeBytes
      });
      await refreshCacheSummary();
    };

    const handlePreviewFailure = async (error: unknown, cached: Awaited<ReturnType<typeof getCachedOpenedFile>>) => {
      if (!isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
        return;
      }
      if (isUnauthorized(error)) {
        resetActiveSession("Session expired. Create a fresh session for this account.");
        return;
      }
      if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
        resetActiveSession("This account needs to be reconnected before opening files.", true);
        return;
      }

      if (cached) {
        await applyCachedPreviewState(cached);
        setPreviewCacheState({
          source: "cache",
          cachedAt: cached.entry.cachedAt,
          refreshing: false,
          stale: true,
          updateReady: false
        });
        if (isTransientBootstrapError(error)) {
          setWorkerUnavailable(true);
        }
        setStatus(`Still showing cached preview for ${displayPath} in ${activeAccountName} because live refresh failed.`);
        return;
      }

      setLoadingPreview(false);
      if (isTransientBootstrapError(error)) {
        setWorkerUnavailable(true);
      }
      setPreviewError(error instanceof Error ? error : new Error("Unable to open file."));
    };

    openedEntryPathRef.current = entry.path;
    pushCurrentSurfaceHistory("preview");
    setOpenedEntry(entry);
    setPreviewOpen(true);
    setPreviewError(undefined);
    setMobileDetailsOpen(false);
    setPendingPreviewUpdate(undefined);
    setPreviewCacheState(DEFAULT_PREVIEW_CACHE_STATE);
    setSelected(undefined);
    clearSelectedBlob();

    const cached = await getCachedOpenedFile(cacheNamespace, entry.path);
    const usableCachedPreview = canUseCachedPreview(cached, { token, experimentalHeicPreviewEnabled: uiSettings.experimentalHeicPreviewEnabled }) ? cached : undefined;
    if (!isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
      return;
    }

    if (usableCachedPreview) {
      if (usableCachedPreview.entry.preview.viewer === "unsupported") {
        if (token) {
          await downloadUnsupportedFile(entry.path, displayPath, activeAccount.displayName);
        } else {
          setLoadingPreview(false);
          setPreviewError(new Error(offline
            ? "Offline and no cached inline preview is available for this file type yet."
            : "The local server is unavailable and no cached inline preview is available for this file type yet."));
        }
        return;
      }
      await applyCachedPreviewState(usableCachedPreview);
      if (isMediaGalleryViewer(usableCachedPreview.entry.preview.viewer)) {
        void prefetchUpcomingMedia(mediaItems.findIndex((item) => item.path === entry.path));
      }
      if (cacheOnlyMode) {
        return;
      }

      if (isCachedPreviewFreshEnough(usableCachedPreview.entry.cachedAt, previewFreshnessIntervalSeconds)) {
        void prefetchUpcomingMedia(mediaItems.findIndex((item) => item.path === entry.path));
        return;
      }

      void (async () => {
        try {
          if (!token) {
            return;
          }
          const livePreview = await loadPreviewPayload(entry.path, token, { experimentalHeicPreviewEnabled: uiSettings.experimentalHeicPreviewEnabled });
          if (livePreview.file.viewer === "unsupported") {
            if (shouldShowUnsupportedPreview(livePreview.file)) {
              setWorkerUnavailable(false);
              applyLivePreviewState(livePreview, `Preview unavailable for ${displayPath} in ${activeAccountName}; original file actions are still available.`);
              return;
            }
            await downloadUnsupportedFile(entry.path, displayPath, activeAccount.displayName);
            return;
          }
          if (isStreamingMediaViewer(livePreview.file.viewer)) {
            setWorkerUnavailable(false);
            applyLivePreviewState(
              livePreview,
              livePreview.file.size !== undefined && livePreview.file.size <= maxCacheableFileSizeBytes
                ? `Streaming ${displayPath} in ${activeAccountName}; saving an offline cache copy in the background.`
                : `Streaming ${displayPath} in ${activeAccountName} without full-file caching because it is above the cacheable size limit.`
            );
            void cacheLivePreviewPayload(livePreview).catch((error) => {
              if (isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
                setStatus(`Streaming ${displayPath} in ${activeAccountName}; offline cache copy could not be saved.`);
              }
              console.warn(error);
            });
            return;
          }

          await cacheLivePreviewPayload(livePreview);
          setWorkerUnavailable(false);

          if (!isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
            return;
          }

          const cachedFingerprint = buildCachedPreviewFingerprint(usableCachedPreview.entry, usableCachedPreview.blob);
          if (livePreview.fingerprint !== cachedFingerprint) {
            setPendingPreviewUpdate({ file: livePreview.file, blob: livePreview.blob });
            setPreviewCacheState({
              source: "cache",
              cachedAt: usableCachedPreview.entry.cachedAt,
              refreshing: false,
              stale: true,
              updateReady: true
            });
            setStatus(`A refreshed preview is ready for ${displayPath} in ${activeAccountName}`);
            void prefetchUpcomingMedia(mediaItems.findIndex((item) => item.path === entry.path));
            return;
          }

          setPreviewCacheState({
            source: "live",
            refreshing: false,
            stale: false,
            updateReady: false
          });
          setStatus(`Confirmed current preview for ${displayPath} in ${activeAccountName}`);
          void prefetchUpcomingMedia(mediaItems.findIndex((item) => item.path === entry.path));
        } catch (error) {
          await handlePreviewFailure(error, usableCachedPreview);
        }
      })();
      return;
    }

    setLoadingPreview(true);
    setStatus(`Opening ${displayPath} in ${activeAccountName}`);

    if (cacheOnlyMode) {
      setLoadingPreview(false);
      setPreviewError(new Error(offline
        ? "Offline and no cached preview is available for this file yet."
        : "The local server is unavailable and no cached preview is available for this file yet."));
      return;
    }

    if (!token) {
      setLoadingPreview(false);
      setPreviewError(new Error("A live session is required before opening this file online."));
      return;
    }

    try {
      const livePreview = await loadPreviewPayload(entry.path, token, { experimentalHeicPreviewEnabled: uiSettings.experimentalHeicPreviewEnabled });
      if (livePreview.file.viewer === "unsupported") {
        if (shouldShowUnsupportedPreview(livePreview.file)) {
          setWorkerUnavailable(false);
          applyLivePreviewState(livePreview, `Preview unavailable for ${displayPath} in ${activeAccountName}; original file actions are still available.`);
          return;
        }
        await downloadUnsupportedFile(entry.path, displayPath, activeAccount.displayName);
        return;
      }
      setWorkerUnavailable(false);
      if (isStreamingMediaViewer(livePreview.file.viewer)) {
        applyLivePreviewState(
          livePreview,
          livePreview.file.size !== undefined && livePreview.file.size <= maxCacheableFileSizeBytes
            ? `Streaming ${displayPath} in ${activeAccountName}; saving an offline cache copy in the background.`
            : `Streaming ${displayPath} in ${activeAccountName} without full-file caching because it is above the cacheable size limit.`
        );
        void cacheLivePreviewPayload(livePreview).catch((error) => {
          if (isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
            setStatus(`Streaming ${displayPath} in ${activeAccountName}; offline cache copy could not be saved.`);
          }
          console.warn(error);
        });
      } else {
        await cacheLivePreviewPayload(livePreview);
        applyLivePreviewState(livePreview, `Opened ${displayPath} in ${activeAccountName}`);
      }
      void prefetchUpcomingMedia(mediaItems.findIndex((item) => item.path === entry.path));
    } catch (error) {
      await handlePreviewFailure(error, usableCachedPreview);
    }
  };

  const selectMutationEntry = (entry: FileEntry) => {
    setSelectedEntry(entry);
    setMobileSheetDetailsExpanded(false);
    if (isNarrowScreen) {
      if (!mobileDetailsOpenRef.current) {
        pushCurrentSurfaceHistory("mobile-details");
      }
      setMobileDetailsOpen(true);
    }
  };

  const syncSelectionWithMutation = (result: MutationResult) => {
    if (result.action === "delete") {
      setDownloadSelection((previous) => previous.filter((entry) => entry.path !== result.path && !entry.path.startsWith(`${result.path}/`)));
      setSelected(undefined);
      clearSelectedBlob();
      closePreview();
      setSelectedEntry(undefined);
      setMobileDetailsOpen(false);
      return;
    }

    if (!selectedEntry || !result.destinationPath) {
      if (result.item) {
        selectMutationEntry(result.item);
      }
      if (result.item) {
        setDownloadSelection((previous) => previous.map((entry) => entry.path === result.path ? result.item! : entry));
      }
      return;
    }

    if ((result.action === "move" || result.action === "copy") && result.path === selectedEntry.path) {
      const nextName = result.destinationPath.split("/").pop() ?? selectedEntry.name;
      const nextEntry = {
        ...selectedEntry,
        path: result.destinationPath,
        name: nextName
      };
      selectMutationEntry(nextEntry);
      setDownloadSelection((previous) => previous.map((entry) => entry.path === result.path ? nextEntry : entry));
      if (selected && selected.path === result.path) {
        setSelected({
          ...selected,
          path: result.destinationPath,
          name: nextName
        });
      }
    }
  };

  const executeMutation = async (
    runner: () => Promise<MutationResult>,
    options: {
      refreshFolder?: boolean;
      successStatus?: string | false;
      syncSelection?: boolean;
      manageBusy?: boolean;
    } = {}
  ) => {
    if (!token || !activeAccount) {
      throw new Error("No session available for this action.");
    }
    if (cacheOnlyMode) {
      throw new Error(offline
        ? "Offline mutations are disabled. Reconnect to modify files."
        : "Mutations are disabled while the local server is unavailable. Restore the server and retry.");
    }

    if (options.manageBusy ?? true) {
      setMutationBusy(true);
    }
    setListError(undefined);
    try {
      const result = await runner();
      if (options.syncSelection ?? true) {
        syncSelectionWithMutation(result);
      }
      if (options.refreshFolder ?? true) {
        if (result.parentPath !== currentPath) {
          setCurrentPath(result.parentPath);
        } else {
          await loadFolder(result.parentPath, { preferCache: false });
        }
      }
      if (options.successStatus !== false) {
        setStatus(options.successStatus ?? `${result.action} completed for ${toDisplayPath(result.destinationPath ?? result.path)} in ${activeAccountName}`);
      }
      return result;
    } catch (error) {
      if (isUnauthorized(error)) {
        resetActiveSession("Session expired. Create a fresh session for this account.");
      }
      if (error instanceof ApiRequestError && error.code === "account_reconnect_required") {
        resetActiveSession("This account needs to be reconnected before completing mutations.", true);
      }
      throw error instanceof Error ? error : new Error("Mutation failed.");
    } finally {
      if (options.manageBusy ?? true) {
        setMutationBusy(false);
      }
    }
  };

  const handleCreateFolder = () => {
    setNavigationDrawerOpen(false);
    setActionError(undefined);
    pushCurrentSurfaceHistory("action");
    setActionDialog({ kind: "createFolder", value: "New folder" });
  };

  const handleUpload = async (files: FileList | File[] | null, source: "picker" | "drop" = "picker") => {
    if (!files || files.length === 0 || !token) {
      return;
    }

    const selectedFiles = Array.from(files);
    let uploadPlan;

    try {
      uploadPlan = buildUploadSelectionPlan(currentPath, selectedFiles);
    } catch (error) {
      setListError(error instanceof Error ? error : new Error("Upload failed."));
      return;
    }

    const transferIds = new Map(uploadPlan.files.map((plannedFile) => [
      plannedFile.destinationPath,
      addTransferTask({
        id: crypto.randomUUID(),
        kind: "upload",
        label: plannedFile.transferLabel,
        phase: "queued",
        loadedBytes: 0,
        totalBytes: plannedFile.file.size
      })
    ]));
    const shouldSyncUploadedSelection = uploadPlan.files.length === 1;
    let completedFiles = 0;
    let createdFolderCount = 0;

    try {
      setMutationBusy(true);
      for (const folderPath of uploadPlan.foldersToCreate) {
        try {
          await executeMutation(
            () => createFolder({ path: dirname(folderPath), name: basename(folderPath) }, token).then((response) => response.result),
            { refreshFolder: false, successStatus: false, syncSelection: false, manageBusy: false }
          );
          createdFolderCount += 1;
        } catch (error) {
          if (!isFolderAlreadyExistsError(error)) {
            throw error;
          }
        }
      }

      for (const plannedFile of uploadPlan.files) {
        const transferId = transferIds.get(plannedFile.destinationPath);
        if (!transferId) {
          continue;
        }

        try {
          updateTransferTask(transferId, { phase: "preparing", loadedBytes: 0, totalBytes: plannedFile.file.size });
          const contentBase64 = await readFileAsBase64WithProgress(plannedFile.file, (loadedBytes, totalBytes) => {
            updateTransferTask(transferId, { loadedBytes, totalBytes, phase: "preparing" });
          });

          updateTransferTask(transferId, { phase: "transferring", loadedBytes: 0, totalBytes: undefined });
          await executeMutation(() => uploadFileWithProgress(
            {
              path: plannedFile.destinationParentPath,
              name: plannedFile.file.name,
              mimeType: plannedFile.file.type || "application/octet-stream",
              contentBase64
            },
            token,
            (loadedBytes, totalBytes) => updateTransferTask(transferId, { loadedBytes, totalBytes, phase: "transferring" })
          ).then((response) => response.result), { refreshFolder: false, successStatus: false, syncSelection: shouldSyncUploadedSelection, manageBusy: false });
          completedFiles += 1;
          updateTransferTask(transferId, { phase: "done", finishedAt: new Date().toISOString() });
        } catch (error) {
          updateTransferTask(transferId, { phase: "error", finishedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : "Upload failed." });
          throw error;
        }
      }

      await loadFolder(currentPath, { preferCache: false });
      setStatus(buildUploadSuccessMessage(uploadPlan.files.length, uploadPlan.directoryRoots.length, currentLocationLabel, source));
    } catch (error) {
      if (completedFiles > 0 || createdFolderCount > 0) {
        await loadFolder(currentPath, { preferCache: false }).catch(() => undefined);
      }
      if (!isUnauthorized(error)) {
        if (completedFiles > 0) {
          setStatus(buildUploadPartialFailureMessage(completedFiles, uploadPlan.files.length, currentLocationLabel));
        }
        setListError(error instanceof Error ? error : new Error("Upload failed."));
      }
    } finally {
      setMutationBusy(false);
    }
  };

  const handleMove = () => {
    if (!selectedEntry) {
      return;
    }
    setMobileDetailsOpen(false);
    setActionError(undefined);
    pushCurrentSurfaceHistory("action");
    const initialFolder = dirname(selectedEntry.path);
    setDestinationPicker({
      kind: "move",
      folderPath: initialFolder,
      name: selectedEntry.name,
      nameEdited: false,
      manualPath: selectedEntry.path,
      manualMode: false,
      entries: [],
      loading: true,
      reloadKey: 0
    });
  };

  const handleCopyMove = () => {
    if (!selectedEntry) {
      return;
    }
    setMobileDetailsOpen(false);
    setActionError(undefined);
    pushCurrentSurfaceHistory("action");
    const initialFolder = dirname(selectedEntry.path);
    setDestinationPicker({
      kind: "copyMove",
      folderPath: initialFolder,
      name: selectedEntry.name,
      nameEdited: false,
      manualPath: selectedEntry.path,
      manualMode: false,
      entries: [],
      loading: true,
      reloadKey: 0
    });
  };

  const handleDelete = () => {
    if (!selectedEntry) {
      return;
    }
    setMobileDetailsOpen(false);
    setActionError(undefined);
    pushCurrentSurfaceHistory("action");
    setActionDialog({ kind: "delete" });
  };

  const submitActionDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !actionDialog) {
      return;
    }

    const trimmedValue = actionDialog.kind === "createFolder" ? actionDialog.value.trim() : "";
    if (actionDialog.kind === "createFolder" && !trimmedValue) {
      setActionError("Provide a value before continuing.");
      return;
    }

    setActionError(undefined);

    try {
      switch (actionDialog.kind) {
        case "createFolder":
          await executeMutation(() => createFolder({ path: currentPath, name: trimmedValue }, token).then((response) => response.result));
          break;
        case "delete":
          if (!selectedEntry) {
            return;
          }
          await executeMutation(() => deleteFile({ path: selectedEntry.path, confirmName: selectedEntry.name }, token).then((response) => response.result));
          break;
      }
      setActionDialog(undefined);
    } catch (error) {
      if (!isUnauthorized(error)) {
        if (actionDialog.kind === "delete" && error instanceof Error && /Delete confirmation does not match/i.test(error.message)) {
          setActionError("Name to confirm does not match the selected item.");
        } else {
          setActionError(error instanceof Error ? error.message : "Unable to complete this action.");
        }
      }
    }
  };

  const updateDestinationPickerFolder = (folderPath: string) => {
    setActionError(undefined);
    setDestinationPicker((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        folderPath,
        name: previous.nameEdited ? previous.name : selectedEntry?.name ?? previous.name,
        manualPath: previous.manualMode ? previous.manualPath : joinPath(folderPath, previous.nameEdited ? previous.name : selectedEntry?.name ?? previous.name),
        entries: [],
        loading: true,
        reloadKey: previous.reloadKey + 1,
        error: undefined
      };
    });
  };

  const updateDestinationPickerName = (name: string) => {
    setActionError(undefined);
    setDestinationPicker((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        name,
        nameEdited: true,
        manualPath: previous.manualMode ? previous.manualPath : joinPath(previous.folderPath, name)
      };
    });
  };

  const updateDestinationPickerManualMode = (manualMode: boolean) => {
    setActionError(undefined);
    setDestinationPicker((previous) => previous
      ? {
          ...previous,
          manualMode,
          manualPath: manualMode ? joinPath(previous.folderPath, previous.name) : joinPath(previous.folderPath, previous.name)
        }
      : previous);
  };

  const updateDestinationPickerManualPath = (manualPath: string) => {
    setActionError(undefined);
    setDestinationPicker((previous) => previous ? { ...previous, manualPath } : previous);
  };

  const reloadDestinationPickerFolder = () => {
    setActionError(undefined);
    setDestinationPicker((previous) => previous
      ? { ...previous, entries: [], loading: true, error: undefined, reloadKey: previous.reloadKey + 1 }
      : previous);
  };

  const getDestinationPickerValidation = (operation: DestinationOperation = destinationPicker?.kind === "move" ? "move" : "copy") => {
    if (!destinationPicker || !selectedEntry) {
      return { destinationPath: "", message: "No selected item." };
    }

    const destinationPath = destinationPicker.manualMode
      ? destinationPicker.manualPath.trim()
      : joinPath(destinationPicker.folderPath, destinationPicker.name);

    if (!destinationPicker.manualMode && destinationPicker.name.includes("/")) {
      return { destinationPath, message: "Destination name cannot contain slashes. Use Manual path for a full destination path." };
    }

    let destinationName: string;
    let destinationParentPath: string;
    try {
      destinationName = destinationPicker.manualMode ? basename(destinationPath) : destinationPicker.name.trim();
      destinationParentPath = dirname(destinationPath);
    } catch {
      return {
        destinationPath,
        message: destinationPicker.manualMode
          ? "Enter a valid destination path."
          : "Enter a valid destination name."
      };
    }

    if (!destinationPath || !destinationName) {
      return { destinationPath, message: "Choose a destination name before continuing." };
    }
    if (destinationPath === selectedEntry.path) {
      return {
        destinationPath,
        message: operation === "copy"
          ? `Destination already contains ${destinationName}. Use ${suggestDestinationName(destinationPicker.entries, destinationName, selectedEntry, "copy")} or choose a different folder.`
          : "Choose a different destination folder or name."
      };
    }
    if (selectedEntry.isFolder && isSameOrDescendantPath(destinationParentPath, selectedEntry.path)) {
      return { destinationPath, message: "Folders cannot be moved or copied into themselves or their descendants." };
    }
    if (!destinationPicker.manualMode && destinationNameExists(destinationPicker.entries, destinationName, selectedEntry, operation)) {
      const suggestedName = operation === "copy" ? suggestDestinationName(destinationPicker.entries, destinationName, selectedEntry, "copy") : undefined;
      return {
        destinationPath,
        message: suggestedName
          ? `Destination already contains ${destinationName}. Use ${suggestedName} or choose a different folder.`
          : `Destination already contains ${destinationName}. Choose a different name or folder.`
      };
    }

    return { destinationPath, message: undefined };
  };

  const submitDestinationPicker = async (operation: DestinationOperation, event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!token || !destinationPicker || !selectedEntry) {
      return;
    }

    const { destinationPath, message } = getDestinationPickerValidation(operation);
    if (message) {
      setActionError(message);
      return;
    }

    setActionError(undefined);
    try {
      if (operation === "move") {
        await executeMutation(() => moveFile({ path: selectedEntry.path, destinationPath }, token).then((response) => response.result));
      } else {
        await executeMutation(() => copyFile({ path: selectedEntry.path, destinationPath }, token).then((response) => response.result));
      }
      setDestinationPicker(undefined);
    } catch (error) {
      if (!isUnauthorized(error)) {
        setActionError(error instanceof Error ? error.message : "Unable to complete this action.");
      }
    }
  };

  const handleClearCache = async () => {
    if (!cacheNamespace) {
      return;
    }
    await clearOpenedFileCache(cacheNamespace);
    clearFolderAndSearchCache(cacheNamespace, { preserveFolderPaths: collectOfflineFolderCachePaths(offlineEntries) });
    setSelected(undefined);
    clearSelectedBlob();
    setSelectedEntry(undefined);
    setDownloadSelection([]);
    setMobileDetailsOpen(false);
    closePreview();
    await refreshCacheSummary();
    setStatus(activeAccount ? `Offline cache cleared for ${activeAccountName}.` : "Offline cache cleared.");
  };

  const searchActive = Boolean(searchQuery.trim());
  const visibleItems = useMemo(() => {
    const showHidden = uiSettings.showHiddenFiles;
    const sortMode = uiSettings.sortMode;
    if (searchActive) {
      return (searchResults ?? []).filter((item) => showHidden || !isHiddenEntry(item));
    }

    return sortAndGroupEntries(
      (items ?? []).filter((item) => showHidden || !isHiddenEntry(item)),
      sortMode
    );
  }, [items, searchActive, searchResults, uiSettings.showHiddenFiles, uiSettings.sortMode]);
  const downloadSelectionCount = downloadSelection.length;
  const downloadSelectionFileCount = downloadSelection.filter((item) => !item.isFolder).length;
  const downloadSelectionDirectoryCount = downloadSelection.filter((item) => item.isFolder).length;
  const downloadSelectionLabel = buildDownloadSelectionLabel(downloadSelectionFileCount, downloadSelectionDirectoryCount);
  const folderBanner = classifyState(listError, cacheOnlyMode, staleFolder, refreshingFolder, offline);
  const showRoutineCachedRefresh = refreshingFolder && staleFolder && !cacheOnlyMode && !listError;
  const folderInlineBanner = loadingFolder
    ? { kind: "loading" as const, message: "Loading folder..." }
    : folderBanner.kind === "stale" && showRoutineCachedRefresh
      ? { kind: "idle" as const, message: "" }
      : folderBanner;
  const folderEnvelope = cacheNamespace ? readFolderCacheEnvelope<FileEntry[]>(cacheNamespace, currentPath) : undefined;
  const hasEverCachedFolder = Boolean(folderEnvelope);
  const staleInfo = folderEnvelope ? `Cached ${formatCacheTimestamp(folderEnvelope.cachedAt)}` : undefined;
  const selectedPreview = selectedEntry && selected && selectedEntry.path === selected.path ? selected : undefined;
  const selectedDetails = selectedPreview ?? selectedEntry;
  const showDetailsRail = Boolean(selectedDetails || downloadSelectionCount > 0);
  const selectedFilePath = selectedDetails && !selectedDetails.isFolder ? selectedDetails.path : undefined;
  const selectedTypeLabel = selectedDetails
    ? selectedDetails.isFolder
      ? "Folder"
      : selectedPreview?.viewer
        ? viewerHeading(selectedPreview.viewer).replace(" preview", "")
        : normalizeMimeType(selectedDetails.mimeType) ?? "File"
    : undefined;
  const showMobileSelectionSheet = isNarrowScreen && Boolean(selectedDetails && mobileDetailsOpen);
  const detailsPanelLabel = selectedDetails ? `Details for ${selectedDetails.name}` : downloadSelectionCount > 0 ? `Batch download details for ${downloadSelectionCount} items` : "Workspace details";
  const closeMobileSelectionSheet = () => {
    setSelectedEntry(undefined);
    setMobileDetailsOpen(false);
    setMobileSheetDetailsExpanded(false);
  };
  const currentFolderLabel = currentPath ? currentPath.split("/").pop() ?? currentPath : "Home";
  const currentLocationLabel = toDisplayPath(currentPath);
  const currentBreadcrumbs = breadcrumbs(currentPath);
  const showBreadcrumbs = currentPath !== "";
  const itemCountLabel = `${visibleItems.length} ${visibleItems.length === 1 ? "item" : "items"}`;
  const resultCountLabel = `${visibleItems.length} ${visibleItems.length === 1 ? "result" : "results"}`;
  const browseStatusLabel = searchActive ? `${resultCountLabel} for “${searchQuery.trim()}” in ${currentLocationLabel}` : `${itemCountLabel} in ${currentLocationLabel}`;
  const batchDownloadSummaryLabel = downloadSelectionCount > 0 ? `${pluralize(downloadSelectionCount, "item")} selected for download (${downloadSelectionLabel})` : undefined;
  const canCreateFolder = !cacheOnlyMode && Boolean(capabilities?.createFolder);
  const canUploadFiles = !cacheOnlyMode && Boolean(capabilities?.upload);
  const canMoveSelected = !cacheOnlyMode && Boolean(capabilities?.move) && Boolean(selectedEntry);
  const canCopySelected = !cacheOnlyMode && Boolean(capabilities?.copy) && Boolean(selectedEntry);
  const canDeleteSelected = !cacheOnlyMode && Boolean(capabilities?.delete) && Boolean(selectedEntry);
  const canDownloadSelected = Boolean(capabilities?.download) && Boolean(selectedFilePath && token);
  const canDownloadBatchSelection = Boolean(capabilities?.download) && Boolean(downloadSelectionCount > 0 && token);
  const canMarkForBatchDownload = Boolean(capabilities?.download && token);
  const canSyncSelectedOffline = Boolean(capabilities?.download && token && selectedEntry && !cacheOnlyMode);
  const canSyncBatchOffline = Boolean(capabilities?.download && token && downloadSelectionCount > 0 && !cacheOnlyMode);
  const canOpenSelected = Boolean(selectedEntry);
  const destinationPickerValidation = destinationPicker ? getDestinationPickerValidation() : { destinationPath: "", message: undefined };
  const listRecoveryAvailable = Boolean(listError) && !loadingFolder && !cacheOnlyMode;
  const activeAccountName = activeAccount?.displayName ?? "current account";
  const activeAccountHost = activeAccount ? new URL(activeAccount.baseUrl).hostname : undefined;
  const allowOfflineCachedShell = Boolean(cacheOnlyMode && activeAccount && cacheNamespace && canAttemptAutoRestore(activeAccount));
  const showAccountConnectPanel = !activeAccount || (activeAccount.connectionState === "reconnect_required" && autoRestorePausedForAccountId === activeAccount.id);
  const showUnlockPanel = Boolean(activeAccount && !token && activeAccount.connectionState === "connected" && unlockRequired && !healthLoading);
  const mediaItems = useMemo(
    () => visibleItems.filter((item) => !item.isFolder && isMediaGalleryEntry(item, uiSettings.experimentalHeicPreviewEnabled)),
    [uiSettings.experimentalHeicPreviewEnabled, visibleItems]
  );
  const openedMediaIndex = openedEntry ? mediaItems.findIndex((item) => item.path === openedEntry.path) : -1;
  const previousMediaItem = openedMediaIndex > 0 ? mediaItems[openedMediaIndex - 1] : undefined;
  const nextMediaItem = openedMediaIndex >= 0 ? mediaItems[openedMediaIndex + 1] : undefined;

  useEffect(() => {
    if (!allowOfflineCachedShell || token || !activeAccount) {
      return;
    }

    setBootstrapError(undefined);
    setStatus(
      offline
        ? `Offline cache only for ${activeAccount.displayName}. Live session restore resumes once the worker is reachable again.`
        : `Cached shell only for ${activeAccount.displayName}. Live session restore resumes once the local server is reachable again.`
    );
  }, [allowOfflineCachedShell, activeAccount, token, offline]);

  const renderAppBar = (supportText: string) => {
    const compactMobileHeader = isNarrowScreen && accountState.accounts.length > 0;
    const showHeaderStatusBadge = !compactMobileHeader;
    const showPersistentProductName = accountState.accounts.length === 0;
    const navigationDrawerStatusLabel = offline ? "Offline" : workerUnavailable ? "Unavailable" : "Online";

    return (
      <>
        <header className={`app-bar${compactMobileHeader ? " app-bar-compact" : ""}${compactMobileHeader && mobileSearchOpen ? " app-bar-search-open" : ""}`}>
          <div className="app-bar-brand">
            {accountState.accounts.length > 0 ? (
              <button
                aria-expanded={navigationDrawerOpen}
                aria-label="Open navigation menu"
                className="nav-drawer-trigger"
                onClick={() => {
                  pushCurrentSurfaceHistory("navigation");
                  setNavigationDrawerOpen(true);
                }}
                type="button"
              >
                ☰
              </button>
            ) : null}
            {compactMobileHeader && accountState.accounts.length > 0 ? (
              mobileSearchOpen ? (
                <div className="mobile-app-bar-search search-block">
                  <input
                    aria-label="Search files"
                    autoFocus
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search files"
                    value={searchQuery}
                  />
                  <button aria-label="Close search" className="mobile-search-close-button" onClick={() => setMobileSearchOpen(false)} type="button">×</button>
                </div>
              ) : (
                <>
                  {currentPath ? (
                    <button
                      aria-label="Go up one folder level"
                      className="mobile-parent-button"
                      onClick={() => navigateToPath(currentPath.split("/").slice(0, -1).join("/"))}
                      type="button"
                    >
                      ↑
                    </button>
                  ) : null}
                  <span className="mobile-app-bar-title">{currentFolderLabel}</span>
                </>
              )
            ) : (
              <>
                <div aria-hidden="true" className="app-logo">D</div>
                <div className="app-bar-brand-copy">
                  {showPersistentProductName ? <h1>Davora</h1> : null}
                  {!compactMobileHeader ? <p className="status app-bar-subtitle">{supportText}</p> : null}
                </div>
              </>
            )}
          </div>
          <div className="app-bar-actions">
            {(token && pwaPrompt.installAvailable) || accountState.accounts.length > 0 ? (
              <div className="app-bar-contextual-actions">
                {token && pwaPrompt.installAvailable ? <button className="quiet-button app-install-button" disabled={pwaPrompt.installing} onClick={() => void pwaPrompt.installApp()} type="button">{pwaPrompt.installing ? "Installing…" : "Install app"}</button> : null}
                {accountState.accounts.length > 0 && !compactMobileHeader ? <button onClick={openSettingsDialog} type="button">Profile & settings</button> : null}
              </div>
            ) : null}
            {accountState.accounts.length > 0 ? (
              <>
                {compactMobileHeader && !mobileSearchOpen ? (
                  <button
                    aria-label="Open search"
                    className="mobile-search-button"
                    onClick={() => {
                      pushCurrentSurfaceHistory("search");
                      setMobileSearchOpen(true);
                    }}
                    type="button"
                  >⌕</button>
                ) : null}
                {compactMobileHeader && !mobileSearchOpen ? (
                  <button
                    aria-label={`Open sort options. Current sort: ${SORT_MODE_LABELS[uiSettings.sortMode]}`}
                    aria-expanded={sortPanelOpen}
                    className="mobile-sort-button"
                    onClick={() => setSortPanelOpen((previous) => !previous)}
                    type="button"
                  >{SORT_MODE_COMPACT_LABELS[uiSettings.sortMode]}</button>
                ) : null}
                {compactMobileHeader && !mobileSearchOpen && showRoutineCachedRefresh ? (
                  <span aria-label="Refreshing cached folder" className="mobile-refresh-status" role="status">Sync</span>
                ) : null}
              <TransferTray
                onClearFinished={clearFinishedTransfers}
                onRetryFailedSync={retryFailedOfflineSync}
                onToggleOpen={() => {
                  if (transferOpenRef.current) {
                    setTransferOpen(false);
                    return;
                  }
                  openTransferTray();
                }}
                open={transferOpen}
                tasks={transferTasks}
              />
              </>
            ) : null}
            {showHeaderStatusBadge ? <div className={`badge ${cacheOnlyMode ? "offline" : "online"}`}>{offline ? "Offline" : workerUnavailable ? "Server unavailable" : "Online"}</div> : null}
          </div>
        </header>
        {compactMobileHeader && sortPanelOpen ? (
          <div className="mobile-sort-panel" role="group" aria-label="Sort options">
            {SORT_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                aria-pressed={uiSettings.sortMode === option.value}
                className={`mobile-sort-option${uiSettings.sortMode === option.value ? " active" : ""}`}
                onClick={() => {
                  handleSortModeChange(option.value);
                  setSortPanelOpen(false);
                }}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {accountState.accounts.length > 0 ? (
          <>
            {navigationDrawerOpen ? (
              <button
                aria-label="Close navigation menu"
                className="nav-drawer-scrim open"
                onClick={() => setNavigationDrawerOpen(false)}
                type="button"
              />
            ) : null}
            <aside
              aria-hidden={!navigationDrawerOpen}
              aria-label="Navigation menu"
              className={`nav-drawer${navigationDrawerOpen ? " open" : ""}`}
              ref={navigationDrawerRef}
            >
              <div className="nav-drawer-header">
                <div>
                  <p className="eyebrow section-eyebrow">Workspace</p>
                  <h2>{activeAccountName}</h2>
                  <p className="status">{currentLocationLabel}</p>
                </div>
                <button className="quiet-button" onClick={() => setNavigationDrawerOpen(false)} type="button">Close</button>
              </div>
              <div className="nav-drawer-status">
                <span className={`badge ${cacheOnlyMode ? "offline" : "online"}`}>{navigationDrawerStatusLabel}</span>
                <span className={`operation-pill ${cacheOnlyMode ? "disabled" : "enabled"}`}>{cacheOnlyMode ? "Read-only" : "Ready"}</span>
              </div>
              <nav aria-label="Folder navigation" className="nav-drawer-section">
                <p className="summary-label">Folders</p>
                {breadcrumbs(currentPath).map((item) => (
                  <button
                    aria-current={item.value === currentPath ? "page" : undefined}
                    className={item.value === currentPath ? "active" : undefined}
                    key={item.value || "root"}
                    onClick={() => navigateToPath(item.value)}
                    type="button"
                  >
                    {item.value ? item.label : "Home"}
                  </button>
                ))}
              </nav>
              <div className="nav-drawer-section">
                <p className="summary-label">Actions</p>
                <button disabled={!canCreateFolder || mutationBusy} onClick={handleCreateFolder} type="button">Create folder</button>
                <label className={`nav-drawer-upload ${!canUploadFiles || mutationBusy ? "disabled" : ""}`}>
                  Upload files
                  <input
                    aria-label="Upload files from navigation menu"
                    disabled={!canUploadFiles || mutationBusy}
                    multiple
                    onChange={(event) => {
                      setNavigationDrawerOpen(false);
                      void handleUpload(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
                <label className={`nav-drawer-upload ${!canUploadFiles || mutationBusy ? "disabled" : ""}`}>
                  Upload folder
                  <input
                    aria-label="Upload folder from navigation menu"
                    disabled={!canUploadFiles || mutationBusy}
                    onChange={(event) => {
                      setNavigationDrawerOpen(false);
                      void handleUpload(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                    ref={applyDirectoryUploadAttributes}
                    type="file"
                  />
                </label>
                <button
                  onClick={() => {
                    setNavigationDrawerOpen(false);
                    openSettingsDialog();
                  }}
                  type="button"
                >
                  Profile & settings
                </button>
              </div>
            </aside>
          </>
        ) : null}
      </>
    );
  };

  if (healthLoading && accountState.accounts.length === 0) {
    return (
      <div className="shell">
        <ReloadPrompt needRefresh={pwaPrompt.needRefresh} onDismiss={pwaPrompt.dismissUpdatePrompt} onReload={pwaPrompt.reloadApp} reloading={pwaPrompt.reloading} />
        {renderAppBar("Checking connection")}
        <StateBanner kind="loading" message="Checking session requirements…" />
      </div>
    );
  }

  if (accountState.accounts.length === 0) {
    return (
      <div className="shell">
        <ReloadPrompt needRefresh={pwaPrompt.needRefresh} onDismiss={pwaPrompt.dismissUpdatePrompt} onReload={pwaPrompt.reloadApp} reloading={pwaPrompt.reloading} />
        {renderAppBar("No accounts connected")}
        {bootstrapError ? <StateBanner kind="error" message={bootstrapError} /> : null}
        <section className="panel zero-state-panel">
          <p className="eyebrow section-eyebrow">Accounts</p>
          <h2>No connected accounts yet</h2>
          <p className="subtitle">Connect a Nextcloud account inside Davora to start browsing files. You can add more accounts later and switch between them without mixing cache state.</p>
          {!showZeroStateForm ? (
            <button
              onClick={() => {
                setAccountFormError(undefined);
                setAccountForm(createEmptyAccountForm("add", healthRootPath));
                setShowZeroStateForm(true);
              }}
              type="button"
            >
              Connect account
            </button>
          ) : null}
          {showZeroStateForm ? (
            <AccountForm
              busy={accountBusy}
              description="Enter your Nextcloud base URL, username, app password, and the root folder to browse. An optional label helps when you manage multiple accounts."
              eyebrow="First run"
              error={accountFormError}
              form={accountForm}
              onChange={setAccountForm}
              onSubmit={(event) => void submitAccountForm(event)}
              submitLabel="Connect account"
              title="Connect Nextcloud account"
            />
          ) : null}
        </section>
      </div>
    );
  }

  if (showAccountConnectPanel) {
    return (
      <div className="shell">
        <ReloadPrompt needRefresh={pwaPrompt.needRefresh} onDismiss={pwaPrompt.dismissUpdatePrompt} onReload={pwaPrompt.reloadApp} reloading={pwaPrompt.reloading} />
        {renderAppBar(activeAccount?.connectionState === "reconnect_required" ? "Reconnect required" : "Connect account")}
        {bootstrapError ? <StateBanner kind="error" message={bootstrapError} /> : null}
        <section className="panel bootstrap-panel">
          <AccountForm
            busy={accountBusy}
            description={activeAccount?.connectionState === "reconnect_required"
              ? "The Worker no longer has this account ready. Re-enter the app password to reconnect it without changing browser-side cache namespaces."
              : "Connect a Nextcloud account to continue."}
            eyebrow={activeAccount?.connectionState === "reconnect_required" ? "Reconnect" : "Account"}
            error={accountFormError}
            form={accountForm.mode === "reconnect" ? accountForm : activeRecord ? buildReconnectForm(activeRecord) : accountForm}
            onChange={setAccountForm}
            onSubmit={(event) => void submitAccountForm(event)}
            submitLabel={activeAccount?.connectionState === "reconnect_required" ? "Reconnect account" : "Connect account"}
            title={activeAccount?.connectionState === "reconnect_required" ? `Reconnect ${activeAccountName}` : "Connect account"}
          />
        </section>
      </div>
    );
  }

  if (showUnlockPanel) {
    return (
      <div className="shell">
        <ReloadPrompt needRefresh={pwaPrompt.needRefresh} onDismiss={pwaPrompt.dismissUpdatePrompt} onReload={pwaPrompt.reloadApp} reloading={pwaPrompt.reloading} />
        {renderAppBar(`Unlock required for ${activeAccountName}`)}
        <section className="panel bootstrap-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow section-eyebrow">Session</p>
              <h2>Unlock required</h2>
            </div>
            {sessionBusy ? <span className="operation-pill enabled">Connecting</span> : null}
          </div>
          <p className="unlock-copy">Connected account: <strong>{activeAccountName}</strong> ({activeAccountHost})</p>
          <StateBanner kind={sessionBusy ? "loading" : bootstrapError ? "error" : "idle"} message={sessionBusy ? "Submitting unlock code…" : bootstrapError ?? ""} />
          <form className="unlock-form" onSubmit={(event) => void submitUnlockCode(event)}>
            <label>
              Unlock code
              <input
                aria-label="Unlock code"
                autoComplete="one-time-code"
                disabled={sessionBusy}
                onChange={(event) => setUnlockCode(event.target.value)}
                placeholder="Enter deployment unlock code"
                type="password"
                value={unlockCode}
              />
            </label>
            <button disabled={sessionBusy} type="submit">Unlock and connect</button>
          </form>
        </section>
      </div>
    );
  }

  if (!token && !allowOfflineCachedShell) {
    return (
      <div className="shell">
        <ReloadPrompt needRefresh={pwaPrompt.needRefresh} onDismiss={pwaPrompt.dismissUpdatePrompt} onReload={pwaPrompt.reloadApp} reloading={pwaPrompt.reloading} />
        {renderAppBar(`Restoring ${activeAccountName}`)}
        <StateBanner kind={sessionBusy ? "loading" : bootstrapError ? "error" : "idle"} message={sessionBusy ? `Restoring workspace access for ${activeAccountName}…` : bootstrapError ?? ""} />
        {!sessionBusy && activeAccount ? <button onClick={() => void ensureSessionForAccount(activeAccount.id)} type="button">Retry restore</button> : null}
      </div>
    );
  }

  return (
    <div className="shell">
      <ReloadPrompt needRefresh={pwaPrompt.needRefresh} onDismiss={pwaPrompt.dismissUpdatePrompt} onReload={pwaPrompt.reloadApp} reloading={pwaPrompt.reloading} />
      {renderAppBar(currentLocationLabel)}
      <div className="state-banner-slot">
        <StateBanner kind={folderInlineBanner.kind} message={folderInlineBanner.message} />
      </div>

      <main
        className={`workspace-layout${showDetailsRail ? "" : " workspace-layout-full"}`}
        onTouchStart={handlePullToRefreshStart}
        onTouchMove={handlePullToRefreshMove}
        onTouchEnd={handlePullToRefreshEnd}
      >
        {pullToRefreshVisible && (
          <div
            aria-live="polite"
            className="pull-to-refresh-indicator"
            role="status"
            style={{ opacity: pullToRefreshProgress, transform: `translateY(${(1 - pullToRefreshProgress) * 40}px)` }}
          >
            <span className="pull-to-refresh-spinner">
              {pullToRefreshRefreshing ? "Refreshing..." : pullToRefreshProgress >= 1 ? "Release to refresh" : "Pull to refresh"}
            </span>
          </div>
        )}
        <section className="file-browser-panel">
          <section className="browse-header panel panel-subtle">
            <div className="browse-header-main">
              <div className="browse-title-row">
                <div className="browse-title-stack">
                  <p className="eyebrow section-eyebrow">Files</p>
                  <h2>{currentFolderLabel}</h2>
                  <span className="status browse-title-count">{browseStatusLabel}</span>
                </div>
                <span className={`operation-pill ${cacheOnlyMode ? "disabled" : refreshingFolder || staleFolder || searchActive ? "secondary" : "enabled"}`}>{cacheOnlyMode ? "Read-only" : refreshingFolder ? "Refreshing" : staleFolder ? "Cached" : searchActive ? "Search active" : "Ready"}</span>
              </div>


              {showBreadcrumbs ? (
                <nav aria-label="Breadcrumbs" className="breadcrumbs">
                  {currentBreadcrumbs.map((item) => (
                    <div className="breadcrumb-segment" key={item.value || "root"}>
                      <button aria-label={item.ariaLabel} onClick={() => navigateToPath(item.value)} type="button">
                        {item.label}
                      </button>
                      {item.value !== currentPath ? <span aria-hidden="true" className="breadcrumb-separator">/</span> : null}
                    </div>
                  ))}
                </nav>
              ) : null}

              {staleInfo || searchActive ? (
                <div className="browse-context-row">
                  {staleInfo ? <span className="status stale-info">{staleInfo}</span> : null}
                  {searchActive ? <button className="quiet-button" onClick={() => setSearchQuery("")} type="button">Clear search</button> : null}
                </div>
              ) : null}
              {batchDownloadSummaryLabel ? (
                <div className="browse-selection-row">
                  <span className="status">{batchDownloadSummaryLabel}</span>
                  <div className="browse-selection-actions">
                    <button disabled={!canDownloadBatchSelection} onClick={() => void startBatchDownloadWithTransfer(downloadSelection)} type="button">Download selected</button>
                    <button disabled={!canSyncBatchOffline} onClick={() => void openOfflineSyncDialog(downloadSelection)} type="button">Keep offline</button>
                    <button className="quiet-button" onClick={clearDownloadSelection} type="button">Clear selection</button>
                  </div>
                </div>
              ) : null}
              <p className="status browse-status-note">{status}</p>
            </div>

            <div className="browse-header-controls">
              <div className="toolbar-search search-block">
                <input
                  aria-label="Search files"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search files and folders"
                  value={searchQuery}
                />
              </div>
              <div className="folder-actions-inline">
                <label className="stacked-field file-size-toolbar-field">
                  <span className="summary-label">File size display</span>
                  <select
                    aria-label="File size display in file list"
                    onChange={(event) => {
                      const nextMode = FILE_SIZE_DISPLAY_OPTIONS.find((option) => option.value === event.target.value)?.value;
                      if (nextMode) {
                        handleFileSizeDisplayModeChange(nextMode);
                      }
                    }}
                    value={fileSizeDisplayMode}
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
                    onChange={(event) => handleSortModeChange(event.target.value as SortMode)}
                    value={uiSettings.sortMode}
                  >
                    {SORT_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <button disabled={!canCreateFolder || mutationBusy} onClick={handleCreateFolder} type="button">Create folder</button>
                <label className={`upload-label ${!canUploadFiles || mutationBusy ? "disabled" : ""}`}>
                  Upload files
                  <input
                    aria-label="Upload files"
                    disabled={!canUploadFiles || mutationBusy}
                    multiple
                    onChange={(event) => {
                      void handleUpload(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
                <label className={`upload-label ${!canUploadFiles || mutationBusy ? "disabled" : ""}`}>
                  Upload folder
                  <input
                    aria-label="Upload folder"
                    disabled={!canUploadFiles || mutationBusy}
                    onChange={(event) => {
                      void handleUpload(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                    ref={applyDirectoryUploadAttributes}
                    type="file"
                  />
                </label>
              </div>
              <p className={`status drop-upload-note${folderDropActive ? " active" : ""}`}>{canUploadFiles ? `Tip: drag and drop files anywhere in this folder view, or use Upload folder to keep directory structure under ${currentLocationLabel}.` : cacheOnlyMode ? "Uploads are unavailable while cached-shell mode is active." : "Uploads are unavailable when this account is read-only."}</p>
            </div>
          </section>

          <section
            className={`file-list-panel${folderDropActive ? " file-list-panel-drop-active" : ""}${downloadSelectionCount > 0 ? " batch-download-mode" : ""}`}
            ref={fileListPanelRef}
            onDragEnter={(event) => {
              if (!canUploadFiles || mutationBusy || !event.dataTransfer?.types.includes("Files")) {
                return;
              }
              event.preventDefault();
              setFolderDropActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                return;
              }
              setFolderDropActive(false);
            }}
            onDragOver={(event) => {
              if (!canUploadFiles || mutationBusy || !event.dataTransfer?.types.includes("Files")) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              if (!folderDropActive) {
                setFolderDropActive(true);
              }
            }}
            onDrop={(event) => {
              if (!canUploadFiles || mutationBusy) {
                return;
              }
              event.preventDefault();
              setFolderDropActive(false);
              const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
              if (droppedFiles.length === 0) {
                return;
              }
              void handleUpload(droppedFiles, "drop");
            }}
          >
            <div aria-hidden="true" className="list-head">
              <span className="list-head-spacer" />
              <span>Name</span>
              <span>Modified</span>
              <span>Size</span>
              <span>Actions</span>
            </div>

            <ul className="file-list-items">
              {visibleItems.map((item) => {
                const isSelected = selectedEntry?.path === item.path;
                const isMarkedForDownload = downloadSelection.some((entry) => entry.path === item.path);
                const openLabel = `${item.isFolder ? "Open folder" : "Open file"} ${item.name}`;
                const detailLabel = `${isSelected ? "Close" : "Open"} actions for ${item.name}`;
                const selectForDownloadLabel = `${isMarkedForDownload ? "Remove" : "Select"} ${item.name} ${item.isFolder ? "folder" : "file"} for batch download`;

                return (
                  <li key={item.path}>
                    <div
                      className={`item-row ${isSelected ? "selected" : ""}${isMarkedForDownload ? " batch-selected" : ""}`}
                      onContextMenu={(event) => {
                        if (isNarrowScreen) {
                          event.preventDefault();
                        }
                      }}
                      onPointerCancel={clearRowLongPressTimer}
                      onPointerDown={() => startRowLongPressSelection(item)}
                      onPointerLeave={clearRowLongPressTimer}
                      onPointerUp={clearRowLongPressTimer}
                    >
                      <input
                        aria-label={selectForDownloadLabel}
                        checked={isMarkedForDownload}
                        className="item-batch-checkbox"
                        disabled={!canMarkForBatchDownload}
                        onChange={() => toggleDownloadSelection(item)}
                        type="checkbox"
                      />
                      <button
                        aria-label={openLabel}
                        className="item-open-button"
                        onClick={() => {
                          if (rowLongPressHandledRef.current) {
                            rowLongPressHandledRef.current = false;
                            return;
                          }
                          if (item.isFolder) {
                            navigateToPath(item.path);
                            return;
                          }
                          void openFile(item);
                        }}
                        type="button"
                      >
                        <span className="item-primary">
                          <span className="item-icon">{item.isFolder ? "📁" : "📄"}</span>
                          <span className="item-text">
                            <span className="item-name">{item.name}</span>
                            {searchActive ? <span className="item-subtitle">{toDisplayPath(dirname(item.path))}</span> : null}
                          </span>
                        </span>
                      </button>
                      <span className="meta item-secondary item-modified">{item.lastModified ? formatFileTimestamp(item.lastModified, "compact") : "—"}</span>
                      <span className="meta item-secondary item-size">{item.isFolder ? "—" : formatBytes(item.size, fileSizeDisplayMode)}</span>
                      <button
                        aria-label={detailLabel}
                        aria-pressed={isSelected}
                        className={`item-select-button ${isSelected ? "active" : ""}`}
                        onClick={() => toggleEntrySelection(item)}
                        type="button"
                      >
                        <span className="item-select-label">{isSelected ? "Actions" : "More"}</span>
                        <span aria-hidden="true" className="item-select-icon">...</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {visibleItems.length === 0 ? (
              <div className="empty-state">
                <p className="empty empty-title">
                  {searchActive
                    ? listError
                      ? "Unable to load search results."
                      : "No files match this search yet."
                    : listError
                      ? hasEverCachedFolder
                        ? "Unable to load this folder."
                        : "Couldn't load this folder. Its contents are unknown."
                      : loadingFolder && !hasEverCachedFolder
                        ? "Loading folder…"
                        : "This folder is empty."}
                </p>
                <p className="status">{listError ? listError.message : searchActive ? `Search scope: ${currentLocationLabel}` : `Location: ${currentLocationLabel}`}</p>
                <div className="empty-actions">
                  {searchActive ? <button onClick={() => setSearchQuery("")} type="button">Clear search</button> : null}
                  {listRecoveryAvailable ? <button onClick={() => void loadFolder(currentPath)} type="button">Retry folder</button> : null}
                </div>
              </div>
            ) : null}
          </section>
        </section>

        {isNarrowScreen && downloadSelectionCount > 0 && !showMobileSelectionSheet ? (
          <div aria-label="Batch selection actions" className="mobile-batch-bar" role="toolbar">
            <span className="mobile-batch-summary">{pluralize(downloadSelectionCount, "item")} selected</span>
            <button disabled={!canDownloadBatchSelection} onClick={() => void startBatchDownloadWithTransfer(downloadSelection)} type="button">Download</button>
            <button disabled={!canSyncBatchOffline} onClick={() => void openOfflineSyncDialog(downloadSelection)} type="button">Keep offline</button>
            <button className="quiet-button" onClick={clearDownloadSelection} type="button">Clear</button>
          </div>
        ) : null}

        {showMobileSelectionSheet ? (
          <button
            aria-label="Dismiss item actions"
            className="mobile-sheet-backdrop"
            onClick={closeMobileSelectionSheet}
            type="button"
          />
        ) : null}

        {showDetailsRail ? <aside className="workspace-rail">
          <section
            aria-label={detailsPanelLabel}
            className={`details-panel panel panel-subtle${showMobileSelectionSheet ? " details-panel-sheet-open" : ""}${showMobileSelectionSheet && mobileSheetDetailsExpanded ? " details-panel-sheet-details-open" : ""}`}
            data-mobile-hidden={showMobileSelectionSheet ? "false" : "true"}
            role={showMobileSelectionSheet ? "region" : undefined}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Details</p>
                <h2>{selectedDetails ? selectedDetails.isFolder ? "Selected folder" : "Selected file" : downloadSelectionCount > 0 ? "Batch download" : "Workspace details"}</h2>
              </div>
              {selectedDetails ? (
                showMobileSelectionSheet ? (
                  <div className="panel-header-actions">
                    {mobileSheetDetailsExpanded ? (
                      <button className="mobile-sheet-back-button" onClick={() => setMobileSheetDetailsExpanded(false)} type="button">
                        Actions
                      </button>
                    ) : null}
                    <span className={`operation-pill ${offline ? "disabled" : "enabled"}`}>{offline ? "Read-only" : "Actions"}</span>
                    <button
                      aria-label="Close item actions"
                      className="mobile-sheet-close-button"
                      onClick={closeMobileSelectionSheet}
                      type="button"
                    >
                      Close
                    </button>
                  </div>
                ) : <span className={`operation-pill ${offline ? "disabled" : "enabled"}`}>{offline ? "Read-only" : "Actions"}</span>
              ) : null}
            </div>

              {selectedDetails ? (
              <>
                <p className="selection-name">{selectedDetails.name}</p>
                <p className="status details-path">{toDisplayPath(selectedDetails.path)}</p>
                <p className="status details-selection-note">{downloadSelection.some((entry) => entry.path === selectedDetails.path) ? "Included in batch download selection." : "Not included in batch download selection yet."}</p>
                <dl className="metadata context-metadata">
                  <div>
                    <dt>Kind</dt>
                    <dd>{selectedTypeLabel}</dd>
                  </div>
                  <div>
                    <dt>Modified</dt>
                    <dd>{formatFileTimestamp(selectedDetails.lastModified)}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(selectedDetails.size, fileSizeDisplayMode)}</dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{toDisplayPath(selectedDetails.path)}</dd>
                  </div>
                </dl>
                <div className="context-action-group">
                  <span className="action-group-label">Actions</span>
                  <div className="context-actions">
                    {selectedDetails.isFolder && selectedEntry ? <button onClick={() => navigateToPath(selectedEntry.path)} type="button">Open</button> : null}
                    {!selectedDetails.isFolder && selectedEntry ? <button onClick={() => void openFile(selectedEntry)} type="button">Open</button> : null}
                    {canDownloadSelected && selectedFilePath ? <button onClick={() => void startDownloadWithTransfer(selectedFilePath, toDisplayPath(selectedFilePath))} type="button">Download</button> : null}
                    <button disabled={!canSyncSelectedOffline} onClick={() => selectedEntry ? void openOfflineSyncDialog([selectedEntry]) : undefined} type="button">Keep offline</button>
                    <button
                      aria-label={downloadSelection.some((entry) => entry.path === selectedDetails.path) ? "Remove from batch download" : "Add to batch download"}
                      className="batch-download-toggle-action"
                      disabled={!canMarkForBatchDownload}
                      onClick={() => selectedEntry ? toggleDownloadSelection(selectedEntry) : undefined}
                      type="button"
                    >
                      {downloadSelection.some((entry) => entry.path === selectedDetails.path) ? "Remove batch" : "Add batch"}
                    </button>
                    {canDownloadBatchSelection ? <button aria-label="Download selected batch" onClick={() => void startBatchDownloadWithTransfer(downloadSelection)} type="button">Download batch</button> : null}
                    {showMobileSelectionSheet ? (
                      <button
                        aria-label={mobileSheetDetailsExpanded ? "Back to actions" : "View details"}
                        aria-pressed={mobileSheetDetailsExpanded}
                        className="details-mode-toggle"
                        onClick={() => setMobileSheetDetailsExpanded((value) => !value)}
                        type="button"
                      >
                        {mobileSheetDetailsExpanded ? "Actions" : "Details"}
                      </button>
                    ) : null}
                    <button aria-label="Rename or move" disabled={!canMoveSelected || mutationBusy} onClick={handleMove} type="button">Rename</button>
                    <button disabled={!canCopySelected || !canMoveSelected || mutationBusy} onClick={handleCopyMove} type="button">Copy or move</button>
                    <button className={canDeleteSelected ? "button-danger" : undefined} disabled={!canDeleteSelected || mutationBusy} onClick={handleDelete} type="button">Delete</button>
                  </div>
                </div>
              </>
            ) : downloadSelectionCount > 0 ? (
              <div className="details-summary">
                <p className="selection-name">{pluralize(downloadSelectionCount, "item")} selected</p>
                <p className="status details-path">{downloadSelectionLabel}</p>
                <div className="context-action-group">
                  <span className="action-group-label">Batch download</span>
                  <div className="context-actions">
                    <button disabled={!canDownloadBatchSelection} onClick={() => void startBatchDownloadWithTransfer(downloadSelection)} type="button">Download selected</button>
                    <button disabled={!canSyncBatchOffline} onClick={() => void openOfflineSyncDialog(downloadSelection)} type="button">Keep offline</button>
                    <button className="quiet-button" onClick={clearDownloadSelection} type="button">Clear selection</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="details-summary">
                <p className="selection-name">{currentFolderLabel}</p>
                <dl className="metadata context-metadata">
                  <div>
                    <dt>Location</dt>
                    <dd>{currentLocationLabel}</dd>
                  </div>
                  <div>
                    <dt>{searchActive ? "Results" : "Items"}</dt>
                    <dd>{searchActive ? resultCountLabel : itemCountLabel}</dd>
                  </div>
                  {searchActive ? (
                    <div>
                      <dt>Search</dt>
                      <dd>{searchQuery.trim()}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Mode</dt>
                    <dd>{offline ? "Offline" : workerUnavailable ? "Server unavailable" : "Online"}</dd>
                  </div>
                  {staleInfo ? (
                    <div>
                      <dt>Cached</dt>
                      <dd>{staleInfo}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            )}
          </section>
        </aside> : null}
      </main>

      <SettingsDialog
        accounts={accountState.accounts.map((record) => record.account)}
        activeAccount={activeAccount}
        activeAccountId={accountState.activeAccountId}
        appBuildLabel={APP_BUILD_LABEL}
        cacheSummary={cacheSummary}
        closeActionLabel={isNarrowScreen ? "Done" : "Close"}
        connectedAccountCount={accountState.accounts.length}
        fileSizeDisplayMode={fileSizeDisplayMode}
        maxCacheableFileSizeBytes={maxCacheableFileSizeBytes}
        offline={offline}
        offlineItems={summarizeOfflineRoots(offlineEntries)}
        onActiveAccountChange={handleActiveAccountChange}
        onClearCache={() => void handleClearCache()}
        onClose={() => setShowSettingsDialog(false)}
        onDismissFromScrim={() => setShowSettingsDialog(false)}
        onMaxCacheableFileSizeChange={handleMaxCacheableFileSizeChange}
        onOpenAddAccount={openAddAccountFromSettings}
        onOpenReconnect={openReconnectFromSettings}
        onOpenRemove={openRemoveFromSettings}
        onOpenedFileCacheLimitChange={(limitBytes) => void handleCacheLimitChange(limitBytes)}
        onPreviewFreshnessIntervalChange={handlePreviewFreshnessIntervalChange}
        onRemoveOfflineItem={(rootPath) => {
          const root = summarizeOfflineRoots(offlineEntries).find((item) => item.rootPath === rootPath);
          if (root) {
            void removeOfflineCopy(root);
          }
        }}
        onShowHiddenFilesChange={handleShowHiddenFilesChange}
        experimentalHeicPreviewEnabled={uiSettings.experimentalHeicPreviewEnabled}
        onExperimentalHeicPreviewEnabledChange={handleExperimentalHeicPreviewEnabledChange}
        open={showSettingsDialog}
        previewFreshnessIntervalSeconds={previewFreshnessIntervalSeconds}
        showHiddenFiles={uiSettings.showHiddenFiles}
      />

      {offlineSyncDialog ? (
        <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, () => !offlineSyncBusy && setOfflineSyncDialog(undefined))} role="presentation">
          <section aria-label="Keep offline confirmation" aria-modal="true" className="dialog-card panel" role="dialog">
            <div className="dialog-header">
              <div>
                <p className="eyebrow section-eyebrow">Offline sync</p>
                <h2>Keep offline on this device</h2>
              </div>
              <button className="quiet-button" disabled={offlineSyncBusy} onClick={() => setOfflineSyncDialog(undefined)} type="button">Cancel</button>
            </div>
            <p className="subtitle dialog-copy">
              Davora will store the selected content in this browser for offline access. This is local device storage and does not create a server-side copy.
            </p>
            <dl className="metadata context-metadata">
              <div>
                <dt>Selection</dt>
                <dd>{offlineSyncDialog.entries.length === 1 ? offlineSyncDialog.entries[0]?.name : pluralize(offlineSyncDialog.entries.length, "item")}</dd>
              </div>
              <div>
                <dt>Folders</dt>
                <dd>{offlineSyncDialog.entries.some((entry) => entry.isFolder) ? "Synced recursively" : "None selected"}</dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>{offlineSyncDialog.plan ? offlineSyncDialog.plan.files.length : offlineSyncDialog.phase === "estimating" ? "Calculating…" : "Unknown"}</dd>
              </div>
              <div>
                <dt>Estimated storage</dt>
                <dd>{offlineSyncDialog.plan?.totalBytes !== undefined ? formatBytes(offlineSyncDialog.plan.totalBytes, fileSizeDisplayMode) : offlineSyncDialog.phase === "estimating" ? "Calculating…" : "Unknown"}</dd>
              </div>
            </dl>
            {offlineSyncDialog.error ? <StateBanner kind="stale" message={`Storage size could not be calculated exactly: ${offlineSyncDialog.error}. Confirm only if you still want to use local device storage.`} /> : null}
            <p className="status">Kept-offline files are excluded from normal automatic cache eviction and remain until you remove them from this device.</p>
            <div className="dialog-actions">
              <button disabled={offlineSyncBusy || offlineSyncDialog.phase === "estimating"} onClick={() => void confirmOfflineSync()} type="button">{offlineSyncBusy ? "Starting…" : "Start sync"}</button>
              <button className="quiet-button" disabled={offlineSyncBusy} onClick={() => setOfflineSyncDialog(undefined)} type="button">Cancel</button>
            </div>
          </section>
        </div>
      ) : null}

      {showAccountDialog ? (
        <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, () => setShowAccountDialog(false))} role="presentation">
          <section aria-label={accountForm.mode === "reconnect" ? "Reconnect account" : "Add account"} aria-modal="true" className="dialog-card panel" role="dialog">
            <AccountForm
              busy={accountBusy}
              description={accountForm.mode === "reconnect"
                ? "Re-enter the app password so this account can create fresh sessions again."
                : "Connect another Nextcloud account without disturbing the current file-manager workspace design."}
              eyebrow={accountForm.mode === "reconnect" ? "Reconnect" : "Accounts"}
              error={accountFormError}
              form={accountForm}
              onCancel={() => setShowAccountDialog(false)}
              onChange={setAccountForm}
              onSubmit={(event) => void submitAccountForm(event)}
              submitLabel={accountForm.mode === "reconnect" ? "Reconnect account" : "Add account"}
              title={accountForm.mode === "reconnect" ? "Reconnect account" : "Add Nextcloud account"}
            />
          </section>
        </div>
      ) : null}

      {removeAccountTarget ? (
        <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, () => setRemoveAccountTarget(undefined))} role="presentation">
          <section aria-label={`Remove ${removeAccountTarget.displayName}`} aria-modal="true" className="dialog-card panel" role="dialog">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Accounts</p>
                <h2>Remove account</h2>
              </div>
            </div>
            <p className="subtitle dialog-copy">Remove <strong>{removeAccountTarget.displayName}</strong> from this browser and clear its account-scoped cache. Type the account label to confirm.</p>
            {removeAccountError ? <StateBanner kind="error" message={removeAccountError} /> : null}
            <form className="dialog-form" onSubmit={(event) => void confirmRemoveAccount(event)}>
              <label>
                Account label to confirm
                <input
                  aria-label="Account label to confirm"
                  autoFocus
                  disabled={accountBusy}
                  onChange={(event) => setRemoveAccountConfirmation(event.target.value)}
                  value={removeAccountConfirmation}
                />
              </label>
              <div className="dialog-actions">
                <button onClick={() => setRemoveAccountTarget(undefined)} type="button">Cancel</button>
                <button className="button-danger" disabled={accountBusy} type="submit">Remove account</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {actionDialog?.kind === "createFolder" ? (
        <ActionDialog
          busy={mutationBusy}
          description="Create a folder in this location."
          error={actionError}
          label="Folder name"
          onChange={(value) => setActionDialog({ kind: "createFolder", value })}
          onClose={() => setActionDialog(undefined)}
          onSubmit={(event) => void submitActionDialog(event)}
          submitLabel="Create folder"
          supportingText={`Location: ${currentLocationLabel}`}
          title="Create folder"
          value={actionDialog.value}
        />
      ) : null}

      {destinationPicker && selectedEntry ? (
        <DestinationPickerDialog
          actionError={actionError}
          busy={mutationBusy}
          destinationPath={destinationPickerValidation.destinationPath}
          entries={destinationPicker.entries}
          error={destinationPicker.error}
          folderPath={destinationPicker.folderPath}
          kind={destinationPicker.kind}
          loading={destinationPicker.loading}
          manualMode={destinationPicker.manualMode}
          manualPath={destinationPicker.manualPath}
          name={destinationPicker.name}
          onClose={() => setDestinationPicker(undefined)}
          onFolderChange={updateDestinationPickerFolder}
          onManualModeChange={updateDestinationPickerManualMode}
          onManualPathChange={updateDestinationPickerManualPath}
          onNameChange={updateDestinationPickerName}
          onReload={reloadDestinationPickerFolder}
          onSubmit={(operation, event) => void submitDestinationPicker(operation, event)}
          selectedEntry={selectedEntry}
          validationMessage={destinationPickerValidation.message}
        />
      ) : null}

      {actionDialog?.kind === "delete" && selectedEntry ? (
        <ActionDialog
          busy={mutationBusy}
          danger
          description="This permanently deletes the selected item from the server."
          error={actionError}
          onClose={() => setActionDialog(undefined)}
          onSubmit={(event) => void submitActionDialog(event)}
          submitLabel="Delete"
          supportingText="Review the target below, then choose Delete to continue."
          targetText={selectedEntry.path || selectedEntry.name}
          title="Delete item"
        />
      ) : null}

      <PreviewModal
        accountId={activeAccount?.id}
        blobUrl={selectedBlobUrl}
        cacheState={previewCacheState}
        entry={openedEntry}
        error={previewError}
        file={selected}
        fileSizeDisplayMode={fileSizeDisplayMode}
        imageFitMode={imagePreviewFitMode}
        loading={loadingPreview}
        maxCacheableFileSizeBytes={maxCacheableFileSizeBytes}
        offline={offline}
        workerUnavailable={workerUnavailable}
        onApplyRefresh={pendingPreviewUpdate ? applyPendingPreviewRefresh : undefined}
        onDownload={(path) => void startDownloadWithTransfer(path, toDisplayPath(path))}
        onImageFitModeChange={handleImagePreviewFitModeChange}
        onNext={nextMediaItem ? () => openAdjacentMedia(1) : undefined}
        onPrevious={previousMediaItem ? () => openAdjacentMedia(-1) : undefined}
        onClose={closePreview}
        open={previewOpen}
        token={token}
      />
    </div>
  );
}
