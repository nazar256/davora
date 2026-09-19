import type { FormEvent } from "react";

import { StateBanner } from "../../../components/StateBanner";
import type { AccountFormState } from "./model";

export interface AccountFormStageProps {
  readonly form: AccountFormState;
  readonly busy: boolean;
  readonly error?: string;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly onChange: (next: AccountFormState) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onCancel?: () => void;
}

export function AccountFormStage(props: AccountFormStageProps) {
  return (
    <form className="account-form" onSubmit={props.onSubmit}>
      <div className="account-form-heading">
        <span className="operation-pill secondary">Nextcloud</span>
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
          Root folder (optional)
          <input
            aria-label="Root folder"
            disabled={props.busy}
            onChange={(event) => props.onChange({ ...props.form, rootPath: event.target.value })}
            placeholder="Account root (/)"
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
      <p className="status">The app password is used only to connect and is not stored in this browser.</p>
      <div className="dialog-actions">
        {props.onCancel ? <button className="quiet-button" disabled={props.busy} onClick={props.onCancel} type="button">Cancel</button> : null}
        <button className="ui-button primary" disabled={props.busy} type="submit">{props.submitLabel}</button>
      </div>
    </form>
  );
}
