interface EncryptedAccountState {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
}

interface AccountStoreState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
  };
}

interface AccountStoreRequest {
  encrypted?: EncryptedAccountState;
}

interface AccountStoreResponse {
  stored: boolean;
  encrypted?: EncryptedAccountState;
}

const ACCOUNTS_KEY = "accounts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function isEncryptedAccountState(value: unknown): value is EncryptedAccountState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as EncryptedAccountState;
  return payload.version === 1 && payload.algorithm === "AES-GCM" && typeof payload.iv === "string" && typeof payload.ciphertext === "string";
}

export class AccountStoreDurableObject {
  constructor(private readonly state: AccountStoreState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/accounts") {
      return json({ message: "Not found." }, 404);
    }

    if (request.method === "GET") {
      const encrypted = await this.state.storage.get<EncryptedAccountState>(ACCOUNTS_KEY);
      const payload: AccountStoreResponse = isEncryptedAccountState(encrypted)
        ? { stored: true, encrypted }
        : { stored: false };
      return json(payload);
    }

    if (request.method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as AccountStoreRequest;
      if (!isEncryptedAccountState(body.encrypted)) {
        return json({ message: "Encrypted state is required." }, 400);
      }
      await this.state.storage.put(ACCOUNTS_KEY, body.encrypted);
      return new Response(null, { status: 204 });
    }

    return json({ message: "Method not allowed." }, 405);
  }
}
