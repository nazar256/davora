import { StateBanner } from "../../../components/StateBanner";

export interface RestoreSessionStageProps {
  readonly accountName: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly canRetryRestore: boolean;
  readonly onRetryRestore: () => void;
}

export function RestoreSessionStage(props: RestoreSessionStageProps) {
  return (
    <>
      <StateBanner
        kind={props.busy ? "loading" : props.error ? "error" : "idle"}
        message={props.busy ? `Restoring workspace access for ${props.accountName}…` : props.error ?? ""}
      />
      {!props.busy && props.canRetryRestore ? (
        <button onClick={props.onRetryRestore} type="button">
          Retry restore
        </button>
      ) : null}
    </>
  );
}
