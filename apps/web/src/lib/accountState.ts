import type { AppSession, CapabilitySet, ConnectedAccount } from "@davora/shared";

const STORAGE_KEY = "davora-account-state";

export interface StoredSession {
  token: string;
  expiresAt: string;
  rootPath: string;
  capabilities?: CapabilitySet;
}

export interface StoredAccountRecord {
  account: ConnectedAccount;
  session?: StoredSession;
  pendingReconnect?: {
    baseUrl: string;
    username: string;
    label?: string;
  };
}

export interface PersistedState {
  activeAccountId?: string;
  accounts: StoredAccountRecord[];
}

function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function sanitizeSession(session: StoredSession | undefined): StoredSession | undefined {
  if (!session) {
    return undefined;
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    return undefined;
  }
  return session;
}

export function loadAccountState(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { accounts: [] };
  }

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts
          .filter((record): record is StoredAccountRecord => Boolean(record?.account?.id))
          .map((record) => ({ ...record, session: sanitizeSession(record.session) }))
      : [];
    const activeAccountId = parsed.activeAccountId && accounts.some((record) => record.account.id === parsed.activeAccountId)
      ? parsed.activeAccountId
      : accounts[0]?.account.id;
    const state = { activeAccountId, accounts };
    saveState(state);
    return state;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return { accounts: [] };
  }
}

export function saveConnectedAccount(account: ConnectedAccount): PersistedState {
  const state = loadAccountState();
  const existing = state.accounts.find((record) => record.account.id === account.id);
  const nextRecord: StoredAccountRecord = {
    account,
    ...(existing?.session ? { session: undefined } : {})
  };
  const accounts = state.accounts.some((record) => record.account.id === account.id)
    ? state.accounts.map((record) => (record.account.id === account.id ? nextRecord : record))
    : [...state.accounts, nextRecord];
  const nextState = {
    activeAccountId: account.id,
    accounts
  };
  saveState(nextState);
  return nextState;
}

export function saveAccountSession(accountId: string, session: AppSession): PersistedState {
  const state = loadAccountState();
  const accounts = state.accounts.map((record) => record.account.id === accountId
    ? {
        ...record,
        account: session.account,
        session: {
          token: session.token,
          expiresAt: session.expiresAt,
          rootPath: session.rootPath,
          capabilities: session.capabilities
        }
      }
    : record);
  const nextState = { activeAccountId: state.activeAccountId ?? accountId, accounts };
  saveState(nextState);
  return nextState;
}

export function clearAccountSession(accountId: string): PersistedState {
  const state = loadAccountState();
  const nextState = {
    activeAccountId: state.activeAccountId,
    accounts: state.accounts.map((record) => record.account.id === accountId ? { ...record, session: undefined } : record)
  };
  saveState(nextState);
  return nextState;
}

export function setActiveAccountId(accountId: string): PersistedState {
  const state = loadAccountState();
  if (!state.accounts.some((record) => record.account.id === accountId)) {
    return state;
  }
  const nextState = { ...state, activeAccountId: accountId };
  saveState(nextState);
  return nextState;
}

export function markAccountReconnectRequired(accountId: string): PersistedState {
  const state = loadAccountState();
  const nextState = {
    activeAccountId: state.activeAccountId,
    accounts: state.accounts.map((record) => record.account.id === accountId
      ? {
          ...record,
          account: {
            ...record.account,
            connectionState: "reconnect_required" as const
          },
          session: undefined,
          pendingReconnect: {
            baseUrl: record.account.baseUrl,
            username: record.account.username,
            ...(record.account.label ? { label: record.account.label } : {})
          }
        }
      : record)
  };
  saveState(nextState);
  return nextState;
}

export function removeStoredAccount(accountId: string): PersistedState {
  const state = loadAccountState();
  const accounts = state.accounts.filter((record) => record.account.id !== accountId);
  const nextState = {
    activeAccountId: state.activeAccountId === accountId ? accounts[0]?.account.id : state.activeAccountId,
    accounts
  };
  saveState(nextState);
  return nextState;
}

export function clearStoredAccounts(): void {
  localStorage.removeItem(STORAGE_KEY);
}
