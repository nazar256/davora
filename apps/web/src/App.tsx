import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

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
import { dirname, getViewerKind, toDisplayPath } from "@davora/shared";

import {
  ApiRequestError,
  clearStoredAccountSession,
  connectAccount,
  copyFile,
  createFolder,
  createSession,
  deleteConnectedAccount,
  deleteFile,
  downloadFile,
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
  uploadFileWithProgress,
  uploadFile
} from "./lib/api";
import {
  cacheFolder,
  cacheSearch,
  clearFolderAndSearchCache,
  readFolderCacheEnvelope,
  readSearchCache
} from "./lib/cache";
import {
  cacheOpenedFile,
  clearOpenedFileCache,
  configureOpenedFileCache,
  DEFAULT_OPENED_FILE_CACHE_LIMIT,
  getCachedOpenedFile,
  getOpenedFileCacheSummary,
  type OpenedFileCacheEntry
} from "./lib/openedFileCache";
import { APP_BUILD_LABEL } from "./lib/appBuild";
import { FILE_SIZE_DISPLAY_OPTIONS, formatFileSize, getFileSizeDisplayModeLabel, type FileSizeDisplayMode } from "./lib/fileSize";
import { DEFAULT_UI_SETTINGS, loadUiSettings, saveUiSettings } from "./lib/uiSettings";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { ReloadPrompt, usePwaPromptState } from "./components/ReloadPrompt";
import { SettingsDialog } from "./components/SettingsDialog";
import { StateBanner } from "./components/StateBanner";
import { TransferTray, type TransferTask } from "./components/TransferTray";

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
  | { kind: "move"; value: string }
  | { kind: "copy"; value: string }
  | { kind: "delete"; value: string }
  | undefined;

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

const DEFAULT_PREVIEW_CACHE_STATE: PreviewCacheState = {
  source: "none",
  refreshing: false,
  stale: false,
  updateReady: false
};

const PREVIEW_PREFETCH_AHEAD_COUNT = 1;
const MEDIA_GALLERY_VIEWERS = new Set<ViewerKind>(["image", "audio", "video"]);

function breadcrumbs(path: string) {
  const parts = path.split("/").filter(Boolean);
  return [{ label: "🏠", ariaLabel: "Go to home folder", value: "" }, ...parts.map((part, index) => ({ label: part, ariaLabel: `Go to /${parts.slice(0, index + 1).join("/")}`, value: parts.slice(0, index + 1).join("/") }))];
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
  mimeType: string;
  filename: string;
  fingerprint: string;
}

