import type { PersistedAccountRecord, PersistedAccountRevocation } from "./persistedAccountStateCodec";
import { workerFailure } from "../http/failure";
import type { AccountRepositoryCommandResult, AccountRepositorySnapshot } from "./repository";

export interface BrowserOwnership {
  readonly browserId: string;
  readonly browserSecret: string;
}

function ownerMatches(record: BrowserOwnership, owner: BrowserOwnership): boolean {
  return record.browserId === owner.browserId && record.browserSecret === owner.browserSecret;
}

export function assertAccountOwner(record: PersistedAccountRecord, owner: BrowserOwnership): void {
  if (record.ownerBrowserId !== owner.browserId || record.ownerBrowserSecret !== owner.browserSecret) {
    throw workerFailure("permission_denied_context");
  }
}

export function assertReconnectPreauthorized(
  state: AccountRepositorySnapshot,
  accountId: string,
  owner: BrowserOwnership
): void {
  const record = state.accounts.get(accountId);
  if (record) {
    assertAccountOwner(record, owner);
    return;
  }
  const revocation = state.revocations.get(accountId);
  if (!revocation) return;
  if (!ownerMatches({ browserId: revocation.ownerBrowserId, browserSecret: revocation.ownerBrowserSecret }, owner)) {
    throw workerFailure("permission_denied_context");
  }
  throw workerFailure("account_revoked");
}

export function connectAccountCommand(
  state: AccountRepositorySnapshot,
  record: PersistedAccountRecord,
  reconnect: boolean,
  owner: BrowserOwnership
): AccountRepositoryCommandResult<PersistedAccountRecord> {
  const accountId = record.account.id;
  const previous = state.accounts.get(accountId);
  if (previous) {
    assertAccountOwner(previous, owner);
  } else if (reconnect) {
    const revocation = state.revocations.get(accountId);
    if (revocation) {
      if (ownerMatches({ browserId: revocation.ownerBrowserId, browserSecret: revocation.ownerBrowserSecret }, owner)) {
        throw workerFailure("account_revoked");
      }
      throw workerFailure("permission_denied_context");
    }
  }
  const committed = {
    ...record,
    account: {
      ...record.account,
      cacheNamespace: record.account.cacheNamespace || previous?.account.cacheNamespace || record.account.cacheNamespace
    }
  };
  state.accounts.set(accountId, committed);
  state.revocations.delete(accountId);
  return { changed: true, value: committed };
}

export function removeAccountCommand(
  state: AccountRepositorySnapshot,
  accountId: string,
  owner: BrowserOwnership,
  createRevocationNonce: () => string
): AccountRepositoryCommandResult<boolean> {
  const record = state.accounts.get(accountId);
  const existing = state.revocations.get(accountId);
  if (!record && existing && !ownerMatches({ browserId: existing.ownerBrowserId, browserSecret: existing.ownerBrowserSecret }, owner)) {
    throw workerFailure("permission_denied_context");
  }
  if (!record && !existing) return { changed: false, value: false };
  if (record) assertAccountOwner(record, owner);

  const revocation: PersistedAccountRevocation = record
    ? {
        accountId,
        ownerBrowserId: owner.browserId,
        ownerBrowserSecret: owner.browserSecret,
        revocationNonce: createRevocationNonce(),
        revision: state.revision + 1
      }
    : existing!;
  state.accounts.delete(accountId);
  state.revocations.set(accountId, revocation);
  return { changed: Boolean(record), value: true };
}
