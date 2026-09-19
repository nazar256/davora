import { useModalFocusBoundary } from "../../components/useModalFocusBoundary";
import type { FolderShortcutInstallState } from "./model";

export interface FolderShortcutStageProps {
  readonly open: boolean;
  readonly folderName: string;
  readonly displayPath: string;
  readonly accountName: string;
  readonly link: string;
  readonly linkCopied: boolean;
  readonly manualHint: string;
  readonly appShortcutEnabled: boolean;
  readonly installState: FolderShortcutInstallState;
  readonly onCopyLink: () => void;
  readonly onInstallAsApp: () => void;
  readonly onClose: () => void;
}

function dismissOnScrimClick(
  event: { currentTarget: EventTarget & Element; target: EventTarget | null },
  onDismiss: () => void
) {
  if (event.target === event.currentTarget) {
    onDismiss();
  }
}

function installStateLabel(state: FolderShortcutInstallState): string | undefined {
  switch (state) {
    case "requesting":
      return "Waiting for the browser install prompt…";
    case "accepted":
      return "Folder app installed.";
    case "declined":
      return "Install was dismissed.";
    case "unavailable":
      return "Install is not available in this browser.";
    case "idle":
      return undefined;
  }
}

export function FolderShortcutStage(props: FolderShortcutStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open);
  if (!props.open) {
    return null;
  }

  const installLabel = installStateLabel(props.installState);

  return (
    <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, props.onClose)} role="presentation">
      <section ref={dialogRef} aria-label="Folder shortcut" aria-modal="true" className="dialog-card panel folder-shortcut-dialog" role="dialog" tabIndex={-1}>
        <div className="dialog-header"><h2>Folder shortcut</h2></div>
        <div className="dialog-scroll-body">
          <p className="selection-name">{props.folderName}</p>
          <p className="status details-path">{props.displayPath}</p>
          <dl className="metadata context-metadata">
            <div>
              <dt>Account</dt>
              <dd>{props.accountName}</dd>
            </div>
          </dl>
          <label className="folder-shortcut-link">
            Folder link
            <input
              aria-label="Folder link"
              onFocus={(event) => event.target.select()}
              readOnly
              value={props.link}
            />
          </label>
          <p className="status">{props.manualHint}</p>
          {props.linkCopied ? <p className="status folder-shortcut-note">Link copied to the clipboard.</p> : null}
          {props.appShortcutEnabled ? (
            <div className="folder-shortcut-app-section">
              <p className="subtitle">Shortcut as app <span className="operation-pill disabled">Experimental</span></p>
              <p className="status">
                Installs this folder as a separate home-screen app. Support varies by browser;
                the manual link above always works.
              </p>
              {installLabel ? <p className="status folder-shortcut-note">{installLabel}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button className="quiet-button" onClick={props.onClose} type="button">Close</button>
          {props.appShortcutEnabled ? (
            <button
              disabled={props.installState === "requesting"}
              onClick={props.onInstallAsApp}
              type="button"
            >
              Shortcut as app
            </button>
          ) : null}
          <button className="ui-button primary" onClick={props.onCopyLink} type="button">Copy folder link</button>
        </div>
      </section>
    </div>
  );
}
