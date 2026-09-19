import type { FormEvent } from "react";

import { StateBanner } from "../../../components/StateBanner";
import { useModalFocusBoundary } from "../../../components/useModalFocusBoundary";

export interface RemoveAccountStageProps {
  readonly open: boolean;
  readonly accountLabel: string;
  readonly confirmation: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly onConfirmationChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function dismissOnScrimClick(
  event: { currentTarget: EventTarget & Element; target: EventTarget | null },
  onDismiss: () => void
) {
  if (event.target === event.currentTarget) {
    onDismiss();
  }
}

export function RemoveAccountStage(props: RemoveAccountStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open);
  if (!props.open) {
    return null;
  }

  return (
    <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, props.onClose)} role="presentation">
      <section ref={dialogRef} aria-label={`Remove ${props.accountLabel}`} aria-modal="true" className="dialog-card panel" role="dialog" tabIndex={-1}>
        <div className="panel-header">
          <div>
            <p className="eyebrow section-eyebrow">Accounts</p>
            <h2>Remove account</h2>
          </div>
        </div>
        <p className="subtitle dialog-copy">Remove <strong>{props.accountLabel}</strong> from this browser and clear its account-scoped cache. Type the account label to confirm.</p>
        {props.error ? <StateBanner kind="error" message={props.error} /> : null}
        <form className="dialog-form" onSubmit={props.onSubmit}>
          <label>
            Account label to confirm
            <input
              aria-label="Account label to confirm"
              autoFocus
              disabled={props.busy}
              onChange={(event) => props.onConfirmationChange(event.target.value)}
              value={props.confirmation}
            />
          </label>
          <div className="dialog-actions">
            <button onClick={props.onClose} type="button">Cancel</button>
            <button className="button-danger" disabled={props.busy} type="submit">Remove account</button>
          </div>
        </form>
      </section>
    </div>
  );
}
