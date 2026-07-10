import type { ConnectedAccount } from "@davora/shared";
import { toDisplayPath } from "@davora/shared";

import { formatFileSize, type FileSizeDisplayMode } from "../lib/fileSize";
import { CachePanel } from "./CachePanel";

interface SettingsDialogProps {
  open: boolean;
  accounts: ConnectedAccount[];
  activeAccount?: ConnectedAccount;
  activeAccountId?: string;
  appBuildLabel: string;
  connectedAccountCount: number;
  offline: boolean;
  cacheSummary: {
    itemCount: number;
    totalBytes: number;
    limitBytes: number;
  };
  closeActionLabel: string;
  fileSizeDisplayMode: FileSizeDisplayMode;
  maxCacheableFileSizeBytes: number;
  previewFreshnessIntervalSeconds: number;
  offlineItems: Array<{
    rootPath: string;
    name: string;
    kind: "file" | "folder" | "batch";
    fileCount: number;
    totalBytes: number;
    addedAt?: string;
  }>;
  onClearCache: () => void;
  onRemoveOfflineItem: (rootPath: string) => void;
  onClose: () => void;
  onActiveAccountChange: (accountId: string) => void;
  onOpenAddAccount: () => void;
  onOpenReconnect: () => void;
  onOpenRemove: () => void;
  onOpenedFileCacheLimitChange: (limitBytes: number) => void;
  onMaxCacheableFileSizeChange: (limitBytes: number) => void;
  onPreviewFreshnessIntervalChange: (intervalSeconds: number) => void;
  showHiddenFiles: boolean;
  onShowHiddenFilesChange: (show: boolean) => void;
  experimentalHeicPreviewEnabled: boolean;
  onExperimentalHeicPreviewEnabledChange: (enabled: boolean) => void;
  onDismissFromScrim?: () => void;
}

function getAccountHost(account: ConnectedAccount | undefined): string | undefined {
  if (!account) {
    return undefined;
  }

  try {
    return new URL(account.baseUrl).hostname;
  } catch {
    return account.baseUrl;
  }
}

export function SettingsDialog(props: SettingsDialogProps) {
  if (!props.open) {
    return null;
  }

  const activeAccountLabel = props.activeAccount?.label ?? props.activeAccount?.displayName ?? "No active account";
  const activeAccountHost = getAccountHost(props.activeAccount);
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
      <section aria-label="Profile and settings" aria-modal="true" className="dialog-card panel settings-dialog" role="dialog">
        <div className="settings-dialog-header">
          <div className="settings-dialog-heading">
            <p className="eyebrow section-eyebrow">Profile</p>
            <h2>Profile & settings</h2>
          </div>
          <button className="quiet-button settings-close-button" onClick={props.onClose} type="button">{props.closeActionLabel}</button>
        </div>
        <p className="subtitle settings-dialog-subtitle">Keep account switching, connection status, and cache controls behind this surface so files stay visually dominant.</p>

        <div className="settings-grid">
          <section className="settings-section panel panel-subtle">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Account</p>
                <h3>{activeAccountLabel}</h3>
              </div>
              {props.activeAccount ? (
                <span className={`operation-pill ${props.activeAccount.connectionState === "reconnect_required" ? "disabled" : "enabled"}`}>
                  {props.activeAccount.connectionState === "reconnect_required" ? "Reconnect required" : "Connected"}
                </span>
              ) : null}
            </div>
            <p className="status">The main shell stays focused on files while account switching and connection status live here when you need them.</p>
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
                <dd>{props.activeAccount?.username ?? "—"}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{props.activeAccount?.baseUrl ?? "—"}</dd>
              </div>
              <div>
                <dt>Host</dt>
                <dd>{activeAccountHost ?? "—"}</dd>
              </div>
              <div>
                <dt>Workspace status</dt>
                <dd>{props.offline ? "Offline" : "Online"}</dd>
              </div>
              <div>
                <dt>Root</dt>
                <dd>{toDisplayPath(props.activeAccount?.rootPath ?? "")}</dd>
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
              <button onClick={props.onOpenAddAccount} type="button">Add account</button>
              {props.activeAccount ? <button onClick={props.onOpenReconnect} type="button">Reconnect</button> : null}
              {props.activeAccount ? <button className="button-danger" onClick={props.onOpenRemove} type="button">Remove</button> : null}
            </div>
          </section>

          <CachePanel
            fileSizeDisplayMode={props.fileSizeDisplayMode}
            itemCount={props.cacheSummary.itemCount}
            limitBytes={props.cacheSummary.limitBytes}
            maxCacheableFileSizeBytes={props.maxCacheableFileSizeBytes}
            offlineItems={props.offlineItems}
            previewFreshnessIntervalSeconds={props.previewFreshnessIntervalSeconds}
            onClear={props.onClearCache}
            onLimitChange={props.onOpenedFileCacheLimitChange}
            onMaxCacheableFileSizeChange={props.onMaxCacheableFileSizeChange}
            onRemoveOfflineItem={props.onRemoveOfflineItem}
            onPreviewFreshnessIntervalChange={props.onPreviewFreshnessIntervalChange}
            totalBytes={props.cacheSummary.totalBytes}
          />

          <section className="settings-section panel panel-subtle">
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

          <section className="settings-section panel panel-subtle">
            <div className="panel-header">
              <div>
                <p className="eyebrow section-eyebrow">Experimental</p>
                <h3>Preview labs</h3>
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
          </section>
        </div>
      </section>
    </div>
  );
}
