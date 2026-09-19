import type { ConnectedAccount } from "@davora/shared";

export interface SemanticAccountRemovalPorts {
  /** Stop account-owned work before any destructive operation. */
  quiesceAccount(account: ConnectedAccount): Promise<void>;
  /** Revoke server-side credentials and sessions. */
  revokeRemoteAccount(accountId: string): Promise<void>;
  /** Remove every browser-owned account namespace and derivative. */
  purgeLocalAccountData(account: ConnectedAccount): Promise<void>;
}

export type AccountRemovalPorts = SemanticAccountRemovalPorts;
