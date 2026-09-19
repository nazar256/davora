import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ConnectedAccount } from "@davora/shared";

import {
  serializePersistedAccountState,
  type PersistedAccountRecord
} from "../../src/accounts/persistedAccountStateCodec";
import {
  AccountRepositoryError,
  createAccountRepository,
  type AccountRepositorySnapshot
} from "../../src/accounts/repository";
import {
  MemoryAccountStateStorage,
  type AccountStateStorage,
  type AccountStateStorageSnapshot,
  type AccountStateStorageWriteResult
} from "../../src/accounts/storage";
import {
  assertReconnectPreauthorized,
  connectAccountCommand,
  removeAccountCommand,
  type BrowserOwnership
} from "../../src/accounts/transaction";
import { isWorkerFailure } from "../../src/http/failure";

const PROPERTY_OPTIONS = { seed: 20260901, numRuns: 250 } as const;
const PROPERTY_TEST_TIMEOUT_MS = 20_000;
const identifierArbitrary = fc.stringMatching(/^[a-z0-9_-]{1,10}$/u);
const distinctIdentifierPairArbitrary = fc.tuple(identifierArbitrary, identifierArbitrary)
  .filter(([first, second]) => first !== second);
const retryCountArbitrary = fc.integer({ min: 1, max: 7 });

const primarySecret = "property-primary-account-state-secret";

function ownership(id: string): BrowserOwnership {
  return { browserId: `browser-${id}`, browserSecret: `secret-${id}` };
}

function record(id: string, owner: BrowserOwnership): PersistedAccountRecord {
  const baseUrl = `https://${id}.example.com`;
  const account: ConnectedAccount = {
    id,
    type: "nextcloud",
    displayName: id,
    label: id,
    baseUrl,
    username: `user-${id}`,
    rootPath: "",
    backend: "nextcloud",
    connectionState: "connected",
    lastValidatedAt: "2026-09-01T00:00:00.000Z",
    cacheNamespace: `cache-${id}`
  };
  return {
    account,
    accountNonce: `nonce-${id}`,
    ownerBrowserId: owner.browserId,
    ownerBrowserSecret: owner.browserSecret,
    credentials: {
      baseUrl,
      username: account.username,
      appPassword: `password-${id}`
    }
  };
}

class AlwaysConflictStorage implements AccountStateStorage {
  readonly initial: AccountStateStorageSnapshot = { revision: 0 };
  readCalls = 0;
  compareAndSetCalls = 0;

  async read(): Promise<AccountStateStorageSnapshot> {
    this.readCalls += 1;
    return this.initial;
  }

  async compareAndSet(_expectedRevision: number, _encrypted: Parameters<AccountStateStorage["compareAndSet"]>[1]): Promise<AccountStateStorageWriteResult> {
    this.compareAndSetCalls += 1;
    return { applied: false, revision: this.initial.revision };
  }
}

function accountEntries(snapshot: AccountRepositorySnapshot): readonly [string, PersistedAccountRecord][] {
  return [...snapshot.accounts.entries()];
}

function revocationEntries(snapshot: AccountRepositorySnapshot): readonly [string, AccountRepositorySnapshot["revocations"] extends Map<string, infer R> ? R : never][] {
  return [...snapshot.revocations.entries()];
}

function expectWorkerFailure(
  action: () => void,
  expectedKind: "account_revoked" | "permission_denied_context"
): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(isWorkerFailure(thrown) ? thrown.kind : undefined).toBe(expectedKind);
}

