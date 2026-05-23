import { buildCapabilitySet, normalizeRootPath, type ConnectedAccount } from "@davora/shared";

import { deserializePersistedAccounts, readPersistedAccounts, serializePersistedAccounts, writePersistedAccounts } from "./local-persistence";
import { normalizeAccountLabel, normalizeNextcloudBaseUrl, validateNextcloudAppPassword, validateNextcloudUsername } from "../config";
import { resetMockEntries } from "../mock/data";
import { NextcloudClient } from "../nextcloud/client";
import type { AuthorizedAccountContext, NextcloudAccountCredentials, WorkerEnv } from "../types";

interface StoredNextcloudAccount {
  account: ConnectedAccount;
  accountNonce: string;
  ownerBrowserId: string;
  ownerBrowserSecret: string;
  credentials?: NextcloudAccountCredentials;
}

const runtimeAccounts = new Map<string, StoredNextcloudAccount>();
const ACCOUNT_STORE_OBJECT_NAME = "davora-account-store";

let initializedStoragePath: string | undefined;
let persistenceHydration: Promise<void> | undefined;
let durableHydrationGeneration = 0;

function cloneRuntimeAccounts(accounts: Map<string, StoredNextcloudAccount>): Map<string, StoredNextcloudAccount> {
  return new Map(Array.from(accounts.entries(), ([accountId, record]) => [accountId, {
    account: record.account,
    accountNonce: record.accountNonce,
    ownerBrowserId: record.ownerBrowserId,
    ownerBrowserSecret: record.ownerBrowserSecret,
    credentials: record.credentials
  }]));
}

function createAccountId(): string {
  return crypto.randomUUID();
}

function createCacheNamespace(): string {
  return crypto.randomUUID();
}

function createAccountNonce(): string {
  return crypto.randomUUID();
}

function createDisplayName(label: string | undefined, username: string, baseUrl: string): string {
  if (label) {
    return label;
  }
  const host = new URL(baseUrl).hostname;
  return `${username}@${host}`;
}

async function validateLiveAccount(credentials: NextcloudAccountCredentials, rootPath: string, env: WorkerEnv) {
  const client = new NextcloudClient({
    baseUrl: credentials.baseUrl,
    username: credentials.username,
    appPassword: credentials.appPassword,
    rootPath,
    maxFileBytes: env.NEXTCLOUD_MAX_FILE_BYTES,
    maxTextFileBytes: env.NEXTCLOUD_MAX_TEXT_FILE_BYTES
  });

  await client.validateRoot();
}

function assertOwner(stored: StoredNextcloudAccount, browserId: string, browserSecret: string) {
  if (stored.ownerBrowserId !== browserId || stored.ownerBrowserSecret !== browserSecret) {
    throw new Error("Connected account belongs to a different browser context.");
  }
}

function toAuthorizedContext(stored: StoredNextcloudAccount): AuthorizedAccountContext {
  return {
    account: stored.account,
    accountNonce: stored.accountNonce,
    credentials: stored.credentials,
    capabilities: buildCapabilitySet(stored.account.backend, { readOnly: false })
  };
}

async function persistRuntimeAccounts(env: WorkerEnv): Promise<void> {
  if (!env.LOCAL_DEV_STATE_PATH) {
    if (env.DAVORA_ACCOUNT_STORE) {
      const stub = env.DAVORA_ACCOUNT_STORE.get(env.DAVORA_ACCOUNT_STORE.idFromName(ACCOUNT_STORE_OBJECT_NAME));
      const encryptedPayload = await serializePersistedAccounts(runtimeAccounts.values(), env.SESSION_SECRET);
      const response = await stub.fetch("https://davora.internal/accounts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          encrypted: encryptedPayload
        })
      });
      if (!response.ok) {
        throw new Error(`Account store persistence failed with ${response.status}.`);
      }
    }
    return;
  }
  await writePersistedAccounts(env.LOCAL_DEV_STATE_PATH, runtimeAccounts.values(), env.SESSION_SECRET);
}

async function hydrateDurableAccounts(env: WorkerEnv): Promise<void> {
  if (!env.DAVORA_ACCOUNT_STORE) {
    return;
  }

  const generation = ++durableHydrationGeneration;
  const stub = env.DAVORA_ACCOUNT_STORE.get(env.DAVORA_ACCOUNT_STORE.idFromName(ACCOUNT_STORE_OBJECT_NAME));
  const snapshot = cloneRuntimeAccounts(runtimeAccounts);
  const response = await stub.fetch("https://davora.internal/accounts");
  if (!response.ok) {
    throw new Error(`Account store hydration failed with ${response.status}.`);
  }

  const payload = await response.json().catch(() => undefined) as { stored?: boolean; encrypted?: unknown } | undefined;
  if (generation !== durableHydrationGeneration) {
    return;
  }

  if (!payload || typeof payload.stored !== "boolean") {
    runtimeAccounts.clear();
    snapshot.forEach((record, accountId) => runtimeAccounts.set(accountId, record));
    throw new Error("Account store hydration returned an invalid payload.");
  }

  if (!payload.stored) {
    runtimeAccounts.clear();
    return;
  }

  const hydrated = await deserializePersistedAccounts(payload.encrypted as Parameters<typeof deserializePersistedAccounts>[0], env.SESSION_SECRET);
  if (hydrated.size === 0 && runtimeAccounts.size > 0) {
    runtimeAccounts.clear();
    snapshot.forEach((record, accountId) => runtimeAccounts.set(accountId, record));
    throw new Error("Account store hydration could not decrypt persisted accounts.");
  }

  runtimeAccounts.clear();
  for (const record of hydrated.values()) {
    if (!record?.account?.id || !record.accountNonce || !record.ownerBrowserId || !record.ownerBrowserSecret) {
      continue;
    }
    runtimeAccounts.set(record.account.id, {
      account: record.account,
      accountNonce: record.accountNonce,
      ownerBrowserId: record.ownerBrowserId,
      ownerBrowserSecret: record.ownerBrowserSecret,
      credentials: record.credentials
    });
    if (env.MOCK_BACKEND) {
      resetMockEntries(record.account.id);
    }
  }
}

