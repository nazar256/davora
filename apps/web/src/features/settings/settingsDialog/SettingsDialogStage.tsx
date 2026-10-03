import type { ConnectedAccount } from "@davora/shared";
import { toDisplayPath } from "@davora/shared";

import type { FileSizeDisplayMode } from "../../../lib/fileSize";
import { useModalFocusBoundary } from "../../../components/useModalFocusBoundary";
import type { ScreenWakeLockState } from "../../offline/wakeLock";
import type { ImagePreviewPrefetchCount, ThemeMode } from "../model";
import { CachePanel, type CachePanelProps } from "./CachePanel";

export interface SettingsDialogStageProps {
  open: boolean;
  accounts: ConnectedAccount[];
  activeAccount?: ConnectedAccount;
  managementActiveAccount?: ConnectedAccount;
  pendingRemovalAccounts?: Array<{
    account: ConnectedAccount;
    phase: "revoke" | "purge";
  }>;
  activeAccountId?: string;
  appBuildLabel: string;
  connectedAccountCount: number;
  offline: boolean;
  backendActionsDisabled?: boolean;
  cacheSummary: {
    itemCount: number;
    totalBytes: number;
    limitBytes: number;
  };
  closeActionLabel: string;
  fileSizeDisplayMode: FileSizeDisplayMode;
  themeMode: ThemeMode;
  maxCacheableFileSizeBytes: number;
  previewFreshnessIntervalSeconds: number;
  imagePreviewPrefetchCount: ImagePreviewPrefetchCount;
  keepAwakeEnabled: boolean;
  keepAwakeState: ScreenWakeLockState;
  offlineItems: CachePanelProps["offlineItems"];
  retainedBytes?: number;
  storageScope?: string;
  estimateStorage?: CachePanelProps["estimateStorage"];
  retryDisabled?: boolean;
  onRetryOfflineItem?: (rootId: string) => void;
  onClearCache: () => void;
  onRemoveOfflineItem: (rootId: string) => void;
  onClose: () => void;
  onActiveAccountChange: (accountId: string) => void;
  onOpenAddAccount: () => void;
  onOpenReconnect: () => void;
  onOpenRemove: () => void;
  onOpenedFileCacheLimitChange: (limitBytes: number) => void;
  onMaxCacheableFileSizeChange: (limitBytes: number) => void;
  onPreviewFreshnessIntervalChange: (intervalSeconds: number) => void;
  onImagePreviewPrefetchCountChange: (count: ImagePreviewPrefetchCount) => void;
  onKeepAwakeEnabledChange: (enabled: boolean) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  showHiddenFiles: boolean;
  onShowHiddenFilesChange: (show: boolean) => void;
  experimentalHeicPreviewEnabled: boolean;
  onExperimentalHeicPreviewEnabledChange: (enabled: boolean) => void;
  experimentalFolderAppShortcutsEnabled: boolean;
  onExperimentalFolderAppShortcutsEnabledChange: (enabled: boolean) => void;
  diagnosticsEnabled: boolean;
  onDiagnosticsEnabledChange: (enabled: boolean) => void;
  diagnostics: {
    readonly storageSummary?: string;
    readonly onOpenReport: () => void;
    readonly onClearData: () => void;
  };
  onDismissFromScrim?: () => void;
}