describe("account repository properties", () => {
  it("keeps concurrent committed updates for randomized accounts", async () => {
    await fc.assert(
      fc.asyncProperty(distinctIdentifierPairArbitrary, async ([firstId, secondId]) => {
        const firstOwner = ownership(firstId);
        const secondOwner = ownership(secondId);
        const storage = new MemoryAccountStateStorage();
        const first = createAccountRepository({ storage, primarySecret });
        const second = createAccountRepository({ storage, primarySecret });

        await Promise.all([
          first.transact((state) => {
            state.accounts.set(firstId, record(firstId, firstOwner));
            return { changed: true, value: firstId };
          }),
          second.transact((state) => {
            state.accounts.set(secondId, record(secondId, secondOwner));
            return { changed: true, value: secondId };
          })
        ]);

        const snapshot = await first.snapshot();
        expect([...snapshot.accounts.keys()].sort()).toEqual([firstId, secondId].sort());
        expect(snapshot.revision).toBe(2);
        expect(snapshot.accounts.get(firstId)?.ownerBrowserId).toBe(firstOwner.browserId);
        expect(snapshot.accounts.get(secondId)?.ownerBrowserId).toBe(secondOwner.browserId);
      }),
      PROPERTY_OPTIONS
    );
  }, PROPERTY_TEST_TIMEOUT_MS);

  it("rejects foreign account mutations without changing any account and keeps revocation terminal", async () => {
    await fc.assert(
      fc.asyncProperty(distinctIdentifierPairArbitrary, async ([firstId, secondId]) => {
        const firstOwner = ownership(firstId);
        const secondOwner = ownership(secondId);
        const firstRecord = record(firstId, firstOwner);
        const secondRecord = record(secondId, secondOwner);
        const storage = new MemoryAccountStateStorage();
        const repository = createAccountRepository({ storage, primarySecret });

        await repository.transact((state) => connectAccountCommand(state, firstRecord, false, firstOwner));
        await repository.transact((state) => connectAccountCommand(state, secondRecord, false, secondOwner));
        const before = await repository.snapshot();

        await expect(repository.transact((state) => connectAccountCommand(state, firstRecord, false, secondOwner)))
          .rejects.toMatchObject({ kind: "permission_denied_context" });
        await expect(repository.transact((state) => connectAccountCommand(state, secondRecord, false, firstOwner)))
          .rejects.toMatchObject({ kind: "permission_denied_context" });
        const afterForeignAttempts = await repository.snapshot();
        expect(accountEntries(afterForeignAttempts)).toEqual(accountEntries(before));
        expect(revocationEntries(afterForeignAttempts)).toEqual(revocationEntries(before));
        expect(afterForeignAttempts.revision).toBe(before.revision);

        await repository.transact((state) => removeAccountCommand(state, firstId, firstOwner, () => `revocation-${firstId}`));
        const revoked = await repository.snapshot();
        expect(revoked.accounts.has(firstId)).toBe(false);
        expect(revoked.revocations.get(firstId)?.ownerBrowserId).toBe(firstOwner.browserId);
        expectWorkerFailure(
          () => assertReconnectPreauthorized(revoked, firstId, firstOwner),
          "account_revoked"
        );
        expectWorkerFailure(
          () => assertReconnectPreauthorized(revoked, firstId, secondOwner),
          "permission_denied_context"
        );
        expectWorkerFailure(
          () => connectAccountCommand(revoked, firstRecord, true, firstOwner),
          "account_revoked"
        );
        expectWorkerFailure(
          () => connectAccountCommand(revoked, firstRecord, true, secondOwner),
          "permission_denied_context"
        );
        expect(revoked.accounts.get(secondId)).toEqual(secondRecord);
      }),
      PROPERTY_OPTIONS
    );
  }, PROPERTY_TEST_TIMEOUT_MS);

  it("keeps snapshots and command inputs isolated from caller mutation", async () => {
    await fc.assert(
      fc.asyncProperty(identifierArbitrary, async (id) => {
        const owner = ownership(id);
        const input = record(id, owner);
        const inputBefore = structuredClone(input);
        const repository = createAccountRepository({
          storage: new MemoryAccountStateStorage(),
          primarySecret
        });

        await repository.transact((state) => connectAccountCommand(state, input, false, owner));
        expect(input).toEqual(inputBefore);

        const callerSnapshot = await repository.snapshot();
        const callerRecord = callerSnapshot.accounts.get(id);
        if (!callerRecord) throw new Error("Property setup did not persist the account.");
        callerRecord.account.displayName = "caller-mutated";
        if (callerRecord.credentials) callerRecord.credentials.appPassword = "caller-mutated";
        callerSnapshot.accounts.clear();
        callerSnapshot.revocations.clear();

        const persistedSnapshot = await repository.snapshot();
        expect(persistedSnapshot.accounts.get(id)?.account.displayName).toBe(id);
        expect(persistedSnapshot.accounts.get(id)?.credentials?.appPassword).toBe(`password-${id}`);
      }),
      PROPERTY_OPTIONS
    );
  }, PROPERTY_TEST_TIMEOUT_MS);

  it("stops after the configured number of CAS conflicts", async () => {
    await fc.assert(
      fc.asyncProperty(retryCountArbitrary, async (maxAttempts) => {
        const storage = new AlwaysConflictStorage();
        const repository = createAccountRepository({ storage, primarySecret, maxAttempts });

        await expect(repository.transact((state) => {
          state.accounts.set("retry", record("retry", ownership("retry")));
          return { changed: true, value: true };
        })).rejects.toMatchObject({
          operation: "write"
        });
        expect(storage.readCalls).toBe(maxAttempts);
        expect(storage.compareAndSetCalls).toBe(maxAttempts);
      }),
      PROPERTY_OPTIONS
    );
  }, PROPERTY_TEST_TIMEOUT_MS);

  it("fails closed on randomized corrupt encrypted state without replacing it", async () => {
    await fc.assert(
      fc.asyncProperty(identifierArbitrary, async (id) => {
        const encrypted = await serializePersistedAccountState(
          [record(id, ownership(id))],
          [],
          primarySecret
        );
        const corrupted = {
          ...encrypted,
          ciphertext: `${encrypted.ciphertext}A`
        };
        const storage = new MemoryAccountStateStorage({ revision: 3, encrypted: corrupted });
        const repository = createAccountRepository({ storage, primarySecret });

        await expect(repository.snapshot()).rejects.toBeInstanceOf(AccountRepositoryError);
        await expect(storage.read()).resolves.toEqual({ revision: 3, encrypted: corrupted });
      }),
      PROPERTY_OPTIONS
    );
  }, PROPERTY_TEST_TIMEOUT_MS);

  it("replays the same randomized command sequence deterministically", async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctIdentifierPairArbitrary,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
        async ([firstId, secondId], commands) => {
          const firstOwner = ownership(firstId);
          const secondOwner = ownership(secondId);
          const first = createAccountRepository({ storage: new MemoryAccountStateStorage(), primarySecret });
          const second = createAccountRepository({ storage: new MemoryAccountStateStorage(), primarySecret });

          for (const useFirst of commands) {
            const id = useFirst ? firstId : secondId;
            const owner = useFirst ? firstOwner : secondOwner;
            const account = record(id, owner);
            await first.transact((state) => connectAccountCommand(state, account, false, owner));
            await second.transact((state) => connectAccountCommand(state, account, false, owner));
          }

          const firstSnapshot = await first.snapshot();
          const secondSnapshot = await second.snapshot();
          expect(firstSnapshot.revision).toBe(secondSnapshot.revision);
          expect(accountEntries(firstSnapshot)).toEqual(accountEntries(secondSnapshot));
          expect(revocationEntries(firstSnapshot)).toEqual(revocationEntries(secondSnapshot));
        }
      ),
      PROPERTY_OPTIONS
    );
  }, PROPERTY_TEST_TIMEOUT_MS);
});
