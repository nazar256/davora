import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCapabilitySet } from "@davora/shared";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { handleRequest } from "../src/app";
import { loadConfig } from "../src/config";
import { createFileBackend } from "../src/files/createFileBackend";
import { serializePersistedAccountState } from "../src/accounts/persistedAccountStateCodec";
import { MemoryAccountStateStorage } from "../src/accounts/storage";

const accountStorage = new MemoryAccountStateStorage();

const baseEnv = {
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  MOCK_BACKEND: "false",
  RUNTIME_MODE: "production",
  ALLOW_LOCAL_NEXTCLOUD: "false",
  NEXTCLOUD_ALLOWED_HOSTS: "nextcloud.ownhost.top",
  ALLOWED_ORIGINS: "http://127.0.0.1:4173",
  ACCOUNT_STATE_STORAGE: accountStorage
};

const headers = {
  origin: "http://127.0.0.1:4173",
  "x-davora-browser-id": "browser-a",
  "x-davora-browser-secret": "secret-a",
  "content-type": "application/json"
};

function connectRequest(baseUrl: string, accountId?: string, owner = headers) {
  return new Request("http://127.0.0.1:8787/api/accounts", {
    method: "POST",
    headers: owner,
    body: JSON.stringify({ type: "nextcloud", baseUrl, username: "alice", appPassword: "password", ...(accountId ? { accountId } : {}) })
  });
}

describe("account/session SSRF remediation", () => {
  beforeEach(() => {
    accountStorage.reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "https://localhost",
    "https://127.0.0.1",
    "https://2130706433",
    "https://192.168.1.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://metadata.google.internal",
    "http://nextcloud.ownhost.top",
    "https://nextcloud.ownhost.top.evil.example"
  ])("rejects %s at public account ingress with zero outbound fetches", async (baseUrl) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));
    const response = await handleRequest(connectRequest(baseUrl), baseEnv);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the exact allowed host and rejects a foreign reconnect before fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/alice/.davora-agent-test</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>.davora-agent-test</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>',
      { status: 207 }
    ));
    const created = await handleRequest(connectRequest("https://nextcloud.ownhost.top"), baseEnv);
    expect(created.status).toBe(201);
    const createdPayload = await created.json() as { data: { account: { id: string } } };
    fetchMock.mockClear();

    const foreign = await handleRequest(connectRequest("https://nextcloud.ownhost.top", createdPayload.data.account.id, {
      ...headers,
      "x-davora-browser-id": "browser-b",
      "x-davora-browser-secret": "secret-b"
    }), baseEnv);
    expect(foreign.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    const foreignBlocked = await handleRequest(connectRequest("https://localhost", createdPayload.data.account.id, {
      ...headers,
      "x-davora-browser-id": "browser-b",
      "x-davora-browser-secret": "secret-b"
    }), baseEnv);
    expect(foreignBlocked.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks foreign reconnect ownership before rejecting a blocked destination", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/alice/.davora-agent-test</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>.davora-agent-test</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>',
      { status: 207 }
    ));
    const created = await handleRequest(connectRequest("https://nextcloud.ownhost.top"), baseEnv);
    expect(created.status).toBe(201);
    const createdPayload = await created.json() as { data: { account: { id: string } } };
    fetchMock.mockClear();

    const foreign = await handleRequest(connectRequest("https://localhost", createdPayload.data.account.id, {
      ...headers,
      "x-davora-browser-id": "browser-b",
      "x-davora-browser-secret": "secret-b"
    }), baseEnv);
    expect(foreign.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("guards a persisted disallowed destination before any file fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));
    const backend = createFileBackend({
      account: {
        id: "persisted-account",
        type: "nextcloud",
        displayName: "Persisted",
        baseUrl: "https://127.0.0.1",
        username: "alice",
        rootPath: ".davora-agent-test",
        backend: "nextcloud",
        connectionState: "connected",
        lastValidatedAt: new Date().toISOString(),
        cacheNamespace: "persisted-cache"
      },
      accountNonce: "nonce",
      credentials: { baseUrl: "https://127.0.0.1", username: "alice", appPassword: "password" },
      capabilities: buildCapabilitySet("nextcloud", { readOnly: false })
    }, loadConfig({ ...baseEnv, NEXTCLOUD_ROOT_PATH: ".davora-agent-test" }));
    await expect(backend.metadata("")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hydrates a denied persisted account and rejects it through the public authorized-file route", async () => {
    const root = resolve(process.cwd(), ".tmp/worker-tests/ssrf-persisted");
    await mkdir(root, { recursive: true });
    const statePath = await mkdtemp(join(root, "state-")).then((dir) => join(dir, "accounts.json"));
    const accountId = "persisted-public-account";
    const persisted = await serializePersistedAccountState([{
      account: {
        id: accountId, type: "nextcloud", displayName: "Persisted", baseUrl: "https://127.0.0.1", username: "alice",
        rootPath: ".davora-agent-test", backend: "nextcloud", connectionState: "connected", lastValidatedAt: new Date().toISOString(), cacheNamespace: "cache"
      },
      accountNonce: "nonce", ownerBrowserId: "browser-a", ownerBrowserSecret: "secret-a",
      credentials: { baseUrl: "https://127.0.0.1", username: "alice", appPassword: "password" }
    }], [], baseEnv.SESSION_SECRET);
    await writeFile(statePath, JSON.stringify(persisted), "utf8");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));
    const session = await handleRequest(new Request("http://127.0.0.1:8787/api/session", {
      method: "POST", headers, body: JSON.stringify({ accountId })
    }), { ...baseEnv, LOCAL_DEV_STATE_PATH: statePath });
    expect(session.status).toBe(200);
    const token = (await session.json() as { data: { session: { token: string } } }).data.session.token;
    const fileResponse = await handleRequest(new Request("http://127.0.0.1:8787/api/files?path=", {
      headers: { origin: headers.origin, authorization: `Bearer ${token}` }
    }), { ...baseEnv, LOCAL_DEV_STATE_PATH: statePath });
    expect(fileResponse.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
