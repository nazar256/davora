import type { ConnectedAccount } from "@davora/shared";

import { parseLocationSearch } from "../../navigation";
import { buildLinkedAccountUnavailableMessage } from "../reset/model";
import { selectActiveAccountRecord, type AccountRegistryState, type StoredAccountRecord } from "../registry";

export type AccountWorkspaceRecord = Omit<StoredAccountRecord, "session">;

export type AccountWorkspaceRegistryState =
  | { readonly kind: "ready" | "repaired"; readonly snapshot: { readonly activeAccountId?: string; readonly accounts: readonly AccountWorkspaceRecord[] }; readonly warning?: string }
  | { readonly kind: "unavailable"; readonly snapshot: { readonly activeAccountId?: string; readonly accounts: readonly AccountWorkspaceRecord[] }; readonly message: string };

export interface PendingRemovalAccount {
  readonly account: ConnectedAccount;
  readonly phase: "revoke" | "purge";
}

/**
 * The complete account context consumed by the composition root.  Every field
 * is projected from the same registry state so an account switch cannot
 * combine identity, session, or cache data from different records.
 */
export interface AccountStateWorkspaceSnapshot {
  readonly registryState: AccountWorkspaceRegistryState;
  readonly records: readonly AccountWorkspaceRecord[];
  readonly accounts: readonly ConnectedAccount[];
  readonly operationalRecords: readonly AccountWorkspaceRecord[];
  readonly operationalAccounts: readonly ConnectedAccount[];
  readonly managementActiveRecord?: AccountWorkspaceRecord;
  readonly managementActiveAccount?: ConnectedAccount;
  readonly operationalActiveRecord?: AccountWorkspaceRecord;
  readonly operationalActiveAccount?: ConnectedAccount;
  readonly pendingRemovalAccounts: readonly PendingRemovalAccount[];
  readonly activeAccountId?: string;
  readonly activeAccountName: string;
  readonly activeCacheNamespace?: string;
  readonly registryUnavailable: boolean;
  readonly registryNotice?: string;
  /** Number of accounts eligible for normal operational bootstrap. */
  readonly accountCount: number;
  /** Number of persisted records, including removal-pending records. */
  readonly totalAccountCount: number;
  readonly bootstrapSafeHost?: string;
  readonly initialStatus: string;
  readonly sessionRevision: number;
}

function projectSessionRevision(state: AccountRegistryState): number {
  const source = state.snapshot.accounts.map((record) => [
    record.account.id,
    record.session?.token ?? "",
    record.session?.expiresAt ?? "",
    record.session?.capabilities ?? null
  ]);
  let hash = 2166136261;
  for (const character of JSON.stringify(source)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readBootstrapSafeHost(account: ConnectedAccount | undefined): string | undefined {
  if (!account) {
    return undefined;
  }
  try {
    const url = new URL(account.baseUrl);
    return url.hostname || undefined;
  } catch {
    return undefined;
  }
}

export function projectAccountStateWorkspaceSnapshot(state: AccountRegistryState, locationSearch?: string): AccountStateWorkspaceSnapshot {
  const sourceRecords = state.snapshot.accounts;
  const records = Object.freeze(sourceRecords.map(({ session: _session, ...record }) => record));
  const accounts = Object.freeze(records.map((record) => record.account));
  const operationalRecords = Object.freeze(records.filter((record) => !record.pendingRemoval));
  const operationalAccounts = Object.freeze(operationalRecords.map((record) => record.account));
  const managementSourceRecord = selectActiveAccountRecord(state.snapshot);
  const managementActiveRecord = managementSourceRecord
    ? records.find((record) => record.account.id === managementSourceRecord.account.id)
    : undefined;
  const operationalActiveRecord = managementActiveRecord?.pendingRemoval
    ? operationalRecords[0]
    : managementActiveRecord;
  const managementActiveAccount = managementActiveRecord?.account;
  const operationalActiveAccount = operationalActiveRecord?.account;
  const pendingRemovalAccounts = Object.freeze(
    records.flatMap((record) => record.pendingRemoval
      ? [{ account: record.account, phase: record.pendingRemoval.phase }]
      : [])
  );
  const registryUnavailable = state.kind === "unavailable";
  const registryNotice = registryUnavailable ? state.message : state.warning;
  const registryState: AccountWorkspaceRegistryState = Object.freeze(
    state.kind === "unavailable"
      ? { kind: state.kind, snapshot: { ...(state.snapshot.activeAccountId ? { activeAccountId: state.snapshot.activeAccountId } : {}), accounts: records }, message: state.message }
      : { kind: state.kind, snapshot: { ...(state.snapshot.activeAccountId ? { activeAccountId: state.snapshot.activeAccountId } : {}), accounts: records }, ...(state.warning ? { warning: state.warning } : {}) }
  );
  const activeAccountId = operationalActiveAccount?.id;
  const activeAccountName = operationalActiveAccount?.displayName ?? "current account";
  const linkedAccountId = locationSearch === undefined ? undefined : parseLocationSearch(locationSearch).accountId;
  const linkedAccountMismatch = linkedAccountId !== undefined && linkedAccountId !== activeAccountId;
  const initialStatus = registryUnavailable
    ? state.message
    : linkedAccountMismatch
      ? buildLinkedAccountUnavailableMessage(operationalActiveAccount ? activeAccountName : undefined)
      : records.length > 0
        ? "Restoring account state…"
        : "Connect an account to begin.";

  return Object.freeze({
    registryState,
    records,
    accounts,
    operationalRecords,
    operationalAccounts,
    managementActiveRecord,
    managementActiveAccount,
    operationalActiveRecord,
    operationalActiveAccount,
    pendingRemovalAccounts,
    activeAccountId,
    activeAccountName,
    activeCacheNamespace: operationalActiveAccount?.cacheNamespace,
    registryUnavailable,
    ...(registryNotice ? { registryNotice } : {}),
    accountCount: operationalRecords.length,
    totalAccountCount: records.length,
    bootstrapSafeHost: readBootstrapSafeHost(operationalActiveAccount),
    initialStatus,
    sessionRevision: projectSessionRevision(state)
  });
}
