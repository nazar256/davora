import { buildCapabilitySet, type ConnectedAccount } from "@davora/shared";

import { readPersistedAccounts, writePersistedAccounts } from "./local-persistence";
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

let initializedStoragePath: string | undefined;
let persistenceHydration: Promise<void> | undefined;

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

async function validateLiveAccount(credentials: NextcloudAccountCredentials, env: WorkerEnv) {
  const client = new NextcloudClient({
    baseUrl: credentials.baseUrl,
    username: credentials.username,
    appPassword: credentials.appPassword,
    rootPath: env.NEXTCLOUD_ROOT_PATH,
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
    return;
  }
  await writePersistedAccounts(env.LOCAL_DEV_STATE_PATH, runtimeAccounts.values(), env.SESSION_SECRET);
}

export async function initializeConnectedAccounts(env: WorkerEnv): Promise<void> {
  if (!env.LOCAL_DEV_STATE_PATH) {
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
  label?: string;
  browserId: string;
  browserSecret: string;
}, env: WorkerEnv): Promise<{ account: ConnectedAccount }> {
  const baseUrl = normalizeNextcloudBaseUrl(input.baseUrl, env.NEXTCLOUD_ALLOWED_HOSTS, !env.MOCK_BACKEND);
  const username = validateNextcloudUsername(input.username);
  const appPassword = validateNextcloudAppPassword(input.appPassword);
  const label = normalizeAccountLabel(input.label);

  if (!env.MOCK_BACKEND) {
    await validateLiveAccount({ baseUrl, username, appPassword }, env);
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
    rootPath: env.NEXTCLOUD_ROOT_PATH,
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
}
