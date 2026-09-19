import { describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ConnectedAccount } from "@davora/shared";

import { deserializePersistedAccountState, serializePersistedAccountState, type PersistedAccountRecord } from "../../src/accounts/persistedAccountStateCodec";
import { AccountRepositoryError, createAccountRepository } from "../../src/accounts/repository";
import { MemoryAccountStateStorage } from "../../src/accounts/storage";
import { LocalAccountStateStorage } from "../../src/accounts/localAccountStorage";
import { DurableAccountStateStorage } from "../../src/accounts/durableAccountStorage";
import { createAccountService } from "../../src/accounts/service";
import { createAccountStateStorage } from "../../src/accounts/factory";
import type { WorkerEnv } from "../../src/types";
import { createDurableObjectEnv } from "../support/durableAccountStoreHarness";
import { createProjectTempDir } from "../support/workerApplicationHarness";

const primarySecret = "primary-account-state-secret-32-bytes";
const legacySecret = "legacy-session-state-secret-32-bytes";

function record(id: string): PersistedAccountRecord {
  const account: ConnectedAccount = {
    id,
    type: "nextcloud",
    displayName: id,
    baseUrl: "https://nextcloud.example.com",
    username: id,
    rootPath: "",
    backend: "nextcloud",
    connectionState: "connected",
    lastValidatedAt: "2026-09-01T00:00:00.000Z",
    cacheNamespace: `cache-${id}`
  };
  return {
    account,
    accountNonce: `nonce-${id}`,
    ownerBrowserId: "browser-alpha",
    ownerBrowserSecret: "browser-secret",
    credentials: {
      baseUrl: account.baseUrl,
      username: account.username,
      appPassword: `password-${id}`
    }
  };
}

describe("account repository CAS", () => {
  it("rejects two isolate-like writers using the same stale revision", async () => {
    const storage = new MemoryAccountStateStorage();
    const first = await serializePersistedAccountState([record("alpha")], [], primarySecret);
    const second = await serializePersistedAccountState([record("beta")], [], primarySecret);

    await expect(storage.compareAndSet(0, first)).resolves.toEqual({ applied: true, revision: 1 });
    await expect(storage.compareAndSet(0, second)).resolves.toEqual({ applied: false, revision: 1 });
    await expect(storage.read()).resolves.toEqual({ revision: 1, encrypted: first });
  });

  it("retries a concurrent mutation without losing either account", async () => {
    const storage = new MemoryAccountStateStorage();
    const first = createAccountRepository({ storage, primarySecret });
    const second = createAccountRepository({ storage, primarySecret });

    await Promise.all([
      first.transact((state) => {
        state.accounts.set("alpha", record("alpha"));
        return { changed: true, value: "alpha" };
      }),
      second.transact((state) => {
        state.accounts.set("beta", record("beta"));
        return { changed: true, value: "beta" };
      })
    ]);

    const snapshot = await first.snapshot();
    expect([...snapshot.accounts.keys()].sort()).toEqual(["alpha", "beta"]);
    expect(snapshot.revision).toBe(2);
  });

  it("migrates legacy-key state through CAS before returning it", async () => {
    const legacyEncrypted = await serializePersistedAccountState([record("alpha")], [], legacySecret);
    const storage = new MemoryAccountStateStorage({ revision: 0, encrypted: legacyEncrypted });
    const repository = createAccountRepository({ storage, primarySecret, legacySecret });

    expect((await repository.snapshot()).accounts.has("alpha")).toBe(true);
    const migrated = await storage.read();
    expect(migrated.revision).toBe(1);
    expect((await deserializePersistedAccountState(migrated.encrypted, primarySecret)).kind).toBe("ready");
    expect((await deserializePersistedAccountState(migrated.encrypted, legacySecret)).kind).toBe("invalid");
  });

  it("fails closed without replacing corrupt encrypted state", async () => {
    const encrypted = await serializePersistedAccountState([record("alpha")], [], legacySecret);
    const storage = new MemoryAccountStateStorage({ revision: 7, encrypted });
    const repository = createAccountRepository({ storage, primarySecret });

    await expect(repository.snapshot()).rejects.toBeInstanceOf(AccountRepositoryError);
    await expect(storage.read()).resolves.toEqual({ revision: 7, encrypted });
  });
});

