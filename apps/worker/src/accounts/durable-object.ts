import { parseEncryptedAccountState, type EncryptedAccountState } from "./persistedAccountStateCodec";

interface AccountStoreState {
  storage: {
    get(key: string): Promise<unknown>;
    put(key: string, value: unknown): Promise<void>;
  };
}

interface AccountStoreResponse {
  stored: boolean;
  revision: number;
  encrypted?: EncryptedAccountState;
}

interface RevisionedAccountStoreValue {
  revision: number;
  encrypted: EncryptedAccountState;
}

const ACCOUNTS_KEY = "accounts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseStoredValue(value: unknown): RevisionedAccountStoreValue | undefined {
  const legacy = parseEncryptedAccountState(value);
  if (legacy) return { revision: 0, encrypted: legacy };
  if (!isRecord(value)) return undefined;
  const candidate = value;
  if (Object.keys(candidate).length !== 2
    || typeof candidate.revision !== "number"
    || !Number.isSafeInteger(candidate.revision)
    || candidate.revision < 0) return undefined;
  const encrypted = parseEncryptedAccountState(candidate.encrypted);
  return encrypted ? { revision: candidate.revision, encrypted } : undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export class AccountStoreDurableObject {
  constructor(private readonly state: AccountStoreState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/accounts") {
      return json({ message: "Not found." }, 404);
    }

    if (request.method === "GET") {
      const stored = await this.state.storage.get(ACCOUNTS_KEY);
      if (stored === undefined) return json({ stored: false, revision: 0 });
      const parsed = parseStoredValue(stored);
      if (!parsed) return json({ message: "Stored account state is invalid." }, 500);
      const payload: AccountStoreResponse = { stored: true, revision: parsed.revision, encrypted: parsed.encrypted };
      return json(payload);
    }

    if (request.method === "PUT") {
      const parsedBody: unknown = await request.json().catch(() => undefined);
      const body = isRecord(parsedBody) ? parsedBody : {};
      const encrypted = parseEncryptedAccountState(body.encrypted);
      if (!encrypted) {
        return json({ message: "Encrypted state is required." }, 400);
      }
      const expectedRevision = body.expectedRevision;
      if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return json({ message: "Expected revision is invalid." }, 400);
      }
      const existing = await this.state.storage.get(ACCOUNTS_KEY);
      const current = existing === undefined ? { revision: 0 } : parseStoredValue(existing);
      if (!current) return json({ message: "Stored account state is invalid." }, 500);
      if (current.revision !== expectedRevision) {
        return json({ applied: false, revision: current.revision });
      }
      const next = { revision: current.revision + 1, encrypted };
      await this.state.storage.put(ACCOUNTS_KEY, next);
      return json({ applied: true, revision: next.revision });
    }

    return json({ message: "Method not allowed." }, 405);
  }
}
