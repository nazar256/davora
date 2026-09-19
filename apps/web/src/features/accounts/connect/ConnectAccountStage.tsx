import type { FormEvent } from "react";

import { assertNever } from "@davora/shared";

import { AccountFormStage } from "./AccountFormStage";
import type { AccountFormState } from "./model";

export type ConnectAccountStageVariant = "zero" | "connect" | "reconnect";

export interface ConnectAccountStageProps {
  readonly variant: ConnectAccountStageVariant;
  readonly form: AccountFormState;
  readonly busy: boolean;
  readonly error?: string;
  readonly onChange: (next: AccountFormState) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly showForm?: boolean;
  readonly onRevealForm?: () => void;
  readonly accountName?: string;
}

function resolveFormPresentation(variant: ConnectAccountStageVariant, accountName?: string) {
  switch (variant) {
    case "zero":
      return {
        title: "Connect Nextcloud account",
        description:
          "Enter your Nextcloud base URL, username, app password, and the root folder to browse. An optional label helps when you manage multiple accounts.",
        submitLabel: "Connect account"
      };
    case "connect":
      return {
        title: "Connect account",
        description: "Connect a Nextcloud account to continue.",
        submitLabel: "Connect account"
      };
    case "reconnect":
      return {
        title: `Reconnect ${accountName ?? ""}`.trim(),
        description:
          "The Worker no longer has this account ready. Re-enter the app password to reconnect it without changing browser-side cache namespaces.",
        submitLabel: "Reconnect account"
      };
    default:
      return assertNever(variant, "connect account stage variant");
  }
}

export function ConnectAccountStage(props: ConnectAccountStageProps) {
  const presentation = resolveFormPresentation(props.variant, props.accountName);

  if (props.variant === "zero") {
    return (
      <section className="panel zero-state-panel">
        <p className="eyebrow section-eyebrow">Accounts</p>
        <h2>No connected accounts yet</h2>
        <p className="subtitle">
          Connect a Nextcloud account inside Davora to start browsing files. You can add more accounts later and switch between them without mixing
          cache state.
        </p>
        {!props.showForm ? (
          <button onClick={props.onRevealForm} type="button">
            Connect account
          </button>
        ) : null}
        {props.showForm ? (
          <AccountFormStage
            busy={props.busy}
            description={presentation.description}
            error={props.error}
            form={props.form}
            onChange={props.onChange}
            onSubmit={props.onSubmit}
            submitLabel={presentation.submitLabel}
            title={presentation.title}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="panel bootstrap-panel">
      <AccountFormStage
        busy={props.busy}
        description={presentation.description}
        error={props.error}
        form={props.form}
        onChange={props.onChange}
        onSubmit={props.onSubmit}
        submitLabel={presentation.submitLabel}
        title={presentation.title}
      />
    </section>
  );
}
