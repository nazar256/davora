import type { ConnectedAccount } from "@davora/shared";

import type { ConnectAccountPorts } from "../../connect/ports";
import type { AccountReconnectSource } from "../../connect/model";
import type { ConnectAccountStageProps } from "../../connect/ConnectAccountStage";
import type { ConnectAccountDialogStageProps } from "../../connect/ConnectAccountDialogStage";
import type { SemanticAccountResetPorts } from "../../reset/ports";
import type { RemoveAccountStageProps } from "../../remove/RemoveAccountStage";
import type { AccountRemovalCommandDependencies } from "./createAccountRemovalCommand";

export type AccountActionSurface = "connect" | "remove";

export interface AccountActionsWorkspaceInput {
  readonly activeRecord?: AccountReconnectSource;
  readonly activeAccount?: ConnectedAccount;
  readonly removeActiveAccount?: ConnectedAccount;
  readonly healthRootPath: string;
  readonly unlockRequired: boolean;
  readonly settingsOpen: boolean;
  readonly connect: {
    readonly ports: ConnectAccountPorts;
    readonly onStatusChange: (message: string) => void;
  };
  readonly remove: {
    readonly command: AccountRemovalCommandDependencies;
    readonly onStatusChange: (message: string) => void;
  };
  readonly reset: {
    readonly ports: SemanticAccountResetPorts;
  };
  readonly navigation: {
    readonly pushAccountSurface: () => void;
    readonly pushRemoveAccountSurface: () => void;
    readonly closeSettings: () => void;
  };
  readonly switchActive: (accountId: string) => void;
}

export interface AccountActionsWorkspaceSnapshot {
  readonly surface: "none" | "settings" | AccountActionSurface;
  readonly connect: { readonly busy: boolean };
  readonly remove: { readonly busy: boolean };
}

export interface AccountActionsWorkspaceStages {
  readonly bootstrapConnect: ConnectAccountStageProps;
  readonly connectDialog: ConnectAccountDialogStageProps;
  readonly removeDialog: RemoveAccountStageProps;
}

export interface AccountActionsWorkspaceCommands {
  readonly openAddFromSettings: () => void;
  readonly openReconnectFromSettings: () => void;
  readonly openRemoveFromSettings: () => void;
  readonly switchActive: (accountId: string) => void;
  readonly resetSession: (message: string, reconnectRequired?: boolean) => void;
}

export interface AccountActionsWorkspaceBridge {
  readonly snapshot: () => AccountActionsWorkspaceSnapshot;
  readonly dismiss: (surface: AccountActionSurface) => void;
  readonly resetSession: (message: string, reconnectRequired?: boolean) => void;
}

export interface AccountActionsWorkspaceOutput {
  readonly bridge: AccountActionsWorkspaceBridge;
  readonly snapshot: AccountActionsWorkspaceSnapshot;
  readonly stages: AccountActionsWorkspaceStages;
  readonly commands: AccountActionsWorkspaceCommands;
}
