import { StateBanner } from "../../../components/StateBanner";

export interface UnlockPanelStageProps {
  readonly accountName: string;
  readonly accountHost: string;
  readonly unlockCode: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly onChange: (next: string) => void;
  readonly onSubmit: () => void;
}

export function UnlockPanelStage(props: UnlockPanelStageProps) {
  return (
    <section className="panel bootstrap-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow section-eyebrow">Session</p>
          <h2>Unlock required</h2>
        </div>
        {props.busy ? <span className="operation-pill enabled">Connecting</span> : null}
      </div>
      <p className="unlock-copy">
        Connected account: <strong>{props.accountName}</strong> ({props.accountHost})
      </p>
      <StateBanner
        kind={props.busy ? "loading" : props.error ? "error" : "idle"}
        message={props.busy ? "Submitting unlock code…" : props.error ?? ""}
      />
      <form
        className="unlock-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <label>
          Unlock code
          <input
            aria-label="Unlock code"
            autoComplete="one-time-code"
            disabled={props.busy}
            onChange={(event) => props.onChange(event.target.value)}
            placeholder="Enter deployment unlock code"
            type="password"
            value={props.unlockCode}
          />
        </label>
        <button disabled={props.busy} type="submit">
          Unlock and connect
        </button>
      </form>
    </section>
  );
}
