import { parseEncryptedAccountState } from "./persistedAccountStateCodec";
import type {
  AccountStateStorage,
  AccountStateStorageSnapshot,
  AccountStateStorageWriteResult
} from "./storage";

interface LocalStorageEnvelope {
  readonly revision: number;
  readonly encrypted: NonNullable<AccountStateStorageSnapshot["encrypted"]>;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseEnvelope(value: unknown): AccountStateStorageSnapshot | undefined {
  const legacy = parseEncryptedAccountState(value);
  if (legacy) return { revision: 0, encrypted: legacy };
  if (!isRecord(value)) return undefined;
  const candidate = value;
  if (Object.keys(candidate).length !== 2
    || !isRevision(candidate.revision)) return undefined;
  const encrypted = parseEncryptedAccountState(candidate.encrypted);
  return encrypted ? { revision: candidate.revision, encrypted } : undefined;
}

async function ensureParentDirectory(storagePath: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(storagePath), { recursive: true });
}

async function waitForLock(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
}

export class LocalAccountStateStorage implements AccountStateStorage {
  constructor(private readonly storagePath: string) {}

  async read(): Promise<AccountStateStorageSnapshot> {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(this.storagePath, "utf8");
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error("Local account storage envelope is invalid.");
      }
      const parsed = parseEnvelope(value);
      if (!parsed) throw new Error("Local account storage envelope is invalid.");
      return parsed;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { revision: 0 };
      throw error;
    }
  }

  private async acquireLock(): Promise<Awaited<ReturnType<typeof import("node:fs/promises")["open"]>>> {
    await ensureParentDirectory(this.storagePath);
    const { open } = await import("node:fs/promises");
    const lockPath = `${this.storagePath}.lock`;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        return await open(lockPath, "wx");
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        await waitForLock();
      }
    }
    throw new Error("Local account storage lock timed out.");
  }

  async compareAndSet(expectedRevision: number, encrypted: LocalStorageEnvelope["encrypted"]): Promise<AccountStateStorageWriteResult> {
    const lock = await this.acquireLock();
    const lockPath = `${this.storagePath}.lock`;
    try {
      const current = await this.read();
      if (current.revision !== expectedRevision) {
        return { applied: false, revision: current.revision };
      }
      const next: LocalStorageEnvelope = { revision: current.revision + 1, encrypted };
      const { rename, writeFile } = await import("node:fs/promises");
      const temporaryPath = `${this.storagePath}.write-${crypto.randomUUID()}`;
      await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.storagePath);
      return { applied: true, revision: next.revision };
    } finally {
      await lock.close();
      const { unlink } = await import("node:fs/promises");
      await unlink(lockPath).catch(() => undefined);
    }
  }
}