export function SettingsDialogStage(props: SettingsDialogStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open);
  if (!props.open) {
    return null;
  }

  const managementActiveAccount = props.managementActiveAccount ?? props.activeAccount;
  const managementActiveRemovalPending = managementActiveAccount
    ? props.pendingRemovalAccounts?.some((pending) => pending.account.id === managementActiveAccount.id) ?? false
    : false;
  const activeAccountLabel = managementActiveAccount?.label ?? managementActiveAccount?.displayName ?? "No active account";
  const selectedAccountId = props.activeAccount?.id ?? props.activeAccountId ?? props.accounts[0]?.id ?? "";

  return (
    <div
      className="modal-scrim settings-modal-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          (props.onDismissFromScrim ?? props.onClose)();
        }
      }}
      role="presentation"
    >
      <section ref={dialogRef} aria-label="Profile and settings" aria-modal="true" className="dialog-card panel settings-dialog" role="dialog" tabIndex={-1}>
        <div className="settings-dialog-header">
          <div className="settings-dialog-heading">
            <h2>Profile & settings</h2>
          </div>
          <button className="quiet-button settings-close-button" onClick={props.onClose} type="button">{props.closeActionLabel}</button>
        </div>

        <div className="settings-grid">
          <section className="settings-section appearance-settings-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Appearance</p>
                <h3>Theme</h3>
              </div>
            </div>
            <div aria-label="Theme" className="theme-mode-control" role="group">
              {(["system", "light", "dark"] as const).map((mode) => (
                <button
                  aria-pressed={props.themeMode === mode}
                  key={mode}
                  onClick={() => props.onThemeModeChange(mode)}
                  type="button"
                >{mode[0].toUpperCase() + mode.slice(1)}</button>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Account</p>
                <h3>{activeAccountLabel}</h3>
              </div>
              {props.activeAccount ? (
                <span className={`operation-pill ${props.activeAccount.connectionState === "reconnect_required" ? "disabled" : "enabled"}`}>
                  {props.activeAccount.connectionState === "reconnect_required" ? "Reconnect required" : "Connected"}
                </span>
              ) : managementActiveAccount ? <span className="operation-pill disabled">Removal pending</span> : null}
            </div>
            <label className="stacked-field">
              <span className="summary-label">Active account</span>
              <select aria-label="Active account" onChange={(event) => props.onActiveAccountChange(event.target.value)} value={selectedAccountId}>
                {props.accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.displayName}</option>
                ))}
              </select>
            </label>
            <dl className="metadata context-metadata">
              <div>
                <dt>Username</dt>
                <dd>{managementActiveAccount?.username ?? "—"}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{managementActiveAccount?.baseUrl ?? "—"}</dd>
              </div>
              <div>
                <dt>Workspace status</dt>
                <dd>{props.offline ? "Offline" : "Online"}</dd>
              </div>
              <div>
                <dt>Root</dt>
                <dd>{toDisplayPath(managementActiveAccount?.rootPath ?? "")}</dd>
              </div>
              <div>
                <dt>Connected accounts</dt>
                <dd>{props.connectedAccountCount}</dd>
              </div>
              <div>
                <dt>App build</dt>
                <dd data-testid="app-build-label">{props.appBuildLabel}</dd>
              </div>
            </dl>
            <div className="context-actions">
              <button disabled={props.backendActionsDisabled} onClick={props.onOpenAddAccount} type="button">Add account</button>
              {props.activeAccount ? <button disabled={props.backendActionsDisabled} onClick={props.onOpenReconnect} type="button">Reconnect</button> : null}
              {managementActiveAccount ? <button className="button-danger" disabled={props.backendActionsDisabled} onClick={props.onOpenRemove} type="button">{managementActiveRemovalPending ? "Retry removal" : "Remove"}</button> : null}
            </div>
            {props.backendActionsDisabled ? <p className="status">Account changes require online mode.</p> : null}
            {props.pendingRemovalAccounts?.map((pending) => (
              <p className="status" key={pending.account.id}>
                Removal pending for <strong>{pending.account.displayName}</strong> ({pending.phase === "revoke" ? "remote revoke" : "browser cleanup"}). Use Retry removal to continue.
              </p>
            ))}
          </section>

          <CachePanel
            fileSizeDisplayMode={props.fileSizeDisplayMode}
            itemCount={props.cacheSummary.itemCount}
            limitBytes={props.cacheSummary.limitBytes}
            maxCacheableFileSizeBytes={props.maxCacheableFileSizeBytes}
            offlineItems={props.offlineItems}
            retainedBytes={props.retainedBytes}
            storageScope={props.storageScope}
            estimateStorage={props.estimateStorage}
            retryDisabled={props.retryDisabled || props.offline || props.backendActionsDisabled}
            onRetryOfflineItem={props.onRetryOfflineItem}
            previewFreshnessIntervalSeconds={props.previewFreshnessIntervalSeconds}
            imagePreviewPrefetchCount={props.imagePreviewPrefetchCount}
            onClear={props.onClearCache}
            onLimitChange={props.onOpenedFileCacheLimitChange}
            onMaxCacheableFileSizeChange={props.onMaxCacheableFileSizeChange}
            onRemoveOfflineItem={props.onRemoveOfflineItem}
            onPreviewFreshnessIntervalChange={props.onPreviewFreshnessIntervalChange}
            onImagePreviewPrefetchCountChange={props.onImagePreviewPrefetchCountChange}
            totalBytes={props.cacheSummary.totalBytes}
          />

          <section className="settings-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Power</p>
                <h3>Active work</h3>
              </div>
            </div>
            <label className="stacked-field">
              <span className="summary-label">Keep screen awake during active work</span>
              <div className="cache-limit-manual-row">
                <input
                  aria-label="Keep screen awake during active work"
                  checked={props.keepAwakeEnabled}
                  onChange={(event) => props.onKeepAwakeEnabledChange(event.target.checked)}
                  type="checkbox"
                />
                <span className="status">
                  {props.keepAwakeState === "active"
                    ? "Active while media or transfers are running."
                    : props.keepAwakeState === "requesting"
                      ? "Requesting screen wake lock."
                      : props.keepAwakeState === "unsupported"
                        ? "Unavailable in this browser; work continues normally."
                        : props.keepAwakeState === "denied"
                          ? "Not granted by the browser; work continues normally."
                          : props.keepAwakeState === "disabled"
                            ? "Disabled on this device."
                            : "Ready for media playback and transfers."}
                </span>
              </div>
            </label>
          </section>

          <section className="settings-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">View</p>
                <h3>Browse preferences</h3>
              </div>
            </div>
            <label className="stacked-field">
              <span className="summary-label">Show hidden files and folders</span>
              <div className="cache-limit-manual-row">
                <input
                  aria-label="Show hidden files and folders"
                  checked={props.showHiddenFiles}
                  onChange={(event) => props.onShowHiddenFilesChange(event.target.checked)}
                  type="checkbox"
                />
                <span className="status">Reveal dot-prefixed items such as .DS_Store and .directory in file lists.</span>
              </div>
            </label>
          </section>

          <section className="settings-section diagnostics-settings-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Support</p>
                <h3>Diagnostics</h3>
              </div>
            </div>
            <label className="stacked-field">
              <span className="summary-label">Diagnostic logging</span>
              <div className="cache-limit-manual-row">
                <input
                  aria-label="Diagnostic logging"
                  checked={props.diagnosticsEnabled}
                  onChange={(event) => props.onDiagnosticsEnabledChange(event.target.checked)}
                  type="checkbox"
                />
                <span className="status">
                  Collect local diagnostic events so you can create a bug report with useful
                  technical context. Data stays on this device until you explicitly export or
                  share a report.
                </span>
              </div>
            </label>
            {props.diagnostics.storageSummary ? (
              <p className="status" data-testid="diagnostics-storage-summary">{props.diagnostics.storageSummary}</p>
            ) : null}
            <div className="context-actions">
              {props.diagnosticsEnabled ? (
                <button onClick={props.diagnostics.onOpenReport} type="button">Create bug report</button>
              ) : null}
              <button onClick={props.diagnostics.onClearData} type="button">Delete stored diagnostics</button>
            </div>
          </section>

          <section className="settings-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Experimental</p>
                <h3>Feature labs</h3>
              </div>
            </div>
            <label className="stacked-field">
              <span className="summary-label">Enable experimental HEIC preview</span>
              <div className="cache-limit-manual-row">
                <input
                  aria-label="Enable experimental HEIC preview"
                  checked={props.experimentalHeicPreviewEnabled}
                  onChange={(event) => props.onExperimentalHeicPreviewEnabledChange(event.target.checked)}
                  type="checkbox"
                />
                <span className="status">Decode HEIC/HEIF photos locally in this browser when possible. Original files and downloads stay unchanged.</span>
              </div>
            </label>
            <label className="stacked-field">
              <span className="summary-label">Shortcut as app</span>
              <div className="cache-limit-manual-row">
                <input
                  aria-label="Shortcut as app"
                  checked={props.experimentalFolderAppShortcutsEnabled}
                  onChange={(event) => props.onExperimentalFolderAppShortcutsEnabledChange(event.target.checked)}
                  type="checkbox"
                />
                <span className="status">Offer a per-folder installable app shortcut when the browser supports it. Behaviour varies by browser and can add several launcher entries.</span>
              </div>
            </label>
          </section>
        </div>
      </section>
    </div>
  );
}