async function loadPreviewPayload(path: string, token: string): Promise<PreviewPayload> {
  const response = await getFile(path, token);

  if (response.file.requiresOriginalBlob) {
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

function isMediaGalleryViewer(viewer: ViewerKind | undefined): boolean {
  return viewer ? MEDIA_GALLERY_VIEWERS.has(viewer) : false;
}

function canUseCachedPreview(cached: Awaited<ReturnType<typeof getCachedOpenedFile>> | undefined): boolean {
  if (!cached) {
    return false;
  }

  return !requiresOriginalBlobViewer(cached.entry.preview.viewer) || Boolean(cached.blob);
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
  label: string;
  submitLabel: string;
  value: string;
  busy: boolean;
  error?: string;
  danger?: boolean;
  supportingText?: string;
  onChange: (value: string) => void;
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
        {props.error ? <StateBanner kind="error" message={props.error} /> : null}
        <form className="dialog-form" onSubmit={props.onSubmit}>
          <label>
            {props.label}
            <input
              aria-label={props.label}
              autoFocus
              disabled={props.busy}
              onChange={(event) => props.onChange(event.target.value)}
              value={props.value}
            />
          </label>
          <div className="dialog-actions">
            <button onClick={props.onClose} type="button">Cancel</button>
            <button className={props.danger ? "button-danger" : undefined} disabled={props.busy} type="submit">{props.submitLabel}</button>
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
  const previewViewer = props.file?.viewer;
  const showGalleryControls = isMediaGalleryViewer(previewViewer) && (props.onPrevious || props.onNext);
  const imageStageAdvances = previewViewer === "image" && Boolean(props.onNext);

  useEffect(() => {
    setOpeningOriginal(false);
    setOriginalOpenError(undefined);
  }, [props.open, props.file?.path, props.file?.viewer]);

  useEffect(() => {
    setImagePreviewFailed(false);
  }, [props.open, props.file?.path, props.file?.viewer, props.blobUrl]);

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
  const showOpenOriginalAction = canOpenOriginal && previewViewer === "pdf";
  const openOriginalLabel = previewViewer === "pdf" ? "Open PDF in new tab" : "Open original in new tab";
  const previewNotice = getPreviewNotice(props.cacheState, props.offline || Boolean(props.workerUnavailable), props.offline);
  const imagePreviewUnavailable = previewViewer === "image" && (!props.blobUrl || imagePreviewFailed);

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
          <div className="preview-header-actions">
            <details className="preview-details-disclosure">
              <summary>File details</summary>
              <dl className="metadata preview-metadata">
                <div>
                  <dt>Kind</dt>
                  <dd>{previewKind}</dd>
                </div>
                <div>
                  <dt>Modified</dt>
                  <dd>{props.file?.lastModified ?? props.entry?.lastModified ?? "Unknown"}</dd>
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
            {showOpenOriginalAction ? <button disabled={openingOriginal} onClick={() => void handleOpenOriginal()} type="button">{openingOriginal ? "Opening original…" : openOriginalLabel}</button> : null}
            {handleDownload ? <button onClick={handleDownload} type="button">Download</button> : null}
            <button className="quiet-button preview-dismiss-button" onClick={props.onClose} type="button">Back to files</button>
          </div>
        </header>

        <section className={`preview-stage ${immersivePreview ? "preview-stage-immersive" : ""}`}>
          <div className={`preview-stage-shell ${immersivePreview ? "preview-stage-shell-immersive" : ""}`}>
            {props.loading ? <StateBanner kind="loading" message="Opening file…" /> : null}
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
            {props.error ? <StateBanner kind={props.error instanceof ApiRequestError && (props.error.status === 401 || props.error.status === 403) ? "permission" : "error"} message={props.error.message} /> : null}
            {originalOpenError ? <StateBanner kind="error" message={originalOpenError} /> : null}
            {props.file?.truncated ? <p className="status preview-notice">Showing the first {props.file.bytesRead} bytes.</p> : null}
            {props.file ? (
              <>
                {props.file.viewer === "markdown" ? <div className="preview-document"><MarkdownPreview content={props.file.content} /></div> : null}
                {props.file.viewer === "text" ? <pre className="preview-text">{props.file.content}</pre> : null}
                {props.file.viewer === "image" && props.blobUrl && !imagePreviewFailed ? (
                  <div
                    aria-label={imageStageAdvances ? `Open next photo after ${props.file.name}` : undefined}
                    className={`preview-media-stage${imageStageAdvances ? " preview-media-stage-clickable" : ""}`}
                    onClick={imageStageAdvances ? props.onNext : undefined}
                    onKeyDown={imageStageAdvances ? (event) => {
                      if ((event.key === "Enter" || event.key === " ") && props.onNext) {
                        event.preventDefault();
                        props.onNext();
                      }
                    } : undefined}
                    role={imageStageAdvances ? "button" : undefined}
                    tabIndex={imageStageAdvances ? 0 : undefined}
                  >
                    {renderGalleryControls()}
                    <img
                      alt={props.file.name}
                      className="media-preview media-preview-image"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                        setImagePreviewFailed(true);
                      }}
                      src={props.blobUrl}
                    />
                  </div>
                ) : null}
                {props.file.viewer === "audio" && props.blobUrl ? <div className="preview-media-stage">{renderGalleryControls("inline")}<audio className="media-preview media-preview-audio" controls src={props.blobUrl} /></div> : null}
                {props.file.viewer === "video" && props.blobUrl ? <div className="preview-media-stage">{renderGalleryControls("inline")}<video aria-label={`Video preview ${props.file.name}`} autoPlay className="media-preview media-preview-video" controls muted playsInline src={props.blobUrl} /></div> : null}
                {props.file.viewer === "pdf" && props.blobUrl ? <div className="preview-media-stage preview-media-stage-pdf"><iframe className="pdf-preview" src={props.blobUrl} title={`PDF preview ${props.file.name}`} /></div> : null}
                {(props.file.viewer === "unsupported" || imagePreviewUnavailable || (requiresOriginalBlobViewer(props.file.viewer) && !props.blobUrl && !imagePreviewUnavailable))
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
  const [openedEntry, setOpenedEntry] = useState<FileEntry | undefined>();
  const [selected, setSelected] = useState<FilePreview | undefined>();
  const [selectedBlobUrl, setSelectedBlobUrl] = useState<string | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialogState>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
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

  const activeRecord = accountState.accounts.find((record) => record.account.id === accountState.activeAccountId) ?? accountState.accounts[0];
  const activeAccount = activeRecord?.account;
  const token = activeRecord?.session?.token;
  const capabilities = activeRecord?.session?.capabilities;
  const backend = activeAccount?.backend;
  const cacheNamespace = activeAccount?.cacheNamespace;
  const fileSizeDisplayMode = uiSettings.fileSizeDisplayMode;
  const maxCacheableFileSizeBytes = uiSettings.maxCacheableFileSizeBytes;
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
      return;
    }
    void getOpenedFileCacheSummary(cacheNamespace).then(setCacheSummary);
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
    setMobileDetailsOpen(false);
    setCurrentPath("");
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

  const applyPreviewContent = (file: FilePreview, blob?: Blob) => {
    clearSelectedBlob();
    setSelected(file);
    if (blob) {
      setSelectedBlobUrl(URL.createObjectURL(blob));
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
      return;
    }
    setCacheSummary(await getOpenedFileCacheSummary(cacheNamespace));
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
    setShowAccountDialog(true);
  }

  function openReconnectDialog(record: StoredAccountRecord) {
    setAccountForm(buildReconnectForm(record));
    setAccountFormError(undefined);
    setShowAccountDialog(true);
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

  async function prefetchUpcomingMedia(startIndex: number) {
    if (!token || !cacheNamespace || !activeAccount || cacheOnlyMode || startIndex < 0) {
      return;
    }

    const upcomingItems = mediaItems.slice(startIndex + 1, startIndex + 1 + PREVIEW_PREFETCH_AHEAD_COUNT);
    await Promise.all(upcomingItems.map(async (item) => {
      try {
        const cached = await getCachedOpenedFile(cacheNamespace, item.path);
        if (canUseCachedPreview(cached)) {
          return;
        }

        const payload = await loadPreviewPayload(item.path, token);
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
    closePreview();
    setSelected(undefined);
    clearSelectedBlob();
    setSelectedEntry(undefined);
    setMobileDetailsOpen(false);
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
        setMobileDetailsOpen(true);
        return;
      }
      setSelectedEntry(undefined);
      setMobileDetailsOpen(false);
      return;
    }
    setSelectedEntry(entry);
    setMobileDetailsOpen(isNarrowScreen);
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
    if (getViewerKind(entry.mimeType) === "unsupported") {
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

    const applyCachedPreviewState = (cached: Awaited<ReturnType<typeof getCachedOpenedFile>>) => {
      if (!cached || !isCurrentPreviewRequest(requestId, requestAccountId, entry.path)) {
        return false;
      }
      applyPreviewContent(cached.entry.preview, cached.blob);
      setLoadingPreview(false);
      setPreviewError(undefined);
      setPreviewCacheState({
        source: "cache",
        cachedAt: cached.entry.cachedAt,
        refreshing: !cacheOnlyMode,
        stale: true,
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
      applyPreviewContent(payload.file, payload.blob);
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

    const handlePreviewFailure = (error: unknown, cached: Awaited<ReturnType<typeof getCachedOpenedFile>>) => {
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
        applyCachedPreviewState(cached);
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
    setOpenedEntry(entry);
    setPreviewOpen(true);
    setPreviewError(undefined);
    setMobileDetailsOpen(false);
    setPendingPreviewUpdate(undefined);
    setPreviewCacheState(DEFAULT_PREVIEW_CACHE_STATE);
    setSelected(undefined);
    clearSelectedBlob();

    const cached = await getCachedOpenedFile(cacheNamespace, entry.path);
    const usableCachedPreview = canUseCachedPreview(cached) ? cached : undefined;
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
      applyCachedPreviewState(usableCachedPreview);
      if (cacheOnlyMode) {
        return;
      }

      void (async () => {
        try {
          if (!token) {
            return;
          }
          const livePreview = await loadPreviewPayload(entry.path, token);
          if (livePreview.file.viewer === "unsupported") {
            await downloadUnsupportedFile(entry.path, displayPath, activeAccount.displayName);
            return;
          }
          await cacheOpenedFile(cacheNamespace, {
            path: entry.path,
            preview: livePreview.file,
            blob: livePreview.blob,
            mimeType: livePreview.mimeType,
            filename: livePreview.filename,
            maxBlobBytes: maxCacheableFileSizeBytes
          });
          await refreshCacheSummary();
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
          handlePreviewFailure(error, usableCachedPreview);
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
      const livePreview = await loadPreviewPayload(entry.path, token);
      if (livePreview.file.viewer === "unsupported") {
        await downloadUnsupportedFile(entry.path, displayPath, activeAccount.displayName);
        return;
      }
      await cacheOpenedFile(cacheNamespace, {
        path: entry.path,
        preview: livePreview.file,
        blob: livePreview.blob,
        mimeType: livePreview.mimeType,
        filename: livePreview.filename,
        maxBlobBytes: maxCacheableFileSizeBytes
      });
      await refreshCacheSummary();
      setWorkerUnavailable(false);
      applyLivePreviewState(livePreview, `Opened ${displayPath} in ${activeAccountName}`);
      void prefetchUpcomingMedia(mediaItems.findIndex((item) => item.path === entry.path));
    } catch (error) {
      handlePreviewFailure(error, usableCachedPreview);
    }
  };

  const syncSelectionWithMutation = (result: MutationResult) => {
    if (result.action === "delete") {
      setSelected(undefined);
      clearSelectedBlob();
      closePreview();
      setSelectedEntry(undefined);
      setMobileDetailsOpen(false);
      return;
    }

    if (!selectedEntry || !result.destinationPath) {
      if (result.item) {
        setSelectedEntry(result.item);
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
      setSelectedEntry(nextEntry);
      if (selected && selected.path === result.path) {
        setSelected({
          ...selected,
          path: result.destinationPath,
          name: nextName
        });
      }
    }
  };

  const executeMutation = async (runner: () => Promise<MutationResult>) => {
    if (!token || !activeAccount) {
      throw new Error("No session available for this action.");
    }
    if (cacheOnlyMode) {
      throw new Error(offline
        ? "Offline mutations are disabled. Reconnect to modify files."
        : "Mutations are disabled while the local server is unavailable. Restore the server and retry.");
    }

    setMutationBusy(true);
    setListError(undefined);
    try {
      const result = await runner();
      syncSelectionWithMutation(result);
      if (result.parentPath !== currentPath) {
        setCurrentPath(result.parentPath);
      } else {
        await loadFolder(result.parentPath, { preferCache: false });
      }
      setStatus(`${result.action} completed for ${toDisplayPath(result.destinationPath ?? result.path)} in ${activeAccountName}`);
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
      setMutationBusy(false);
    }
  };

  const handleCreateFolder = () => {
    setActionError(undefined);
    setActionDialog({ kind: "createFolder", value: "New folder" });
  };

  const handleUpload = async (files: FileList | File[] | null, source: "picker" | "drop" = "picker") => {
    if (!files || files.length === 0 || !token) {
      return;
    }

    try {
      for (const file of Array.from(files)) {
        const transferId = crypto.randomUUID();
        addTransferTask({
          id: transferId,
          kind: "upload",
          label: `${currentLocationLabel}/${file.name}`.replace(/\/{2,}/g, "/"),
          phase: "preparing",
          loadedBytes: 0,
          totalBytes: file.size
        });
        try {
          const contentBase64 = await readFileAsBase64WithProgress(file, (loadedBytes, totalBytes) => {
            updateTransferTask(transferId, { loadedBytes, totalBytes, phase: "preparing" });
          });

          updateTransferTask(transferId, { phase: "transferring", loadedBytes: 0, totalBytes: undefined });
          await executeMutation(() => uploadFileWithProgress(
            { path: currentPath, name: file.name, mimeType: file.type || "application/octet-stream", contentBase64 },
            token,
            (loadedBytes, totalBytes) => updateTransferTask(transferId, { loadedBytes, totalBytes, phase: "transferring" })
          ).then((response) => response.result));
          updateTransferTask(transferId, { phase: "done", finishedAt: new Date().toISOString() });
        } catch (error) {
          updateTransferTask(transferId, { phase: "error", finishedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : "Upload failed." });
          throw error;
        }
      }
      if (source === "drop") {
        setStatus(`Uploaded ${Array.from(files).length} item${Array.from(files).length === 1 ? "" : "s"} into ${currentLocationLabel} via drag and drop.`);
      }
    } catch (error) {
      if (!isUnauthorized(error)) {
        setListError(error instanceof Error ? error : new Error("Upload failed."));
      }
    }
  };

  const handleMove = () => {
    if (!selectedEntry) {
      return;
    }
    setMobileDetailsOpen(false);
    setActionError(undefined);
    setActionDialog({ kind: "move", value: selectedEntry.path });
  };

  const handleCopy = () => {
    if (!selectedEntry) {
      return;
    }
    setMobileDetailsOpen(false);
    setActionError(undefined);
    setActionDialog({ kind: "copy", value: `${selectedEntry.path}-copy` });
  };

  const handleDelete = () => {
    if (!selectedEntry) {
      return;
    }
    setMobileDetailsOpen(false);
    setActionError(undefined);
    setActionDialog({ kind: "delete", value: "" });
  };

  const submitActionDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !actionDialog) {
      return;
    }

    const trimmedValue = actionDialog.value.trim();
    if (!trimmedValue) {
      setActionError(actionDialog.kind === "delete" ? "Enter the exact selected file or folder name to delete it." : "Provide a value before continuing.");
      return;
    }

    setActionError(undefined);

    try {
      switch (actionDialog.kind) {
        case "createFolder":
          await executeMutation(() => createFolder({ path: currentPath, name: trimmedValue }, token).then((response) => response.result));
          break;
        case "move":
          if (!selectedEntry) {
            return;
          }
          await executeMutation(() => moveFile({ path: selectedEntry.path, destinationPath: trimmedValue }, token).then((response) => response.result));
          break;
        case "copy":
          if (!selectedEntry) {
            return;
          }
          await executeMutation(() => copyFile({ path: selectedEntry.path, destinationPath: trimmedValue }, token).then((response) => response.result));
          break;
        case "delete":
          if (!selectedEntry) {
            return;
          }
          await executeMutation(() => deleteFile({ path: selectedEntry.path, confirmName: trimmedValue }, token).then((response) => response.result));
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

  const handleClearCache = async () => {
    if (!cacheNamespace) {
      return;
    }
    await clearOpenedFileCache(cacheNamespace);
    clearFolderAndSearchCache(cacheNamespace);
    setSelected(undefined);
    clearSelectedBlob();
    setSelectedEntry(undefined);
    setMobileDetailsOpen(false);
    closePreview();
    await refreshCacheSummary();
    setStatus(activeAccount ? `Offline cache cleared for ${activeAccountName}.` : "Offline cache cleared.");
  };

  const searchActive = Boolean(searchQuery.trim());
  const visibleItems = useMemo(() => (searchActive ? searchResults : items) ?? [], [items, searchActive, searchResults]);
  const folderBanner = classifyState(listError, cacheOnlyMode, staleFolder, refreshingFolder, offline);
  const folderEnvelope = cacheNamespace ? readFolderCacheEnvelope<FileEntry[]>(cacheNamespace, currentPath) : undefined;
  const staleInfo = folderEnvelope ? `Cached ${formatCacheTimestamp(folderEnvelope.cachedAt)}` : undefined;
  const selectedPreview = selectedEntry && selected && selectedEntry.path === selected.path ? selected : undefined;
  const selectedDetails = selectedPreview ?? selectedEntry;
  const selectedFilePath = selectedDetails && !selectedDetails.isFolder ? selectedDetails.path : undefined;
  const selectedTypeLabel = selectedDetails
    ? selectedDetails.isFolder
      ? "Folder"
      : selectedPreview?.viewer
        ? viewerHeading(selectedPreview.viewer).replace(" preview", "")
        : normalizeMimeType(selectedDetails.mimeType) ?? "File"
    : undefined;
  const showMobileSelectionSheet = isNarrowScreen && Boolean(selectedDetails && mobileDetailsOpen);
  const detailsPanelLabel = selectedDetails ? `Details for ${selectedDetails.name}` : "Workspace details";
  const currentFolderLabel = currentPath ? currentPath.split("/").pop() ?? currentPath : "Home";
  const currentLocationLabel = toDisplayPath(currentPath);
  const itemCountLabel = `${visibleItems.length} ${visibleItems.length === 1 ? "item" : "items"}`;
  const resultCountLabel = `${visibleItems.length} ${visibleItems.length === 1 ? "result" : "results"}`;
  const browseStatusLabel = searchActive ? `${resultCountLabel} for “${searchQuery.trim()}” in ${currentLocationLabel}` : `${itemCountLabel} in ${currentLocationLabel}`;
  const canCreateFolder = !cacheOnlyMode && Boolean(capabilities?.createFolder);
  const canUploadFiles = !cacheOnlyMode && Boolean(capabilities?.upload);
  const canMoveSelected = !cacheOnlyMode && Boolean(capabilities?.move) && Boolean(selectedEntry);
  const canCopySelected = !cacheOnlyMode && Boolean(capabilities?.copy) && Boolean(selectedEntry);
  const canDeleteSelected = !cacheOnlyMode && Boolean(capabilities?.delete) && Boolean(selectedEntry);
  const canDownloadSelected = Boolean(capabilities?.download) && Boolean(selectedFilePath && token);
  const canOpenSelected = Boolean(selectedEntry);
  const listRecoveryAvailable = Boolean(listError) && !loadingFolder && !cacheOnlyMode;
  const activeAccountName = activeAccount?.displayName ?? "current account";
  const activeAccountHost = activeAccount ? new URL(activeAccount.baseUrl).hostname : undefined;
  const allowOfflineCachedShell = Boolean(cacheOnlyMode && activeAccount && cacheNamespace && canAttemptAutoRestore(activeAccount));
  const showAccountConnectPanel = !activeAccount || (activeAccount.connectionState === "reconnect_required" && autoRestorePausedForAccountId === activeAccount.id);
  const showUnlockPanel = Boolean(activeAccount && !token && activeAccount.connectionState === "connected" && unlockRequired && !healthLoading);
  const mediaItems = useMemo(() => visibleItems.filter((item) => !item.isFolder && isMediaGalleryViewer(getViewerKind(item.mimeType))), [visibleItems]);
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

    return (
      <header className={`app-bar${compactMobileHeader ? " app-bar-compact" : ""}`}>
        <div className="app-bar-brand">
          <div aria-hidden="true" className="app-logo">D</div>
          <div className="app-bar-brand-copy">
            <h1>Davora</h1>
            {!compactMobileHeader ? <p className="status app-bar-subtitle">{supportText}</p> : null}
          </div>
        </div>
        <div className="app-bar-actions">
          {(token && pwaPrompt.installAvailable) || accountState.accounts.length > 0 ? (
            <div className="app-bar-contextual-actions">
              {token && pwaPrompt.installAvailable ? <button className="quiet-button app-install-button" disabled={pwaPrompt.installing} onClick={() => void pwaPrompt.installApp()} type="button">{pwaPrompt.installing ? "Installing…" : "Install app"}</button> : null}
              {accountState.accounts.length > 0 ? <button onClick={() => setShowSettingsDialog(true)} type="button">Profile & settings</button> : null}
            </div>
          ) : null}
          {accountState.accounts.length > 0 ? (
            <TransferTray
              onClearFinished={clearFinishedTransfers}
              onToggleOpen={() => setTransferOpen((previous) => !previous)}
              open={transferOpen}
              tasks={transferTasks}
            />
          ) : null}
          {showHeaderStatusBadge ? <div className={`badge ${cacheOnlyMode ? "offline" : "online"}`}>{offline ? "Offline" : workerUnavailable ? "Server unavailable" : "Online"}</div> : null}
        </div>
      </header>
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
        <StateBanner kind={loadingFolder ? "loading" : folderBanner.kind} message={loadingFolder ? "Loading folder…" : folderBanner.message} />
      </div>

      <main className="workspace-layout">
        <section className="file-browser-panel">
          <section className="browse-header panel panel-subtle">
            <div className="browse-header-main">
              <div className="browse-title-row">
                <div>
                  <p className="eyebrow section-eyebrow">Files</p>
                  <h2>{currentFolderLabel}</h2>
                </div>
                <span className={`operation-pill ${cacheOnlyMode ? "disabled" : refreshingFolder || staleFolder || searchActive ? "secondary" : "enabled"}`}>{cacheOnlyMode ? "Read-only" : refreshingFolder ? "Refreshing" : staleFolder ? "Cached" : searchActive ? "Search active" : "Ready"}</span>
              </div>


              <nav aria-label="Breadcrumbs" className="breadcrumbs">
                {breadcrumbs(currentPath).map((item) => (
                  <div className="breadcrumb-segment" key={item.value || "root"}>
                    <button aria-label={item.ariaLabel} onClick={() => navigateToPath(item.value)} type="button">
                      {item.label}
                    </button>
                    {item.value !== currentPath ? <span aria-hidden="true" className="breadcrumb-separator">/</span> : null}
                  </div>
                ))}
              </nav>

              <div className="browse-context-row">
                <span className="status">{browseStatusLabel}</span>
                {staleInfo ? <span className="status">• {staleInfo}</span> : null}
                {searchActive ? <button className="quiet-button" onClick={() => setSearchQuery("")} type="button">Clear search</button> : null}
              </div>
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
                <button disabled={!canCreateFolder || mutationBusy} onClick={handleCreateFolder} type="button">Create folder</button>
                <label className={`upload-label ${!canUploadFiles || mutationBusy ? "disabled" : ""}`}>
                  Upload file
                  <input
                    aria-label="Upload file"
                    disabled={!canUploadFiles || mutationBusy}
                    onChange={(event) => {
                      void handleUpload(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
              </div>
              <p className={`status drop-upload-note${folderDropActive ? " active" : ""}`}>{canUploadFiles ? `Tip: drag and drop files anywhere in this folder view to upload into ${currentLocationLabel}.` : cacheOnlyMode ? "Uploads are unavailable while cached-shell mode is active." : "Uploads are unavailable when this account is read-only."}</p>
            </div>
          </section>

          <section
            className={`file-list-panel${folderDropActive ? " file-list-panel-drop-active" : ""}`}
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
              <span>Name</span>
              <span>Modified</span>
              <span>Size</span>
              <span>Info</span>
            </div>

            <ul className="file-list-items">
              {visibleItems.map((item) => {
                const isSelected = selectedEntry?.path === item.path;
                const openLabel = `${item.isFolder ? "Open folder" : "Open file"} ${item.name}`;
                const detailLabel = `${isSelected ? "Hide" : "Show"} details for ${item.name}`;

                return (
                  <li key={item.path}>
                    <div className={`item-row ${isSelected ? "selected" : ""}`}>
                      <button
                        aria-label={openLabel}
                        className="item-open-button"
                        onClick={() => {
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
                      <span className="meta item-secondary item-modified">{item.lastModified ?? "—"}</span>
                      <span className="meta item-secondary item-size">{item.isFolder ? "—" : formatBytes(item.size, fileSizeDisplayMode)}</span>
                      <button
                        aria-label={detailLabel}
                        aria-pressed={isSelected}
                        className={`item-select-button ${isSelected ? "active" : ""}`}
                        onClick={() => toggleEntrySelection(item)}
                        type="button"
                      >
                        {isSelected ? "Selected" : "Info"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {visibleItems.length === 0 ? (
              <div className="empty-state">
                <p className="empty empty-title">{listError ? (searchActive ? "Unable to load search results." : "Unable to load this folder.") : searchActive ? "No files match this search yet." : "This folder is empty."}</p>
                <p className="status">{listError ? listError.message : searchActive ? `Search scope: ${currentLocationLabel}` : `Location: ${currentLocationLabel}`}</p>
                <div className="empty-actions">
                  {searchActive ? <button onClick={() => setSearchQuery("")} type="button">Clear search</button> : null}
                  {listRecoveryAvailable ? <button onClick={() => void loadFolder(currentPath)} type="button">Retry folder</button> : null}
                </div>
              </div>
            ) : null}
          </section>
        </section>

        {showMobileSelectionSheet ? <button aria-label="Close details" className="details-sheet-scrim" onClick={() => setMobileDetailsOpen(false)} type="button" /> : null}

        <aside className="workspace-rail">
          <section
            aria-label={detailsPanelLabel}
            aria-modal={showMobileSelectionSheet ? "true" : undefined}
            className={`details-panel panel panel-subtle${showMobileSelectionSheet ? " details-panel-sheet-open" : ""}`}
            data-mobile-hidden={showMobileSelectionSheet ? "false" : "true"}
            role={showMobileSelectionSheet ? "dialog" : undefined}
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Details</p>
                <h2>{selectedDetails ? selectedDetails.isFolder ? "Selected folder" : "Selected file" : "Workspace details"}</h2>
              </div>
              {selectedDetails ? (
                showMobileSelectionSheet ? (
                  <div className="panel-header-actions">
                    <span className={`operation-pill ${offline ? "disabled" : "enabled"}`}>{offline ? "Read-only" : "Actions"}</span>
                    <button
                      onClick={() => {
                        setSelectedEntry(undefined);
                        setMobileDetailsOpen(false);
                      }}
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
                <dl className="metadata context-metadata">
                  <div>
                    <dt>Kind</dt>
                    <dd>{selectedTypeLabel}</dd>
                  </div>
                  <div>
                    <dt>Modified</dt>
                    <dd>{selectedDetails.lastModified ?? "Unknown"}</dd>
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
                    {selectedDetails.isFolder && selectedEntry ? <button onClick={() => navigateToPath(selectedEntry.path)} type="button">Open folder</button> : null}
                    {!selectedDetails.isFolder && selectedEntry ? <button onClick={() => void openFile(selectedEntry)} type="button">Open</button> : null}
                    {canDownloadSelected && selectedFilePath ? <button onClick={() => void startDownloadWithTransfer(selectedFilePath, toDisplayPath(selectedFilePath))} type="button">Download</button> : null}
                    <button disabled={!canMoveSelected || mutationBusy} onClick={handleMove} type="button">Rename or move</button>
                    <button disabled={!canCopySelected || mutationBusy} onClick={handleCopy} type="button">Copy</button>
                    <button className={canDeleteSelected ? "button-danger" : undefined} disabled={!canDeleteSelected || mutationBusy} onClick={handleDelete} type="button">Delete</button>
                  </div>
                </div>
              </>
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
        </aside>
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
        onActiveAccountChange={handleActiveAccountChange}
        onClearCache={() => void handleClearCache()}
        onClose={() => setShowSettingsDialog(false)}
        onDismissFromScrim={() => setShowSettingsDialog(false)}
        onMaxCacheableFileSizeChange={handleMaxCacheableFileSizeChange}
        onOpenAddAccount={openAddAccountFromSettings}
        onOpenReconnect={openReconnectFromSettings}
        onOpenRemove={openRemoveFromSettings}
        onOpenedFileCacheLimitChange={(limitBytes) => void handleCacheLimitChange(limitBytes)}
        open={showSettingsDialog}
      />

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

      {actionDialog?.kind === "move" && selectedEntry ? (
        <ActionDialog
          busy={mutationBusy}
          description="Save a new path for the selected item."
          error={actionError}
          label="New path"
          onChange={(value) => setActionDialog({ kind: "move", value })}
          onClose={() => setActionDialog(undefined)}
          onSubmit={(event) => void submitActionDialog(event)}
          submitLabel="Save"
          supportingText={`Selected: ${selectedEntry.path}`}
          title="Rename or move item"
          value={actionDialog.value}
        />
      ) : null}

      {actionDialog?.kind === "copy" && selectedEntry ? (
        <ActionDialog
          busy={mutationBusy}
          description="Create a copy at a new path."
          error={actionError}
          label="Copy destination path"
          onChange={(value) => setActionDialog({ kind: "copy", value })}
          onClose={() => setActionDialog(undefined)}
          onSubmit={(event) => void submitActionDialog(event)}
          submitLabel="Copy"
          supportingText={`Selected: ${selectedEntry.path}`}
          title="Copy item"
          value={actionDialog.value}
        />
      ) : null}

      {actionDialog?.kind === "delete" && selectedEntry ? (
        <ActionDialog
          busy={mutationBusy}
          danger
          description="This permanently removes the selected item."
          error={actionError}
          label="Name to confirm"
          onChange={(value) => setActionDialog({ kind: "delete", value })}
          onClose={() => setActionDialog(undefined)}
          onSubmit={(event) => void submitActionDialog(event)}
          submitLabel="Delete"
          supportingText={`Enter ${selectedEntry.name} to continue.`}
          title="Delete item"
          value={actionDialog.value}
        />
      ) : null}

      <PreviewModal
        blobUrl={selectedBlobUrl}
        cacheState={previewCacheState}
        entry={openedEntry}
        error={previewError}
        file={selected}
        fileSizeDisplayMode={fileSizeDisplayMode}
        loading={loadingPreview}
        offline={offline}
        workerUnavailable={workerUnavailable}
        onApplyRefresh={pendingPreviewUpdate ? applyPendingPreviewRefresh : undefined}
        onDownload={(path) => void startDownloadWithTransfer(path, toDisplayPath(path))}
        onNext={nextMediaItem ? () => openAdjacentMedia(1) : undefined}
        onPrevious={previousMediaItem ? () => openAdjacentMedia(-1) : undefined}
        onClose={closePreview}
        open={previewOpen}
        token={token}
      />
    </div>
  );
}
