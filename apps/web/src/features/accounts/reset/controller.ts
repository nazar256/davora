import { assertNever } from "@davora/shared";

import {
  buildActiveAccountStatusMessage,
  buildLinkedAccountUnavailableMessage,
  planAccountSwitchPathReset,
  resolveSessionTerminalMutation,
  type AccountSwitchPathReset,
  type SessionTerminalResetRequest
} from "./model";
import type { SemanticAccountResetPorts } from "./ports";

export function clearAccountScopedUi(ports: SemanticAccountResetPorts): void {
  ports.preview.clearAccountContext();
  ports.selection.clearFocused();
  ports.selection.clearBatch();
  ports.navigation.closeMobileDetails();
  ports.browsing.clearListError();
}

export function applyAccountSwitchPathReset(
  ports: Pick<SemanticAccountResetPorts, "navigation">,
  pathReset: AccountSwitchPathReset
): void {
  ports.navigation.setPath(pathReset.path);
  switch (pathReset.kind) {
    case "first-mount-restore":
      return;
    case "switch-clear":
      ports.navigation.syncPath("", pathReset.syncAccountId);
      return;
    default:
      return assertNever(pathReset, "account switch path reset");
  }
}

export function executeAccountSwitchReset(
  ports: SemanticAccountResetPorts,
  input: {
    readonly isFirstAccountEffect: boolean;
    readonly locationSearch: string;
    readonly hasActiveAccount: boolean;
    readonly accountId?: string;
    readonly accountDisplayName?: string;
  }
): void {
  clearAccountScopedUi(ports);
  const pathReset = planAccountSwitchPathReset({
    isFirstAccountEffect: input.isFirstAccountEffect,
    locationSearch: input.locationSearch,
    hasActiveAccount: input.hasActiveAccount,
    accountId: input.accountId
  });
  applyAccountSwitchPathReset(ports, pathReset);
  ports.browsing.clearQuery();
  if (input.hasActiveAccount && input.accountDisplayName) {
    ports.presentation.setStatus(
      pathReset.kind === "first-mount-restore" && pathReset.linkedAccountUnavailable
        ? buildLinkedAccountUnavailableMessage(input.accountDisplayName)
        : buildActiveAccountStatusMessage(input.accountDisplayName)
    );
  }
}

export function executeSessionTerminalReset(
  ports: SemanticAccountResetPorts,
  request: SessionTerminalResetRequest
): void {
  clearAccountScopedUi(ports);
  ports.session.applyTerminal(
    request.accountId,
    resolveSessionTerminalMutation(request.accountId, request.reconnectRequired) === "reconnect-required"
  );
  ports.transfers.failActiveForAccount(request.accountId, request.message);
  ports.bootstrap.setError(request.message);
  ports.presentation.setStatus(request.message);
}
