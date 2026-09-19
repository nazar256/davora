import { useCallback, useMemo, useRef } from "react";

import { useConnectAccount } from "../../connect/useConnectAccount";
import { useRemoveAccount } from "../../remove/useRemoveAccount";
import { createAccountRemovalCommand } from "./createAccountRemovalCommand";
import { useAccountReset } from "../../reset/useAccountReset";
import type {
  AccountActionSurface,
  AccountActionsWorkspaceInput,
  AccountActionsWorkspaceOutput,
  AccountActionsWorkspaceSnapshot,
  AccountActionsWorkspaceStages,
  AccountActionsWorkspaceCommands
} from "./ports";

const initialSnapshot: AccountActionsWorkspaceSnapshot = {
  surface: "none",
  connect: { busy: false },
  remove: { busy: false }
};

export function useAccountActionsWorkspace(input: AccountActionsWorkspaceInput): AccountActionsWorkspaceOutput {
  const removePorts = useMemo(
    () => createAccountRemovalCommand(input.remove.command),
    [input.remove.command]
  );
  const connect = useConnectAccount({
    healthRootPath: input.healthRootPath,
    unlockRequired: input.unlockRequired,
    activeRecord: input.activeRecord,
    ports: input.connect.ports,
    openerPorts: {
      pushAccountSurface: input.navigation.pushAccountSurface,
      closeSettings: input.navigation.closeSettings
    },
    onStatusChange: input.connect.onStatusChange
  });
  const remove = useRemoveAccount({
    activeAccount: input.removeActiveAccount ?? input.activeAccount,
    ports: removePorts,
    openerPorts: {
      pushRemoveAccountSurface: input.navigation.pushRemoveAccountSurface,
      closeSettings: input.navigation.closeSettings
    },
    onStatusChange: input.remove.onStatusChange
  });
  const reset = useAccountReset({
    activeAccountId: input.activeAccount?.id,
    activeAccountDisplayName: input.activeAccount?.displayName,
    hasActiveAccount: Boolean(input.activeAccount),
    ports: input.reset.ports
  });

  const dismiss = useCallback((surface: AccountActionSurface) => {
    if (surface === "connect") {
      connect.setShowDialog(false);
    } else {
      remove.setTarget(undefined);
    }
  }, [connect, remove]);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  const snapshot = useMemo<AccountActionsWorkspaceSnapshot>(() => ({
    surface: input.settingsOpen
      ? "settings"
      : connect.showDialog
        ? "connect"
        : remove.target
          ? "remove"
          : "none",
    connect: { busy: connect.busy },
    remove: { busy: remove.busy }
  }), [connect.busy, connect.showDialog, input.settingsOpen, remove.busy, remove.target]);

  const stages = useMemo<AccountActionsWorkspaceStages>(() => ({
    bootstrapConnect: connect.bootstrap,
    connectDialog: connect.dialog,
    removeDialog: {
      accountLabel: remove.target?.displayName ?? "",
      busy: remove.busy,
      confirmation: remove.confirmation,
      error: remove.error,
      onClose: () => dismiss("remove"),
      onConfirmationChange: remove.setConfirmation,
      onSubmit: (event) => void remove.confirmRemoveAccount(event),
      open: Boolean(remove.target)
    }
  }), [connect.bootstrap, connect.dialog, dismiss, remove]);

  const commands = useMemo<AccountActionsWorkspaceCommands>(() => ({
    openAddFromSettings: connect.openAddAccountFromSettings,
    openReconnectFromSettings: connect.openReconnectFromSettings,
    openRemoveFromSettings: remove.openRemoveFromSettings,
    switchActive: input.switchActive,
    resetSession: reset.resetActiveSession
  }), [connect.openAddAccountFromSettings, connect.openReconnectFromSettings, input.switchActive, remove.openRemoveFromSettings, reset.resetActiveSession]);

  const snapshotRef = useRef(initialSnapshot);
  const commandsRef = useRef<AccountActionsWorkspaceCommands>(commands);
  snapshotRef.current = snapshot;
  commandsRef.current = commands;
  const bridge = useMemo(() => ({
    snapshot: () => snapshotRef.current,
    dismiss: (surface: AccountActionSurface) => dismissRef.current(surface),
    resetSession: (message: string, reconnectRequired?: boolean) => commandsRef.current.resetSession(message, reconnectRequired)
  }), []);

  return { bridge, snapshot, stages, commands };
}
