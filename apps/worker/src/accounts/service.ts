import { buildCapabilitySet, normalizeRootPath, type ConnectedAccount } from "@davora/shared";

import { normalizeAccountLabel, normalizeNextcloudBaseUrl, validateNextcloudAppPassword, validateNextcloudUsername } from "../config";
import { resetMockEntries } from "../mock/data";
import { NextcloudClient } from "../nextcloud/client";
import { createNextcloudDestinationPolicy } from "../security/nextcloudDestinationPolicy";
import type { AuthorizedAccountContext, NextcloudAccountCredentials, WorkerEnv } from "../types";
import { workerFailure } from "../http/failure";
import type { PersistedAccountRecord } from "./persistedAccountStateCodec";
import type { AccountRepository } from "./repository";
import {
  assertAccountOwner,
  assertReconnectPreauthorized,
  connectAccountCommand,
  removeAccountCommand,
  type BrowserOwnership
} from "./transaction";

export interface ConnectAccountInput extends BrowserOwnership {
  readonly accountId?: string;
  readonly cacheNamespace?: string;
  readonly baseUrl: string;
  readonly username: string;
  readonly appPassword: string;
  readonly rootPath?: string;
  readonly label?: string;
}

export interface AccountService {
  connectAccount(input: ConnectAccountInput): Promise<{ account: ConnectedAccount }>;
  removeAccount(accountId: string, owner: BrowserOwnership): Promise<boolean>;
  resolveForSession(accountId: string, owner: BrowserOwnership): Promise<AuthorizedAccountContext>;
  resolveAuthorized(accountId: string): Promise<AuthorizedAccountContext>;
  clear(): Promise<void>;
}

export interface CreateAccountServiceInput {
  readonly repository: AccountRepository;
  readonly env: WorkerEnv;
  readonly validateAccount?: (
    credentials: NextcloudAccountCredentials,
    rootPath: string,
    env: WorkerEnv
  ) => Promise<void>;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly resetMockAccount?: (accountId: string) => void;
}

function createDisplayName(label: string | undefined, username: string, baseUrl: string): string {
  return label ?? `${username}@${new URL(baseUrl).hostname}`;
}

function toAuthorizedContext(record: PersistedAccountRecord): AuthorizedAccountContext {
  return {
    account: { ...record.account },
    accountNonce: record.accountNonce,
    ...(record.credentials ? { credentials: { ...record.credentials } } : {}),
    capabilities: buildCapabilitySet(record.account.backend, { readOnly: false })
  };
}

async function validateLiveAccount(
  credentials: NextcloudAccountCredentials,
  rootPath: string,
  env: WorkerEnv
): Promise<void> {
  const destinationPolicy = createNextcloudDestinationPolicy({
    runtimeMode: env.RUNTIME_MODE,
    allowLocalNextcloud: env.ALLOW_LOCAL_NEXTCLOUD,
    allowedHosts: env.NEXTCLOUD_ALLOWED_HOSTS,
    allowAnyHost: env.RUNTIME_MODE === "production" && env.NEXTCLOUD_ALLOWED_HOSTS.length === 0
  });
  const client = new NextcloudClient({
    baseUrl: credentials.baseUrl,
    username: credentials.username,
    appPassword: credentials.appPassword,
    rootPath,
    maxFileBytes: env.NEXTCLOUD_MAX_FILE_BYTES,
    maxTextFileBytes: env.NEXTCLOUD_MAX_TEXT_FILE_BYTES
  }, undefined, destinationPolicy);
  await client.validateRoot();
}

export function createAccountService(input: CreateAccountServiceInput): AccountService {
  const createId = input.createId ?? (() => crypto.randomUUID());
  const now = input.now ?? (() => new Date());
  const validateAccount = input.validateAccount ?? validateLiveAccount;
  const resetMockAccount = input.resetMockAccount ?? resetMockEntries;

  return {
    async connectAccount(request): Promise<{ account: ConnectedAccount }> {
      const reconnectAccountId = request.accountId?.trim();
      const owner = { browserId: request.browserId, browserSecret: request.browserSecret };
      if (reconnectAccountId) {
        assertReconnectPreauthorized(await input.repository.snapshot(), reconnectAccountId, owner);
      }

      const baseUrl = normalizeNextcloudBaseUrl(
        request.baseUrl,
        input.env.NEXTCLOUD_ALLOWED_HOSTS,
        !input.env.MOCK_BACKEND,
        input.env.RUNTIME_MODE,
        input.env.ALLOW_LOCAL_NEXTCLOUD,
        input.env.MOCK_BACKEND || (input.env.RUNTIME_MODE === "production" && input.env.NEXTCLOUD_ALLOWED_HOSTS.length === 0)
      );
      const username = validateNextcloudUsername(request.username);
      const appPassword = validateNextcloudAppPassword(request.appPassword);
      const label = normalizeAccountLabel(request.label);
      const rootPath = request.rootPath?.trim() ? normalizeRootPath(request.rootPath) : input.env.NEXTCLOUD_ROOT_PATH;
      const credentials = { baseUrl, username, appPassword };
      if (!input.env.MOCK_BACKEND) await validateAccount(credentials, rootPath, input.env);

      const accountId = reconnectAccountId || createId();
      const accountNonce = createId();
      const fallbackCacheNamespace = request.cacheNamespace?.trim() || createId();
      const committed = await input.repository.transact((state) => {
        const previous = state.accounts.get(accountId);
        const account: ConnectedAccount = {
          id: accountId,
          type: "nextcloud",
          ...(label ? { label } : {}),
          displayName: createDisplayName(label, username, baseUrl),
          baseUrl,
          username,
          rootPath,
          backend: input.env.MOCK_BACKEND ? "mock" : "nextcloud",
          connectionState: "connected",
          lastValidatedAt: now().toISOString(),
          cacheNamespace: request.cacheNamespace?.trim() || previous?.account.cacheNamespace || fallbackCacheNamespace
        };
        return connectAccountCommand(state, {
          account,
          accountNonce,
          ownerBrowserId: owner.browserId,
          ownerBrowserSecret: owner.browserSecret,
          credentials
        }, Boolean(reconnectAccountId), owner);
      });
      if (input.env.MOCK_BACKEND) resetMockAccount(accountId);
      return { account: { ...committed.account } };
    },

    removeAccount(accountId, owner): Promise<boolean> {
      return input.repository.transact((state) => removeAccountCommand(state, accountId, owner, createId));
    },

    async resolveForSession(accountId, owner): Promise<AuthorizedAccountContext> {
      const record = (await input.repository.snapshot()).accounts.get(accountId);
      if (!record) throw workerFailure("account_reconnect_required");
      assertAccountOwner(record, owner);
      return toAuthorizedContext(record);
    },

    async resolveAuthorized(accountId): Promise<AuthorizedAccountContext> {
      const record = (await input.repository.snapshot()).accounts.get(accountId);
      if (!record) throw workerFailure("account_reconnect_required");
      return toAuthorizedContext(record);
    },

    clear(): Promise<void> {
      return input.repository.clear();
    }
  };
}
