import { X } from "lucide-react";

import { StateBanner } from "../../../../components/StateBanner";
import { useModalFocusBoundary } from "../../../../components/useModalFocusBoundary";

export interface OfflineSyncConfirmStageProps {
  readonly open: boolean;
  readonly busy: boolean;
  readonly estimating: boolean;
  readonly selectionLabel: string;
  readonly includesFolders: boolean;
  readonly filesLabel: string;
  readonly storageLabel: string;
  readonly estimateError?: string;
  readonly canStart: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

function dismissOnScrimClick(
  event: { currentTarget: EventTarget & Element; target: EventTarget | null },
  onDismiss: () => void
) {
  if (event.target === event.currentTarget) {
    onDismiss();
  }
}

export function OfflineSyncConfirmStage(props: OfflineSyncConfirmStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open);
  if (!props.open) {
    return null;
  }

  const startDisabled = props.busy || !props.canStart;

  return (
    <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, () => !props.busy && props.onClose())} role="presentation">
      <section ref={dialogRef} aria-label="Keep offline confirmation" aria-modal="true" className="dialog-card panel offline-sync-dialog" role="dialog" tabIndex={-1}>
        <div className="dialog-header">
          <div>
            <p className="eyebrow section-eyebrow">Offline sync</p>
            <h2>Keep offline on this device</h2>
          </div>
          <button aria-label="Close keep offline confirmation" className="icon-button quiet-button" disabled={props.busy} onClick={props.onClose} title="Close" type="button"><X aria-hidden="true" /></button>
        </div>
        <div className="dialog-scroll-body">
          <p className="subtitle dialog-copy">
            Davora will store the selected content in this browser for offline access. This is local device storage and does not create a server-side copy.
          </p>
          <dl className="metadata context-metadata">
            <div>
              <dt>Selection</dt>
              <dd>{props.selectionLabel}</dd>
            </div>
            <div>
              <dt>Folders</dt>
              <dd>{props.includesFolders ? "Synced recursively" : "None selected"}</dd>
            </div>
            <div>
              <dt>Files</dt>
              <dd>{props.filesLabel}</dd>
            </div>
            <div>
              <dt>Estimated storage</dt>
              <dd>{props.storageLabel}</dd>
            </div>
          </dl>
          {props.estimateError ? <StateBanner kind="stale" message={`Storage size could not be calculated exactly: ${props.estimateError}. Confirm only if you still want to use local device storage.`} /> : null}
          {props.estimating ? <p className="status">You can start the sync now — the size keeps calculating in the background.</p> : null}
          <p className="status">Kept-offline files are excluded from normal automatic cache eviction and remain until you remove them from this device.</p>
        </div>
        <div className="dialog-actions">
          <button className="quiet-button" disabled={props.busy} onClick={props.onClose} type="button">Cancel</button>
          <button className="ui-button primary" disabled={startDisabled} onClick={props.onConfirm} type="button">{props.busy ? "Starting…" : "Start sync"}</button>
        </div>
      </section>
    </div>
  );
}
