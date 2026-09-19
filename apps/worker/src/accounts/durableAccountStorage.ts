import { parseEncryptedAccountState, type EncryptedAccountState } from "./persistedAccountStateCodec";
import type { WorkerEnv } from "../types";
import type {
  AccountStateStorage,
  AccountStateStorageSnapshot,
  AccountStateStorageWriteResult
} from "./storage";

type DurableNamespace = NonNullable<WorkerEnv["DAVORA_ACCOUNT_STORE"]>;

const ACCOUNT_STORE_OBJECT_NAME = "davora-account-store";

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export class DurableAccountStateStorage implements AccountStateStorage {
  constructor(private readonly namespace: DurableNamespace) {}

  private stub() {
    return this.namespace.get(this.namespace.idFromName(ACCOUNT_STORE_OBJECT_NAME));
  }

  async read(): Promise<AccountStateStorageSnapshot> {
    const response = await this.stub().fetch("https://davora.internal/accounts");
    if (!response.ok) throw new Error(`Account store read failed with ${response.status}.`);
    const payload: unknown = await response.json().catch(() => undefined);
    if (!isRecord(payload)) {
      throw new Error("Account store response was invalid.");
    }
    const candidate = payload;
    if (candidate.stored === false && isRevision(candidate.revision)) {
      return { revision: candidate.revision };
    }
    const encrypted = parseEncryptedAccountState(candidate.encrypted);
    if (candidate.stored !== true || !isRevision(candidate.revision) || !encrypted) {
      throw new Error("Account store response was invalid.");
    }
    return { revision: candidate.revision, encrypted };
  }

  async compareAndSet(expectedRevision: number, encrypted: EncryptedAccountState): Promise<AccountStateStorageWriteResult> {
    const response = await this.stub().fetch("https://davora.internal/accounts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision, encrypted })
    });
    if (!response.ok) throw new Error(`Account store write failed with ${response.status}.`);
    const payload: unknown = await response.json().catch(() => undefined);
    if (!isRecord(payload)) {
      throw new Error("Account store write response was invalid.");
    }
    const candidate = payload;
    if (typeof candidate.applied !== "boolean" || !isRevision(candidate.revision)) {
      throw new Error("Account store write response was invalid.");
    }
    return { applied: candidate.applied, revision: candidate.revision };
  }
}
