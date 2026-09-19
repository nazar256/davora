import {
  deserializePersistedAccountState,
  serializePersistedAccountState,
  type PersistedAccountRecord,
  type PersistedAccountRevocation
} from "./persistedAccountStateCodec";
import type { AccountStateStorage, AccountStateStorageWriteResult } from "./storage";

export interface AccountRepositorySnapshot {
  readonly revision: number;
  readonly accounts: Map<string, PersistedAccountRecord>;
  readonly revocations: Map<string, PersistedAccountRevocation>;
}

export interface AccountRepositoryCommandResult<T> {
  readonly changed: boolean;
  readonly value: T;
}

export type AccountRepositoryCommand<T> = (
  state: AccountRepositorySnapshot
) => AccountRepositoryCommandResult<T>;

export interface AccountRepository {
  snapshot(): Promise<AccountRepositorySnapshot>;
  transact<T>(command: AccountRepositoryCommand<T>): Promise<T>;
  clear(): Promise<void>;
}

export interface CreateAccountRepositoryInput {
  readonly storage: AccountStateStorage;
  readonly primarySecret: string;
  readonly legacySecret?: string;
  readonly maxAttempts?: number;
}

export class AccountRepositoryError extends Error {
  constructor(
    readonly operation: "read" | "write",
    options?: ErrorOptions
  ) {
    super("Account repository operation failed.", options);
    this.name = "AccountRepositoryError";
  }
}

function repositoryError(operation: "read" | "write", error: unknown): AccountRepositoryError {
  return error instanceof AccountRepositoryError
    ? error
    : new AccountRepositoryError(operation, { cause: error });
}

function cloneRecord(record: PersistedAccountRecord): PersistedAccountRecord {
  return {
    account: { ...record.account },
    accountNonce: record.accountNonce,
    ownerBrowserId: record.ownerBrowserId,
    ownerBrowserSecret: record.ownerBrowserSecret,
    ...(record.credentials ? { credentials: { ...record.credentials } } : {})
  };
}

function cloneRevocation(revocation: PersistedAccountRevocation): PersistedAccountRevocation {
  return { ...revocation };
}

function cloneSnapshot(snapshot: AccountRepositorySnapshot): AccountRepositorySnapshot {
  return {
    revision: snapshot.revision,
    accounts: new Map([...snapshot.accounts].map(([id, record]) => [id, cloneRecord(record)])),
    revocations: new Map([...snapshot.revocations].map(([id, revocation]) => [id, cloneRevocation(revocation)]))
  };
}

class CasAccountRepository implements AccountRepository {
  private readonly maxAttempts: number;

  constructor(private readonly input: CreateAccountRepositoryInput) {
    this.maxAttempts = input.maxAttempts ?? 5;
  }

  private async readCurrent(): Promise<AccountRepositorySnapshot> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const stored = await this.input.storage.read();
      if (!stored.encrypted) {
        return { revision: stored.revision, accounts: new Map(), revocations: new Map() };
      }

      const primary = await deserializePersistedAccountState(stored.encrypted, this.input.primarySecret);
      if (primary.kind === "ready") {
        return {
          revision: stored.revision,
          accounts: new Map(primary.state.accounts),
          revocations: new Map(primary.state.revocations)
        };
      }

      const legacySecret = this.input.legacySecret;
      if (legacySecret === undefined || legacySecret === this.input.primarySecret) {
        throw new Error("Account state could not be decrypted.");
      }
      const legacy = await deserializePersistedAccountState(stored.encrypted, legacySecret);
      if (legacy.kind !== "ready") {
        throw new Error("Account state could not be decrypted.");
      }

      const migrated = await serializePersistedAccountState(
        legacy.state.accounts.values(),
        legacy.state.revocations.values(),
        this.input.primarySecret
      );
      const result = await this.input.storage.compareAndSet(stored.revision, migrated);
      if (!result.applied) continue;
      return {
        revision: result.revision,
        accounts: new Map(legacy.state.accounts),
        revocations: new Map(legacy.state.revocations)
      };
    }
    throw new Error("Account state changed too many times during key migration.");
  }

  async snapshot(): Promise<AccountRepositorySnapshot> {
    try {
      return cloneSnapshot(await this.readCurrent());
    } catch (error) {
      throw repositoryError("read", error);
    }
  }

  async transact<T>(command: AccountRepositoryCommand<T>): Promise<T> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      let current: AccountRepositorySnapshot;
      try {
        current = await this.readCurrent();
      } catch (error) {
        throw repositoryError("read", error);
      }
      const mutable = cloneSnapshot(current);
      const result = command(mutable);
      if (!result.changed) return result.value;

      let write: AccountStateStorageWriteResult;
      try {
        const encrypted = await serializePersistedAccountState(
          mutable.accounts.values(),
          mutable.revocations.values(),
          this.input.primarySecret
        );
        write = await this.input.storage.compareAndSet(current.revision, encrypted);
      } catch (error) {
        throw repositoryError("write", error);
      }
      if (write.applied) return result.value;
    }
    throw new AccountRepositoryError("write", { cause: new Error("Account state transaction conflicted too many times.") });
  }

  async clear(): Promise<void> {
    await this.transact((state) => {
      state.accounts.clear();
      state.revocations.clear();
      return { changed: true, value: undefined };
    });
  }
}

export function createAccountRepository(input: CreateAccountRepositoryInput): AccountRepository {
  return new CasAccountRepository(input);
}
