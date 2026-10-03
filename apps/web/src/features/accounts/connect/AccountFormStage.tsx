import type { FormEvent } from "react";
import { Info } from "lucide-react";

import { StateBanner } from "../../../components/StateBanner";
import type { AccountFormState } from "./model";

const NEXTCLOUD_HELP_URL = "https://docs.nextcloud.com/server/stable/user_manual/en/session_management.html";

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
            placeholder="Default folder"
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
      <p className="status">Davora saves your app password encrypted on the server, not in browser storage.</p>
      <details className="account-form-help">
        <summary aria-label="Connection help">
          <Info aria-hidden="true" size={18} strokeWidth={2} />
        </summary>
        <dl className="account-form-help-content">
          <div>
            <dt>Server</dt>
            <dd>Use your Nextcloud address, including any installation path, without a file or share link.</dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd>Use your Nextcloud username, which may differ from your display name.</dd>
          </div>
          <div>
            <dt>App password</dt>
            <dd>
              In Nextcloud, open Personal settings → Security and create an app password named Davora. {" "}
              <a
                aria-label="Nextcloud help (opens in a new tab)"
                href={NEXTCLOUD_HELP_URL}
                rel="noopener noreferrer"
                target="_blank"
              >
                Nextcloud help
              </a>
            </dd>
          </div>
          <div>
            <dt>Root folder</dt>
            <dd>
              Optional folder inside Nextcloud, such as Projects. Leave blank for the default folder. If connection fails, check that this folder exists and you can open it in Nextcloud.
            </dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>Remove the account to delete Davora’s saved password. To revoke it in Nextcloud too, remove its app password in Security.</dd>
          </div>
        </dl>
      </details>
      <div className="dialog-actions">
        {props.onCancel ? <button className="quiet-button" disabled={props.busy} onClick={props.onCancel} type="button">Cancel</button> : null}
        <button className="ui-button primary" disabled={props.busy} type="submit">{props.submitLabel}</button>
      </div>
    </form>
  );
}
