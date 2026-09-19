import type { FormEvent } from "react";

import { useModalFocusBoundary } from "../../../components/useModalFocusBoundary";
import { AccountFormStage } from "./AccountFormStage";
import type { AccountFormState } from "./model";

export type ConnectAccountDialogVariant = "add" | "reconnect";

export interface ConnectAccountDialogStageProps {
  readonly open: boolean;
  readonly variant: ConnectAccountDialogVariant;
  readonly form: AccountFormState;
  readonly busy: boolean;
  readonly error?: string;
  readonly onChange: (next: AccountFormState) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onCancel: () => void;
}

function resolveDialogPresentation(variant: ConnectAccountDialogVariant) {
  switch (variant) {
    case "add":
      return {
        ariaLabel: "Add account",
        title: "Add Nextcloud account",
        description: "Connect another Nextcloud account without disturbing the current file-manager workspace design.",
        submitLabel: "Add account"
      };
    case "reconnect":
      return {
        ariaLabel: "Reconnect account",
        title: "Reconnect account",
        description: "Re-enter the app password so this account can create fresh sessions again.",
        submitLabel: "Reconnect account"
      };
  }
}

function dismissOnScrimClick(
  event: { readonly currentTarget: EventTarget & Element; readonly target: EventTarget | null },
  onDismiss: () => void
) {
  if (event.target === event.currentTarget) {
    onDismiss();
  }
}

export function ConnectAccountDialogStage(props: ConnectAccountDialogStageProps) {
  const dialogRef = useModalFocusBoundary<HTMLElement>(props.open, props.onCancel);
  if (!props.open) {
    return null;
  }

  const presentation = resolveDialogPresentation(props.variant);
  return (
    <div
      className="modal-scrim"
      onClick={(event) => dismissOnScrimClick(event, props.onCancel)}
      role="presentation"
    >
      <section ref={dialogRef} aria-label={presentation.ariaLabel} aria-modal="true" className="dialog-card panel" role="dialog" tabIndex={-1}>
        <AccountFormStage
          busy={props.busy}
          description={presentation.description}
          error={props.error}
          form={props.form}
          onCancel={props.onCancel}
          onChange={props.onChange}
          onSubmit={props.onSubmit}
          submitLabel={presentation.submitLabel}
          title={presentation.title}
        />
      </section>
    </div>
  );
}