describe("account storage parity", () => {
  it("selects explicit runtime persistence before the test-only memory adapter", async () => {
    const memory = new MemoryAccountStateStorage();
    const localPath = join(await createProjectTempDir("account-factory-"), "accounts.json");
    expect(createAccountStateStorage({
      SESSION_SECRET: legacySecret,
      SESSION_TTL_SECONDS: 3600,
      ALLOWED_ORIGINS: [],
      NEXTCLOUD_ROOT_PATH: "",
      NEXTCLOUD_ALLOWED_HOSTS: [],
      RUNTIME_MODE: "development",
      ALLOW_LOCAL_NEXTCLOUD: false,
      NEXTCLOUD_MAX_FILE_BYTES: 1,
      NEXTCLOUD_MAX_TEXT_FILE_BYTES: 1,
      MOCK_BACKEND: true,
      LOCAL_DEV_STATE_PATH: localPath,
      ACCOUNT_STATE_STORAGE: memory
    })).toBeInstanceOf(LocalAccountStateStorage);

    const durable = createDurableObjectEnv();
    expect(createAccountStateStorage({
      ...envForRepository(),
      DAVORA_ACCOUNT_STORE: durable.env.DAVORA_ACCOUNT_STORE,
      ACCOUNT_STATE_STORAGE: memory
    })).toBeInstanceOf(DurableAccountStateStorage);
    expect(createAccountStateStorage({ ...envForRepository(), ACCOUNT_STATE_STORAGE: memory })).toBe(memory);
    expect(() => createAccountStateStorage(envForRepository())).toThrow("Account state storage is not configured");
  });

  it("upgrades a legacy local encrypted file to a revisioned CAS envelope", async () => {
    const directory = await createProjectTempDir("account-storage-");
    const storagePath = join(directory, "accounts.json");
    const legacyEncrypted = await serializePersistedAccountState([record("alpha")], [], primarySecret);
    await writeFile(storagePath, JSON.stringify(legacyEncrypted), "utf8");
    const storage = new LocalAccountStateStorage(storagePath);

    await expect(storage.read()).resolves.toEqual({ revision: 0, encrypted: legacyEncrypted });
    const replacement = await serializePersistedAccountState([record("beta")], [], primarySecret);
    await expect(storage.compareAndSet(0, replacement)).resolves.toEqual({ applied: true, revision: 1 });
    await expect(storage.compareAndSet(0, legacyEncrypted)).resolves.toEqual({ applied: false, revision: 1 });
    expect(JSON.parse(await readFile(storagePath, "utf8"))).toEqual({ revision: 1, encrypted: replacement });
  });

  it("upgrades a legacy Durable Object value and rejects stale isolate writes", async () => {
    const durable = createDurableObjectEnv();
    const namespace = durable.env.DAVORA_ACCOUNT_STORE;
    if (!namespace) throw new Error("Durable Object namespace was not configured.");
    const legacyEncrypted = await serializePersistedAccountState([record("alpha")], [], primarySecret);
    durable.storage.set("accounts", legacyEncrypted);
    const first = new DurableAccountStateStorage(namespace);
    const second = new DurableAccountStateStorage(namespace);

    await expect(first.read()).resolves.toEqual({ revision: 0, encrypted: legacyEncrypted });
    const beta = await serializePersistedAccountState([record("beta")], [], primarySecret);
    const gamma = await serializePersistedAccountState([record("gamma")], [], primarySecret);
    await expect(first.compareAndSet(0, beta)).resolves.toEqual({ applied: true, revision: 1 });
    await expect(second.compareAndSet(0, gamma)).resolves.toEqual({ applied: false, revision: 1 });
    await expect(second.read()).resolves.toEqual({ revision: 1, encrypted: beta });
  });
});

describe("account service transaction boundaries", () => {
  it("rejects a foreign reconnect before validating its outbound destination", async () => {
    const storage = new MemoryAccountStateStorage();
    const repository = createAccountRepository({ storage, primarySecret });
    const validateAccount = vi.fn(async () => undefined);
    const env = envForRepository();
    const service = createAccountService({ repository, env, validateAccount });
    const connected = await service.connectAccount({
      baseUrl: "https://nextcloud.example.com",
      username: "alpha",
      appPassword: "alpha-password",
      browserId: "browser-alpha",
      browserSecret: "secret-alpha"
    });
    expect(validateAccount).toHaveBeenCalledTimes(1);

    await expect(service.connectAccount({
      accountId: connected.account.id,
      baseUrl: "http://127.0.0.1/private",
      username: "attacker",
      appPassword: "attacker-password",
      browserId: "browser-beta",
      browserSecret: "secret-beta"
    })).rejects.toMatchObject({ kind: "permission_denied_context" });
    expect(validateAccount).toHaveBeenCalledTimes(1);
  });
});

function envForRepository(): WorkerEnv {
  return {
    SESSION_SECRET: legacySecret,
    ACCOUNT_STATE_SECRET: primarySecret,
    SESSION_TOKEN_SECRET: "session-token-secret-32-bytes-long",
    SESSION_TTL_SECONDS: 3600,
    ALLOWED_ORIGINS: [],
    NEXTCLOUD_ROOT_PATH: "",
    NEXTCLOUD_ALLOWED_HOSTS: ["nextcloud.example.com"],
    RUNTIME_MODE: "production",
    ALLOW_LOCAL_NEXTCLOUD: false,
    NEXTCLOUD_MAX_FILE_BYTES: 64 * 1024,
    NEXTCLOUD_MAX_TEXT_FILE_BYTES: 16 * 1024,
    MOCK_BACKEND: false
  };
}
