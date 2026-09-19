import { appSessionSchema, connectedAccountSchema, type AppSession, type ConnectAccountRequest, type ConnectAccountTransportSuccess, type ConnectedAccount } from "@davora/shared";

import { decodeAccountRegistry, encodeAccountRegistry, type RegistryRepair } from "./codec";
import {
  EMPTY_ACCOUNT_REGISTRY,
  type AccountRegistrySnapshot,
  type AccountRegistryState,
  type StoredAccountRecord
} from "./model";
import type { AccountRemovalPorts } from "./ports";

const STORAGE_KEY = "davora-account-state";

export interface AccountRegistryStorageResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: Error;
}

export interface AccountRegistryStorage {
  readItem(key: string): AccountRegistryStorageResult<string | null>;
  writeItem(key: string, value: string): AccountRegistryStorageResult<void>;
  deleteItem(key: string): AccountRegistryStorageResult<void>;
}

export interface AccountRegistryClock {
  isExpired(expiresAt: string): boolean;
}

export type RegistryCommitOutcome =
  | { readonly kind: "committed"; readonly snapshot: AccountRegistrySnapshot }
  | { readonly kind: "partial"; readonly message: string }
  | { readonly kind: "invalid"; readonly reason: "invalid-account" | "unknown-account" | "account-mismatch"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export type RegistryConnectOutcome =
  | { readonly kind: "committed"; readonly snapshot: AccountRegistrySnapshot; readonly account: ConnectedAccount }
  | { readonly kind: "partial"; readonly message: string; readonly clearCredential: true }
  | { readonly kind: "failed"; readonly message: string; readonly clearCredential: false };

export type RegistryRemovalOutcome =
  | { readonly kind: "committed"; readonly snapshot: AccountRegistrySnapshot }
  | { readonly kind: "pending"; readonly phase: "revoke" | "purge"; readonly snapshot: AccountRegistrySnapshot; readonly message: string }
  | { readonly kind: "degraded"; readonly snapshot: AccountRegistrySnapshot; readonly message: string; readonly retryLocalCommit: boolean; readonly retryToken?: string }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export interface AccountRegistryService {
  getState(): AccountRegistryState;
  getSnapshot(): AccountRegistrySnapshot;
  subscribe(listener: () => void): () => void;
  repair(): RegistryCommitOutcome;
  connectAccount(request: ConnectAccountRequest, transport: (request: ConnectAccountRequest) => Promise<ConnectAccountTransportSuccess>): Promise<RegistryConnectOutcome>;
  commitConnectedAccount(account: ConnectedAccount): RegistryCommitOutcome;
  commitSession(accountId: string, session: AppSession): RegistryCommitOutcome;
  clearAccountSession(accountId: string): RegistryCommitOutcome;
  markAccountReconnectRequired(accountId: string): RegistryCommitOutcome;
  switchAccount(accountId: string): RegistryCommitOutcome;
  removeAccount(accountId: string, ports: AccountRemovalPorts): Promise<RegistryRemovalOutcome>;
  retryRemovalCommit(retryToken: string): RegistryRemovalOutcome;
}

export interface AccountRegistryServiceOptions {
  /** Account identity requested by the current URL (for example a folder deep link). */
  readonly preferredActiveAccountId?: string;
}

export function createAccountRegistryService(
  storage: AccountRegistryStorage,
  clock: AccountRegistryClock = { isExpired: () => false },
  options: AccountRegistryServiceOptions = {}
): AccountRegistryService {
  const read = storage.readItem(STORAGE_KEY);
  let pendingRepair: RegistryRepair = { kind: "none" };
  let repairAttempted = false;
  let repairWarning: string | undefined;
  let state: AccountRegistryState;
  if (!read.ok) {
    state = { kind: "unavailable", snapshot: EMPTY_ACCOUNT_REGISTRY, message: "Saved account data is unavailable." };
  } else {
    const decoded = decodeAccountRegistry(read.value ?? null, clock.isExpired, options);
    pendingRepair = decoded.repair;
    repairWarning = decoded.warning;
    state = {
      kind: decoded.kind,
      snapshot: decoded.snapshot,
      ...(decoded.warning ? { warning: decoded.warning } : {})
    };
  }
  const listeners = new Set<() => void>();
  const accountGenerations = new Map(state.snapshot.accounts.map((record) => [record.account.id, 0]));
  const pendingRemovals = new Map<string, { readonly accountId: string; readonly generation: number }>();
  const connectRevisions = new Map<string, number>();
  const inFlightRemovals = new Map<string, Promise<void>>();

  const publish = (snapshot: AccountRegistrySnapshot, nextKind: "ready" | "repaired" = "ready", warning?: string) => {
    state = { kind: nextKind, snapshot, ...(warning ? { warning } : {}) };
    for (const listener of listeners) {
      listener();
    }
  };

  const persist = (snapshot: AccountRegistrySnapshot): RegistryCommitOutcome => {
    if (state.kind === "unavailable") {
      return { kind: "failed", message: "Saved account data is unavailable." };
    }
    const result = storage.writeItem(STORAGE_KEY, encodeAccountRegistry(snapshot));
    if (!result.ok) {
      return { kind: "failed", message: "Unable to save account data." };
    }
    pendingRepair = { kind: "none" };
    publish(snapshot);
    return { kind: "committed", snapshot };
  };

  const bumpGeneration = (accountId: string) => {
    accountGenerations.set(accountId, (accountGenerations.get(accountId) ?? 0) + 1);
    connectRevisions.set(accountId, (connectRevisions.get(accountId) ?? 0) + 1);
  };

  const invalidatePendingRemoval = (accountId: string) => {
    for (const [token, pending] of pendingRemovals) {
      if (pending.accountId === accountId) pendingRemovals.delete(token);
    }
  };

  const removeFromLatestSnapshot = (accountId: string): AccountRegistrySnapshot => {
    const current = state.snapshot;
    const accounts = current.accounts.filter((record) => record.account.id !== accountId);
    const activeAccountId = current.activeAccountId === accountId
      ? accounts[0]?.account.id
      : current.activeAccountId && accounts.some((record) => record.account.id === current.activeAccountId)
        ? current.activeAccountId
        : accounts[0]?.account.id;
    return { ...(activeAccountId ? { activeAccountId } : {}), accounts };
  };

  const service: AccountRegistryService = {
    getState: () => state,
    getSnapshot: () => state.snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    repair() {
      if (state.kind === "unavailable") {
        return { kind: "failed", message: state.message, clearCredential: false };
      }
      if (pendingRepair.kind === "none") {
        return { kind: "committed", snapshot: state.snapshot };
      }
      if (repairAttempted) {
        return { kind: "failed", message: repairWarning ?? "Unable to repair saved account data." };
      }
      repairAttempted = true;
      const result = pendingRepair.kind === "delete"
        ? storage.deleteItem(STORAGE_KEY)
        : storage.writeItem(STORAGE_KEY, pendingRepair.value);
      if (!result.ok) {
        repairWarning = "Unable to repair saved account data.";
        publish(state.snapshot, "repaired", repairWarning);
        return { kind: "failed", message: "Unable to repair saved account data." };
      }
      pendingRepair = { kind: "none" };
      publish(state.snapshot, "ready", repairWarning);
      return { kind: "committed", snapshot: state.snapshot };
    },
    async connectAccount(request, transport) {
      if (state.kind === "unavailable") {
        return { kind: "failed", message: state.message, clearCredential: false };
      }
      const reconnectAccountId = request.accountId;
      const reconnectRecord = reconnectAccountId
        ? state.snapshot.accounts.find((record) => record.account.id === reconnectAccountId)
        : undefined;
      if (reconnectAccountId && (!reconnectRecord || reconnectRecord.pendingRemoval)) {
        return { kind: "failed", message: "That account is no longer available.", clearCredential: false };
      }
      const expectedGeneration = reconnectAccountId === undefined
        ? undefined
        : accountGenerations.get(reconnectAccountId) ?? 0;
      const expectedActiveAccountId = reconnectAccountId === undefined
        ? undefined
        : state.snapshot.activeAccountId;
      const revision = reconnectAccountId === undefined
        ? undefined
        : (connectRevisions.get(reconnectAccountId) ?? 0) + 1;
      if (reconnectAccountId !== undefined) connectRevisions.set(reconnectAccountId, revision!);
      if (request.accountId) {
        await inFlightRemovals.get(request.accountId);
      }
      let transportSuccess: ConnectAccountTransportSuccess;
      try {
        transportSuccess = await transport(request);
      } catch {
        return { kind: "failed", message: "Unable to connect account.", clearCredential: false };
      }
      if (transportSuccess.kind === "invalid-http-success") {
        return {
          kind: "partial",
          message: "The account connected remotely, but could not be saved in this browser.",
          clearCredential: true
        };
      }
      const payload = transportSuccess.data;
      const rawAccount = payload && typeof payload === "object" && "account" in payload
        ? payload.account
        : undefined;
      const parsed = connectedAccountSchema.safeParse(rawAccount);
      if (!parsed.success
        || (request.accountId !== undefined && parsed.data.id !== request.accountId)
        || (request.cacheNamespace !== undefined && parsed.data.cacheNamespace !== request.cacheNamespace)) {
        return {
          kind: "partial",
          message: "The account connected remotely, but could not be saved in this browser.",
          clearCredential: true
        };
      }
      if (reconnectAccountId !== undefined) {
        const currentRecord = state.snapshot.accounts.find((record) => record.account.id === reconnectAccountId);
        const stillCurrent = currentRecord !== undefined
          && !currentRecord.pendingRemoval
          && (accountGenerations.get(reconnectAccountId) ?? 0) === expectedGeneration
          && connectRevisions.get(reconnectAccountId) === revision
          && state.snapshot.activeAccountId === expectedActiveAccountId
          && !inFlightRemovals.has(reconnectAccountId);
        if (!stillCurrent) {
          return {
            kind: "partial",
            message: "The account connection finished after the account context changed.",
            clearCredential: true
          };
        }
      }
      const commit = service.commitConnectedAccount(parsed.data);
      if (commit.kind !== "committed") {
        return {
          kind: "partial",
          message: "The account connected remotely, but could not be saved in this browser.",
          clearCredential: true
        };
      }
      return { kind: "committed", snapshot: commit.snapshot, account: parsed.data };
    },
    commitConnectedAccount(account) {
      const parsed = connectedAccountSchema.safeParse(account);
      if (!parsed.success) {
        return { kind: "invalid", reason: "invalid-account", message: "The server returned an invalid account." };
      }
      if (state.kind === "unavailable") {
        return { kind: "failed", message: state.message };
      }
      const current = state.snapshot;
      const index = current.accounts.findIndex((record) => record.account.id === parsed.data.id);
      const existing = index >= 0 ? current.accounts[index] : undefined;
      if (inFlightRemovals.has(parsed.data.id)) {
        return { kind: "invalid", reason: "invalid-account", message: "Account removal is still in progress." };
      }
      if (existing?.pendingRemoval) {
        return { kind: "invalid", reason: "invalid-account", message: "Account removal is pending." };
      }
      if (existing && existing.account.cacheNamespace !== parsed.data.cacheNamespace) {
        return { kind: "invalid", reason: "invalid-account", message: "The account cache identity changed unexpectedly." };
      }
      if (current.accounts.some((record, recordIndex) => recordIndex !== index && record.account.cacheNamespace === parsed.data.cacheNamespace)) {
        return { kind: "invalid", reason: "invalid-account", message: "That account cache identity is already in use." };
      }
      const nextRecord: StoredAccountRecord = { account: parsed.data };
      const accounts = index < 0
        ? [...current.accounts, nextRecord]
        : current.accounts.map((record, recordIndex) => recordIndex === index ? nextRecord : record);
      const outcome = persist({ activeAccountId: parsed.data.id, accounts });
      if (outcome.kind === "committed") {
        invalidatePendingRemoval(parsed.data.id);
        bumpGeneration(parsed.data.id);
      }
      return outcome;
    },
    commitSession(accountId, session) {
      const parsed = appSessionSchema.safeParse(session);
      if (!parsed.success) {
        return { kind: "invalid", reason: "account-mismatch", message: "The server returned an invalid session." };
      }
      const current = state.snapshot;
      const target = current.accounts.find((record) => record.account.id === accountId);
      if (!target) {
        return { kind: "invalid", reason: "unknown-account", message: "Cannot save a session for an unknown account." };
      }
      if (target.pendingRemoval) {
        return { kind: "invalid", reason: "unknown-account", message: "Cannot save a session while account removal is pending." };
      }
      if (parsed.data.account.id !== accountId) {
        return { kind: "invalid", reason: "account-mismatch", message: "Cannot save a session for a different account." };
      }
      const stored = target.account;
      if (parsed.data.account.type !== stored.type
        || parsed.data.account.baseUrl !== stored.baseUrl
        || parsed.data.account.username !== stored.username
        || parsed.data.account.rootPath !== stored.rootPath
        || parsed.data.account.backend !== stored.backend
        || parsed.data.account.cacheNamespace !== stored.cacheNamespace
        || parsed.data.rootPath !== stored.rootPath
        || parsed.data.capabilities.backend !== stored.backend) {
        return { kind: "invalid", reason: "account-mismatch", message: "The session does not match the stored account." };
      }
      const outcome = persist({
        ...(current.activeAccountId ? { activeAccountId: current.activeAccountId } : { activeAccountId: accountId }),
        accounts: current.accounts.map((record) => record.account.id === accountId
          ? {
              account: parsed.data.account,
              session: {
                token: parsed.data.token,
                expiresAt: parsed.data.expiresAt,
                rootPath: parsed.data.rootPath,
                capabilities: parsed.data.capabilities
              }
            }
          : record)
      });
      if (outcome.kind === "committed") bumpGeneration(accountId);
      return outcome;
    },
    clearAccountSession(accountId) {
      const current = state.snapshot;
      if (!current.accounts.some((record) => record.account.id === accountId)) {
        return { kind: "invalid", reason: "unknown-account", message: "Cannot clear a session for an unknown account." };
      }
      const outcome = persist({
        ...(current.activeAccountId ? { activeAccountId: current.activeAccountId } : {}),
        accounts: current.accounts.map((record) => record.account.id === accountId
          ? { ...record, session: undefined }
          : record)
      });
      if (outcome.kind === "committed") bumpGeneration(accountId);
      return outcome;
    },
    markAccountReconnectRequired(accountId) {
      const current = state.snapshot;
      if (!current.accounts.some((record) => record.account.id === accountId)) {
        return { kind: "invalid", reason: "unknown-account", message: "Cannot reconnect an unknown account." };
      }
      const outcome = persist({
        ...(current.activeAccountId ? { activeAccountId: current.activeAccountId } : {}),
        accounts: current.accounts.map((record) => record.account.id === accountId
          ? {
              ...record,
              account: { ...record.account, connectionState: "reconnect_required" },
              session: undefined,
              pendingReconnect: {
                baseUrl: record.account.baseUrl,
                username: record.account.username,
                ...(record.account.label ? { label: record.account.label } : {})
              }
            }
          : record)
      });
      if (outcome.kind === "committed") bumpGeneration(accountId);
      return outcome;
    },
    switchAccount(accountId) {
      const target = state.snapshot.accounts.find((record) => record.account.id === accountId);
      if (!target) {
        return { kind: "invalid", reason: "unknown-account", message: "That account is no longer available." };
      }
      if (target.pendingRemoval) {
        return { kind: "invalid", reason: "invalid-account", message: "Finish account removal before switching to that account." };
      }
      const outcome = persist({ ...state.snapshot, activeAccountId: accountId });
      if (outcome.kind === "committed") {
        for (const id of connectRevisions.keys()) {
          connectRevisions.set(id, (connectRevisions.get(id) ?? 0) + 1);
        }
      }
      return outcome;
    },
    async removeAccount(accountId, semanticPorts) {
      if (inFlightRemovals.has(accountId)) {
        return { kind: "failed", message: "Account removal is already in progress." };
      }
      const target = state.snapshot.accounts.find((record) => record.account.id === accountId)?.account;
      if (!target) {
        return { kind: "invalid", message: "That account is no longer available." };
      }
      let releaseRemoval!: () => void;
      const removalLock = new Promise<void>((resolve) => { releaseRemoval = resolve; });
      inFlightRemovals.set(accountId, removalLock);
      try {
        {
          const existing = state.snapshot.accounts.find((record) => record.account.id === accountId);
          let phase: "revoke" | "purge" = existing?.pendingRemoval?.phase ?? "revoke";
          const markPending = (nextPhase: "revoke" | "purge") => {
            const current = state.snapshot;
            const marked = persist({
              ...(current.activeAccountId ? { activeAccountId: current.activeAccountId } : {}),
              accounts: current.accounts.map((record) => record.account.id === accountId
                ? { account: record.account, pendingRemoval: { phase: nextPhase } }
                : record)
            });
            if (marked.kind === "committed") {
              bumpGeneration(accountId);
              phase = nextPhase;
            }
            return marked;
          };
          const pendingOutcome = (message: string): RegistryRemovalOutcome => ({
            kind: "pending",
            phase,
            snapshot: state.snapshot,
            message
          });

          if (phase === "revoke") {
            try {
              await semanticPorts.quiesceAccount(target);
            } catch {
              const marked = existing?.pendingRemoval?.phase === "revoke" ? { kind: "committed" as const, snapshot: state.snapshot } : markPending("revoke");
              return marked.kind === "committed"
                ? pendingOutcome("Account work could not be stopped. Retry removal to revoke it remotely.")
                : { kind: "failed", message: "Unable to save pending account removal." };
            }
            if (!existing?.pendingRemoval) {
              const marked = markPending("revoke");
              if (marked.kind !== "committed") return { kind: "failed", message: "Unable to save pending account removal." };
            }
            try {
              await semanticPorts.revokeRemoteAccount(accountId);
            } catch {
              return pendingOutcome("Account removal could not revoke remote access. Retry to continue.");
            }
            const markedPurge = markPending("purge");
            if (markedPurge.kind !== "committed") {
              return pendingOutcome("Remote access was revoked, but browser cleanup is still pending. Retry to continue.");
            }
          }

          try {
            await semanticPorts.purgeLocalAccountData(target);
          } catch {
            return pendingOutcome("Remote access was revoked, but browser cleanup did not complete. Retry to continue.");
          }
          const removed = persist(removeFromLatestSnapshot(accountId));
          if (removed.kind !== "committed") {
            return pendingOutcome("Browser cleanup completed, but account state could not be saved. Retry to finish removal.");
          }
          bumpGeneration(accountId);
          return { kind: "committed", snapshot: removed.snapshot };
        }
      } finally {
        inFlightRemovals.delete(accountId);
        releaseRemoval();
      }
    },
    retryRemovalCommit(retryToken) {
      const pending = pendingRemovals.get(retryToken);
      if (!pending || state.snapshot.accounts.some((record) => record.account.id === pending.accountId)
        || (accountGenerations.get(pending.accountId) ?? 0) !== pending.generation) {
        pendingRemovals.delete(retryToken);
        return { kind: "invalid", message: "No local account removal is pending." };
      }
      const outcome = persist(state.snapshot);
      if (outcome.kind !== "committed") {
        return { kind: "failed", message: "Unable to finish browser account cleanup." };
      }
      pendingRemovals.delete(retryToken);
      return outcome;
    }
  };
  return service;
}
