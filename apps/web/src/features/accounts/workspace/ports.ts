import type { AppSession, ConnectAccountRequest } from "@davora/shared";

import type { AccountBootstrapController } from "../bootstrap";
import type { AccountTransport } from "../transport";
import type { AccountRemovalPorts, AccountRegistryService, RegistryCommitOutcome, RegistryConnectOutcome, RegistryRemovalOutcome } from "../registry";
import type { AccountSessionPorts } from "../session";
import type { AccountStateWorkspaceSnapshot } from "./model";

export interface AccountStateWorkspaceInput {
  readonly registry: AccountRegistryService;
  readonly transport: Pick<AccountTransport, "connectAccount">;
  readonly session: Pick<AccountSessionPorts, "markAccountReconnectRequired" | "clearAccountSession">;
}

export interface AccountStateWorkspaceCommands {
  readonly switchActive: (accountId: string) => RegistryCommitOutcome;
  readonly connectAccount: (request: ConnectAccountRequest) => Promise<RegistryConnectOutcome>;
  readonly removeAccount: (
    accountId: string,
    ports: AccountRemovalPorts
  ) => Promise<RegistryRemovalOutcome>;
  readonly retryRemovalCommit: (retryToken: string) => RegistryRemovalOutcome;
  readonly applyTerminal: (accountId: string, reconnectRequired: boolean) => void;
}

export interface AccountStateWorkspaceOutput {
  readonly snapshot: AccountStateWorkspaceSnapshot;
  readonly commands: AccountStateWorkspaceCommands;
  readonly sessionAuthority: AccountSessionAuthority;
}

export interface AccountSessionAuthoritySnapshot {
  readonly accountId?: string;
  readonly token?: string;
  readonly capabilities?: AppSession["capabilities"];
  readonly revision: number;
}

/** Captures session authority for composition without making it part of account state. */
export interface AccountSessionAuthority {
  capture(): AccountSessionAuthoritySnapshot;
}

export interface AccountBootstrapWorkspaceInput {
  readonly account: AccountStateWorkspaceSnapshot;
  readonly sessionAuthority: AccountSessionAuthority;
  readonly accountCommands: Pick<AccountStateWorkspaceCommands, "switchActive" | "connectAccount" | "removeAccount" | "retryRemovalCommit" | "applyTerminal">;
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  readonly ports: {
    readonly session: AccountSessionPorts;
    readonly onStatusChange: (message: string) => void;
  };
}

export interface AccountBootstrapWorkspaceOutput extends AccountBootstrapController {
  readonly account: AccountStateWorkspaceSnapshot;
  readonly accountCommands: AccountStateWorkspaceCommands;
}

export type { AccountStateWorkspaceSnapshot } from "./model";