export async function initializeConnectedAccounts(env: WorkerEnv): Promise<void> {
  if (!env.LOCAL_DEV_STATE_PATH) {
    if (env.DAVORA_ACCOUNT_STORE) {
      persistenceHydration ??= Promise.resolve();
      persistenceHydration = persistenceHydration.then(async () => {
        const hadRuntimeAccounts = runtimeAccounts.size > 0;
        try {
          await hydrateDurableAccounts(env);
        } catch (error) {
          if (hadRuntimeAccounts) {
            return;
          }
          throw error;
        }
      });
      return persistenceHydration;
    }
    initializedStoragePath = undefined;
    persistenceHydration = undefined;
    return;
  }

  if (initializedStoragePath === env.LOCAL_DEV_STATE_PATH && persistenceHydration) {
    return persistenceHydration;
  }

  initializedStoragePath = env.LOCAL_DEV_STATE_PATH;
  persistenceHydration = (async () => {
    const persisted = await readPersistedAccounts(env.LOCAL_DEV_STATE_PATH!, env.SESSION_SECRET);
    runtimeAccounts.clear();
    persisted.forEach((record, accountId) => {
      runtimeAccounts.set(accountId, {
        account: record.account,
        accountNonce: record.accountNonce,
        ownerBrowserId: record.ownerBrowserId,
        ownerBrowserSecret: record.ownerBrowserSecret,
        credentials: record.credentials
      });
      if (env.MOCK_BACKEND) {
        resetMockEntries(accountId);
      }
    });
  })();

  return persistenceHydration;
}

export async function connectAccount(input: {
  accountId?: string;
  cacheNamespace?: string;
  baseUrl: string;
  username: string;
  appPassword: string;
  rootPath?: string;
  label?: string;
  browserId: string;
  browserSecret: string;
}, env: WorkerEnv): Promise<{ account: ConnectedAccount }> {
  const baseUrl = normalizeNextcloudBaseUrl(input.baseUrl, env.NEXTCLOUD_ALLOWED_HOSTS, !env.MOCK_BACKEND);
  const username = validateNextcloudUsername(input.username);
  const appPassword = validateNextcloudAppPassword(input.appPassword);
  const label = normalizeAccountLabel(input.label);
  const rootPath = input.rootPath?.trim() ? normalizeRootPath(input.rootPath) : env.NEXTCLOUD_ROOT_PATH;

  if (!env.MOCK_BACKEND) {
    await validateLiveAccount({ baseUrl, username, appPassword }, rootPath, env);
  }

  const now = new Date().toISOString();
  const accountId = input.accountId?.trim() || createAccountId();
  const previous = runtimeAccounts.get(accountId);
  if (previous) {
    assertOwner(previous, input.browserId, input.browserSecret);
  }
  const account: ConnectedAccount = {
    id: accountId,
    type: "nextcloud",
    ...(label ? { label } : {}),
    displayName: createDisplayName(label, username, baseUrl),
    baseUrl,
    username,
    rootPath,
    backend: env.MOCK_BACKEND ? "mock" : "nextcloud",
    connectionState: "connected",
    lastValidatedAt: now,
    cacheNamespace: input.cacheNamespace?.trim() || previous?.account.cacheNamespace || createCacheNamespace()
  };

  runtimeAccounts.set(accountId, {
    account,
    accountNonce: createAccountNonce(),
    ownerBrowserId: input.browserId,
    ownerBrowserSecret: input.browserSecret,
    credentials: { baseUrl, username, appPassword }
  });
  if (env.MOCK_BACKEND) {
    resetMockEntries(accountId);
  }

  await persistRuntimeAccounts(env);

  return { account };
}

export function resolveAccountForSession(accountId: string, browserId: string, browserSecret: string): AuthorizedAccountContext {
  const stored = runtimeAccounts.get(accountId);
  if (!stored) {
    throw new Error("Connected account is no longer available. Reconnect this account.");
  }
  assertOwner(stored, browserId, browserSecret);
  return toAuthorizedContext(stored);
}

export function resolveAuthorizedAccount(accountId: string): AuthorizedAccountContext {
  const stored = runtimeAccounts.get(accountId);
  if (!stored) {
    throw new Error("Connected account is no longer available. Reconnect this account.");
  }
  return toAuthorizedContext(stored);
}

export function removeConnectedAccount(accountId: string, browserId: string, browserSecret: string): boolean {
  const stored = runtimeAccounts.get(accountId);
  if (!stored) {
    return false;
  }
  assertOwner(stored, browserId, browserSecret);
  return runtimeAccounts.delete(accountId);
}

export async function removeConnectedAccountAndPersist(
  accountId: string,
  browserId: string,
  browserSecret: string,
  env: WorkerEnv
): Promise<boolean> {
  const removed = removeConnectedAccount(accountId, browserId, browserSecret);
  if (removed) {
    await persistRuntimeAccounts(env);
  }
  return removed;
}

export function clearConnectedAccounts(): void {
  runtimeAccounts.clear();
}

export async function clearConnectedAccountsAndPersist(env: WorkerEnv): Promise<void> {
  clearConnectedAccounts();
  await persistRuntimeAccounts(env);
}

export function resetConnectedAccountStoreForTests(): void {
  runtimeAccounts.clear();
  initializedStoragePath = undefined;
  persistenceHydration = undefined;
  durableHydrationGeneration = 0;
}
