import type { FormEvent } from "react";

import { useModalFocusBoundary } from "../../../components/useModalFocusBoundary";

export interface ActionDialogStageProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly danger?: boolean;
  readonly label?: string;
  readonly supportingText?: string;
  readonly targetText?: string;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
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

function ErrorBanner(props: { readonly message: string }) {
  return <p className="banner-state error">{props.message}</p>;
}

export function ActionDialogStage(props: ActionDialogStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open);
  if (!props.open) {
    return null;
  }

  return (
    <div className="modal-scrim" onClick={(event) => dismissOnScrimClick(event, props.onClose)} role="presentation">
      <section ref={dialogRef} aria-label={props.title} aria-modal="true" className="dialog-card panel action-dialog" role="dialog" tabIndex={-1}>
        <div className="dialog-header"><h2>{props.title}</h2></div>
        <form className="dialog-form" onSubmit={props.onSubmit}>
          <div className="dialog-scroll-body">
            <p className="subtitle dialog-copy">{props.description}</p>
            {props.supportingText ? <p className="status">{props.supportingText}</p> : null}
            {props.targetText ? <p className="dialog-target">{props.targetText}</p> : null}
            {props.error ? <ErrorBanner message={props.error} /> : null}
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
          </div>
          <div className="dialog-actions">
            <button autoFocus={!props.label} className="quiet-button" onClick={props.onClose} type="button">Cancel</button>
            <button className={props.danger ? "button-danger" : "ui-button primary"} disabled={props.busy} type="submit">{props.submitLabel}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
