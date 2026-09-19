import type { ReactNode } from "react";

import { assertNever } from "@davora/shared";

import { StateBanner } from "../../../components/StateBanner";
import { ConnectAccountStage, type ConnectAccountStageProps } from "../connect";
import { RestoreSessionStage, type RestoreSessionStageProps } from "../restore";
import { UnlockPanelStage, type UnlockPanelStageProps } from "../unlock";

import {
  shouldMountBootstrapNavDrawer,
  shouldShowBootstrapErrorBanner,
  type AccountBootstrapGate
} from "./model";

export interface AccountBootstrapShellProps {
  readonly gate: AccountBootstrapGate;
  readonly reloadPrompt: ReactNode;
  readonly appBar: ReactNode;
  readonly navDrawer?: ReactNode;
  readonly bootstrapError?: string;
  readonly connectStage?: ConnectAccountStageProps;
  readonly unlockStage?: UnlockPanelStageProps;
  readonly restoreStage?: RestoreSessionStageProps;
}

export function AccountBootstrapShell(props: AccountBootstrapShellProps) {
  if (props.gate.kind === "continue") {
    return null;
  }

  return (
    <div className="shell">
      {props.reloadPrompt}
      {props.appBar}
      {shouldMountBootstrapNavDrawer(props.gate) ? props.navDrawer : null}
      {shouldShowBootstrapErrorBanner(props.gate) && props.bootstrapError ? (
        <StateBanner kind="error" message={props.bootstrapError} />
      ) : null}
      {renderBootstrapStage(props)}
    </div>
  );
}

function renderBootstrapStage(props: AccountBootstrapShellProps) {
  switch (props.gate.kind) {
    case "unavailable":
      return <StateBanner kind="error" message="Saved account data is unavailable. Restore browser storage access, then reload Davora." />;
    case "healthChecking":
      return <StateBanner kind="loading" message="Checking session requirements…" />;
    case "noAccounts":
    case "connect":
    case "reconnect":
      return props.connectStage ? <ConnectAccountStage {...props.connectStage} /> : null;
    case "unlock":
      return props.unlockStage ? <UnlockPanelStage {...props.unlockStage} /> : null;
    case "restore":
      return props.restoreStage ? <RestoreSessionStage {...props.restoreStage} /> : null;
    case "continue":
      return null;
    default:
      return assertNever(props.gate, "account bootstrap shell gate");
  }
}
