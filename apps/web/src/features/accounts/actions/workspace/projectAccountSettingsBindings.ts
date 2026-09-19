import type { ConnectedAccount } from "@davora/shared";

import type { AccountActionsWorkspaceCommands } from "./ports";
import type { PendingRemovalAccount } from "../../workspace/model";

export interface AccountSettingsProjectionInput {
  readonly accounts: readonly ConnectedAccount[];
  readonly activeAccount?: ConnectedAccount;
  readonly managementActiveAccount?: ConnectedAccount;
  readonly pendingRemovalAccounts: readonly PendingRemovalAccount[];
  readonly activeAccountId?: string;
  readonly connectedAccountCount: number;
  readonly commands: Pick<
    AccountActionsWorkspaceCommands,
    "switchActive" | "openAddFromSettings" | "openReconnectFromSettings" | "openRemoveFromSettings"
  >;
}

export function projectAccountSettingsBindings(input: AccountSettingsProjectionInput) {
  return {
    accounts: [...input.accounts],
    activeAccount: input.activeAccount,
    managementActiveAccount: input.managementActiveAccount,
    pendingRemovalAccounts: [...input.pendingRemovalAccounts],
    activeAccountId: input.activeAccountId,
    connectedAccountCount: input.connectedAccountCount,
    onActiveAccountChange: input.commands.switchActive,
    onOpenAddAccount: input.commands.openAddFromSettings,
    onOpenReconnect: input.commands.openReconnectFromSettings,
    onOpenRemove: input.commands.openRemoveFromSettings
  };
}
