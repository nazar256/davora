import { describe, expect, it } from "vitest";

import { handleRequest } from "../src/app";
import { deserializePersistedAccountState } from "../src/accounts/persistedAccountStateCodec";

const baseEnv = {
  SESSION_SECRET: "test-session-secret",
  RUNTIME_MODE: "development",
  MOCK_BACKEND: "true",
  ALLOWED_ORIGINS: "http://127.0.0.1:4173"
};

const ownerHeaders = {
  origin: "http://127.0.0.1:4173",
  "x-davora-browser-id": "browser-alpha",
  "x-davora-browser-secret": "browser-secret"
};

function encryptedFromRevisionedEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("encrypted" in value)) {
    throw new Error("Expected revisioned account-state envelope.");
  }
  return value.encrypted;
}

function createDurableHarness() {
  const storage = new Map<string, unknown>();
  let durableObjectModule: Promise<typeof import("../src/accounts/durable-object")> | undefined;
  let failPut = false;

  const env = {
    ...baseEnv,
    DAVORA_ACCOUNT_STORE: {
      idFromName(name: string) {
        return { toString: () => name };
      },
      get() {
        return {
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            durableObjectModule ??= import("../src/accounts/durable-object");
            const { AccountStoreDurableObject } = await durableObjectModule;
            const object = new AccountStoreDurableObject({
              storage: {
                async get(key: string) {
                  return storage.get(key);
                },
                async put(key: string, value: unknown) {
                  storage.set(key, value);
                }
              }
            });
            const request = input instanceof Request ? input : new Request(String(input), init);
            if (failPut && request.method === "PUT") {
              return new Response(null, { status: 503 });
            }
            return object.fetch(request);
          }
        };
      }
    }
  };

  return {
    env,
    storage,
    setFailPut(value: boolean) {
      failPut = value;
    }
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function readAccountPayload(value: unknown): { id: string; cacheNamespace: string } {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.account)) {
    throw new Error("Account response payload was invalid.");
  }
  const account = value.data.account;
  if (typeof account.id !== "string" || typeof account.cacheNamespace !== "string") {
    throw new Error("Account response payload was invalid.");
  }
  return { id: account.id, cacheNamespace: account.cacheNamespace };
}

function readSessionToken(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.session)) {
    throw new Error("Session response payload was invalid.");
  }
  const token = value.data.session.token;
  if (typeof token !== "string") {
    throw new Error("Session response payload was invalid.");
  }
  return token;
}

async function seedLegacyV1Account(durable: ReturnType<typeof createDurableHarness>): Promise<{ id: string; cacheNamespace: string }> {
  const account = {
    id: "legacy-account",
    type: "nextcloud" as const,
    displayName: "Legacy account",
    baseUrl: "https://mock-account.example.com",
    username: "demo-user",
    rootPath: "",
    backend: "mock" as const,
    connectionState: "connected" as const,
    lastValidatedAt: "2026-07-30T00:00:00.000Z",
    cacheNamespace: "legacy-cache-namespace"
  };
  const state = {
    version: 1 as const,
    accounts: [{
      account,
      accountNonce: "legacy-account-nonce",
      ownerBrowserId: ownerHeaders["x-davora-browser-id"],
      ownerBrowserSecret: ownerHeaders["x-davora-browser-secret"],
      credentials: {
        baseUrl: account.baseUrl,
        username: account.username,
        appPassword: "legacy-app-password"
      }
    }]
  };
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(baseEnv.SESSION_SECRET));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  durable.storage.set("accounts", {
    version: 1,
    algorithm: "AES-GCM",
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  });
  return { id: account.id, cacheNamespace: account.cacheNamespace };
}

async function connectAccount(
  env: Record<string, unknown>,
  overrides: Record<string, string> = {}
): Promise<{ id: string; cacheNamespace: string }> {
  const response = await handleRequest(
    new Request("http://127.0.0.1:8787/api/accounts", {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        type: "nextcloud",
        baseUrl: "https://mock-account.example.com",
        username: "demo-user",
        appPassword: "demo-password",
        label: "Demo account",
        ...overrides
      })
    }),
    env
  );
  expect(response.status).toBeLessThan(300);
  return readAccountPayload(await response.json());
}

