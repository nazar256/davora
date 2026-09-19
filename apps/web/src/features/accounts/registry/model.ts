import type { AppSession, ConnectedAccount } from "@davora/shared";

export interface StoredSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly rootPath: string;
  readonly capabilities: AppSession["capabilities"];
}

export interface StoredAccountRecord {
  readonly account: ConnectedAccount;
  readonly session?: StoredSession;
  readonly pendingRemoval?: {
    readonly phase: "revoke" | "purge";
  };
  readonly pendingReconnect?: {
    readonly baseUrl: string;
    readonly username: string;
    readonly label?: string;
  };
}

export interface AccountRegistrySnapshot {
  readonly activeAccountId?: string;
  readonly accounts: readonly StoredAccountRecord[];
}

export type AccountRegistryState =
  | { readonly kind: "ready" | "repaired"; readonly snapshot: AccountRegistrySnapshot; readonly warning?: string }
  | { readonly kind: "unavailable"; readonly snapshot: AccountRegistrySnapshot; readonly message: string };

export const EMPTY_ACCOUNT_REGISTRY: AccountRegistrySnapshot = { accounts: [] };

export function selectActiveAccountRecord(snapshot: AccountRegistrySnapshot): StoredAccountRecord | undefined {
  return snapshot.accounts.find((record) => record.account.id === snapshot.activeAccountId) ?? snapshot.accounts[0];
}
