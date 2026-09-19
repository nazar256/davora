import type { EncryptedAccountState } from "./persistedAccountStateCodec";

export interface AccountStateStorageSnapshot {
  readonly revision: number;
  readonly encrypted?: EncryptedAccountState;
}

export interface AccountStateStorageWriteResult {
  readonly applied: boolean;
  readonly revision: number;
}

export interface AccountStateStorage {
  read(): Promise<AccountStateStorageSnapshot>;
  compareAndSet(expectedRevision: number, encrypted: EncryptedAccountState): Promise<AccountStateStorageWriteResult>;
}

function cloneEncrypted(encrypted: EncryptedAccountState | undefined): EncryptedAccountState | undefined {
  return encrypted ? { ...encrypted } : undefined;
}

/** Explicit in-memory adapter for tests and persistence-free development only. */
export class MemoryAccountStateStorage implements AccountStateStorage {
  private revision: number;
  private encrypted: EncryptedAccountState | undefined;

  constructor(initial: AccountStateStorageSnapshot = { revision: 0 }) {
    this.revision = initial.revision;
    this.encrypted = cloneEncrypted(initial.encrypted);
  }

  async read(): Promise<AccountStateStorageSnapshot> {
    return {
      revision: this.revision,
      ...(this.encrypted ? { encrypted: cloneEncrypted(this.encrypted) } : {})
    };
  }

  async compareAndSet(expectedRevision: number, encrypted: EncryptedAccountState): Promise<AccountStateStorageWriteResult> {
    if (expectedRevision !== this.revision) {
      return { applied: false, revision: this.revision };
    }
    this.revision += 1;
    this.encrypted = cloneEncrypted(encrypted);
    return { applied: true, revision: this.revision };
  }

  reset(): void {
    this.revision = 0;
    this.encrypted = undefined;
  }
}