async function deleteAccount(env: Record<string, unknown>, accountId: string, headers = ownerHeaders): Promise<Response> {
  return handleRequest(
    new Request(`http://127.0.0.1:8787/api/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      headers
    }),
    env
  );
}

async function reconnectAccount(
  env: Record<string, unknown>,
  account: { id: string; cacheNamespace: string },
  overrides: Record<string, string> = {}
): Promise<Response> {
  return handleRequest(
    new Request("http://127.0.0.1:8787/api/accounts", {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        type: "nextcloud",
        accountId: account.id,
        cacheNamespace: account.cacheNamespace,
        baseUrl: "https://mock-account.example.com",
        username: "demo-user",
        appPassword: "replacement-password",
        label: "Reconnected account",
        ...overrides
      })
    }),
    env
  );
}

async function createSessionToken(env: Record<string, unknown>, accountId: string): Promise<string> {
  const response = await handleRequest(
    new Request("http://127.0.0.1:8787/api/session", {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({ accountId })
    }),
    env
  );
  expect(response.status).toBe(200);
  return readSessionToken(await response.json());
}

async function authorizedRequest(env: Record<string, unknown>, token: string): Promise<Response> {
  return handleRequest(
    new Request("http://127.0.0.1:8787/api/files?path=", {
      headers: { ...ownerHeaders, authorization: `Bearer ${token}` }
    }),
    env
  );
}

function errorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("data" in payload)) return undefined;
  const data = payload.data;
  if (!data || typeof data !== "object" || !("code" in data)) return undefined;
  return typeof data.code === "string" ? data.code : undefined;
}

describe("Worker account revocation tombstones", () => {
  it("hydrates a persisted V1 snapshot with empty revocations before publishing a tombstone", async () => {
    const durable = createDurableHarness();
    const account = await seedLegacyV1Account(durable);

    const hydratedSession = await createSessionToken(durable.env, account.id);
    expect((await authorizedRequest(durable.env, hydratedSession)).status).toBe(200);
    const reconnectBeforeDelete = await reconnectAccount(durable.env, account);
    expect(reconnectBeforeDelete.status).toBe(200);

    const deletion = await deleteAccount(durable.env, account.id);
    expect(deletion.status).toBe(204);

    const revokedReconnect = await reconnectAccount(durable.env, account);
    expect(revokedReconnect.status).toBe(410);
    expect(errorCode(await revokedReconnect.json())).toBe("account_revoked");
  });

  it("tombstones the owner and account on successful DELETE, including an absent-id retry", async () => {
    const durable = createDurableHarness();
    const account = await connectAccount(durable.env);
    const otherBrowserHeaders = {
      origin: ownerHeaders.origin,
      "x-davora-browser-id": "browser-beta",
      "x-davora-browser-secret": "browser-beta-secret"
    };

    const firstDelete = await deleteAccount(durable.env, account.id);
    const retryDelete = await deleteAccount(durable.env, account.id);
    const foreignRetry = await deleteAccount(durable.env, account.id, otherBrowserHeaders);

    expect(firstDelete.status).toBe(204);
    expect(retryDelete.status).toBe(204);
    expect(foreignRetry.status).toBe(403);
    expect((await reconnectAccount(durable.env, account)).status).toBe(410);
  });

  it("keeps a tombstone after durable hydration/restart", async () => {
    const durable = createDurableHarness();
    const account = await connectAccount(durable.env);
    expect((await deleteAccount(durable.env, account.id)).status).toBe(204);

    const revokedReconnect = await reconnectAccount(durable.env, account);
    expect(revokedReconnect.status).toBe(410);
    expect(errorCode(await revokedReconnect.json())).toBe("account_revoked");
  });

  it("does not mutate state when explicit reconnect targets a deleted account", async () => {
    const durable = createDurableHarness();
    const account = await connectAccount(durable.env);
    expect((await deleteAccount(durable.env, account.id)).status).toBe(204);

    const revokedReconnect = await reconnectAccount(durable.env, account);
    expect(revokedReconnect.status).toBe(410);

    const freshAccount = await connectAccount(durable.env);
    expect(freshAccount.id).not.toBe(account.id);
    expect((await reconnectAccount(durable.env, account)).status).toBe(410);
  });

  it("rejects a deferred reconnect after DELETE resumes, even when validation started first", async () => {
    const durable = createDurableHarness();
    const account = await connectAccount(durable.env);
    const reconnectEnv = {
      ...durable.env,
      MOCK_BACKEND: "false",
      NEXTCLOUD_ALLOWED_HOSTS: "mock-account.example.com"
    };

    const originalFetch = globalThis.fetch;
    let releaseValidation!: (response: Response) => void;
    let markValidationStarted!: () => void;
    const validationStarted = new Promise<void>((resolve) => {
      markValidationStarted = resolve;
    });
    const validationResponse = new Promise<Response>((resolve) => {
      releaseValidation = resolve;
    });
    globalThis.fetch = async () => {
      markValidationStarted();
      return validationResponse;
    };

    try {
      const reconnect = reconnectAccount(reconnectEnv, account);
      await validationStarted;
      expect((await deleteAccount(durable.env, account.id)).status).toBe(204);
      releaseValidation(new Response(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/demo-user/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>demo-user</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`,
        { status: 207, headers: { "content-type": "application/xml" } }
      ));
      const resumed = await reconnect;
      expect(resumed.status).toBe(410);
      expect(errorCode(await resumed.json())).toBe("account_revoked");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("allows explicit reconnect after Worker loss when no tombstone exists", async () => {
    const durable = createDurableHarness();
    const account = await connectAccount(durable.env);
    durable.storage.delete("accounts");
    const reconnected = await reconnectAccount(durable.env, account);
    expect(reconnected.status).toBe(200);
    const payload = readAccountPayload(await reconnected.json());
    expect(payload.id).toBe(account.id);
    expect(payload.cacheNamespace).toBe(account.cacheNamespace);
  });

  it("does not tombstone a lost account when a foreign browser retries DELETE", async () => {
    const durable = createDurableHarness();
    const account = await connectAccount(durable.env);
    durable.storage.delete("accounts");
    const foreignBrowserHeaders = {
      origin: ownerHeaders.origin,
      "x-davora-browser-id": "browser-beta",
      "x-davora-browser-secret": "browser-beta-secret"
    };
    expect((await deleteAccount(durable.env, account.id, foreignBrowserHeaders)).status).toBe(204);

    const reconnected = await reconnectAccount(durable.env, account);
    expect(reconnected.status).toBe(200);
    const payload = readAccountPayload(await reconnected.json());
    expect(payload.id).toBe(account.id);
    expect(payload.cacheNamespace).toBe(account.cacheNamespace);

    const persisted = await deserializePersistedAccountState(encryptedFromRevisionedEnvelope(durable.storage.get("accounts")), baseEnv.SESSION_SECRET);
    expect(persisted.kind).toBe("ready");
    if (persisted.kind !== "ready") throw new Error("expected ready state");
    expect(persisted.state.revocations.size).toBe(0);
  });

  it("allows a fresh UUID account after an older account is tombstoned", async () => {
    const durable = createDurableHarness();
    const account = await connectAccount(durable.env);
    expect((await deleteAccount(durable.env, account.id)).status).toBe(204);

    const fresh = await connectAccount(durable.env, { label: "Fresh account" });
    expect(fresh.id).not.toBe(account.id);
  });

  it("does not publish a tombstone or remove the runtime account when DELETE persistence fails", async () => {
    const durable = createDurableHarness();
    const account = await connectAccount(durable.env);
    const token = await createSessionToken(durable.env, account.id);

    durable.setFailPut(true);
    const failedDelete = await deleteAccount(durable.env, account.id);
    expect(failedDelete.status).toBe(500);
    durable.setFailPut(false);

    expect((await authorizedRequest(durable.env, token)).status).toBe(200);
    expect((await authorizedRequest(durable.env, token)).status).toBe(200);
    expect((await reconnectAccount(durable.env, account)).status).toBe(200);
  });
});
