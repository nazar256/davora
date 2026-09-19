import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import type { ConnectedAccount } from "@davora/shared";

import { createBrowserAccountTransport } from "./platform/api/browserAccountTransport";
import { createBrowserOwnershipEnvironmentPort } from "./platform/security/browserOwnershipEnvironmentPort";
import { createBrowserOwnershipStoragePort } from "./platform/security/browserOwnershipStoragePort";
import { createBrowserStringStorage } from "./platform/storage/browserStringStorage";
import { createBrowserOwnershipIdentityService } from "./features/accounts/ownership";
import { buildAccount, buildSession } from "./test/accounts";

const ID_KEY = "davora-browser-id";
const SECRET_KEY = "davora-browser-secret";

function getBrowserIdentity() {
  return createBrowserOwnershipIdentityService({
    storage: createBrowserOwnershipStoragePort(createBrowserStringStorage()),
    environment: createBrowserOwnershipEnvironmentPort()
  }).read();
}

function accountTransport() {
  return createBrowserAccountTransport(createBrowserOwnershipIdentityService({
    storage: createBrowserOwnershipStoragePort(createBrowserStringStorage()),
    environment: createBrowserOwnershipEnvironmentPort()
  }));
}

const connectAccount = (...args: Parameters<ReturnType<typeof accountTransport>["connectAccount"]>) => accountTransport().connectAccount(...args);
const createSession = (...args: Parameters<ReturnType<typeof accountTransport>["createSession"]>) => accountTransport().createSession(...args);
const deleteConnectedAccount = (...args: Parameters<ReturnType<typeof accountTransport>["deleteConnectedAccount"]>) => accountTransport().deleteConnectedAccount(...args);
const getHealth = (...args: Parameters<ReturnType<typeof accountTransport>["getHealth"]>) => accountTransport().getHealth(...args);

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function stubStorage(values: Record<string, string | null> = {}) {
  const state = new Map(Object.entries(values));
  const storage = {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => state.delete(key)),
    state
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

function accountResponse(account: ConnectedAccount): Response {
  return new Response(JSON.stringify({ data: { account } }), {
    status: 201,
    headers: { "content-type": "application/json" }
  });
}

function sessionResponse(account: ConnectedAccount): Response {
  return new Response(JSON.stringify({ data: { session: buildSession(account) } }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("browser ownership identity: current behavior and Phase 4B characterization", () => {
  it("preserves both legacy key bytes and reuses the exact pair for account requests", async () => {
    const storage = stubStorage({ [ID_KEY]: "legacy-id-01", [SECRET_KEY]: "legacy-secret-01" });
    const account = buildAccount("alpha");
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/session") return sessionResponse(account);
      if (path === "/api/accounts/alpha") return new Response(null, { status: 204 });
      return accountResponse(account);
    });
    vi.stubGlobal("fetch", fetchMock);

    await connectAccount({ type: "nextcloud", baseUrl: account.baseUrl, username: account.username, appPassword: "request-only" });
    await createSession({ accountId: account.id });
    await deleteConnectedAccount(account.id);

    expect(storage.state.get(ID_KEY)).toBe("legacy-id-01");
    expect(storage.state.get(SECRET_KEY)).toBe("legacy-secret-01");
    for (const call of fetchMock.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get(ID_KEY.replace("davora-", "x-davora-"))).toBe("legacy-id-01");
      expect(headers.get(SECRET_KEY.replace("davora-", "x-davora-"))).toBe("legacy-secret-01");
    }
  });

  it("generates and persists two independent secure values when both keys are absent", () => {
    const storage = stubStorage();
    const randomUUID = vi.fn()
      .mockReturnValueOnce("uuid-id-01")
      .mockReturnValueOnce("uuid-secret-01");
    vi.stubGlobal("crypto", { randomUUID });

    expect(getBrowserIdentity()).toEqual({ browserId: "uuid-id-01", browserSecret: "uuid-secret-01" });
    expect(storage.state.get(ID_KEY)).toBe("uuid-id-01");
    expect(storage.state.get(SECRET_KEY)).toBe("uuid-secret-01");
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["one missing", { [ID_KEY]: "legacy-id-02", [SECRET_KEY]: null }, "uuid-secret-02"],
    ["one empty", { [ID_KEY]: "", [SECRET_KEY]: "legacy-secret-02" }, "uuid-id-02"]
  ] as const)("preserves the existing half for %s and creates only the missing half", (_label, initial, created) => {
    const storage = stubStorage(initial);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => created) });

    const identity = getBrowserIdentity();

    expect(identity.browserId).toBe(initial[ID_KEY] || created);
    expect(identity.browserSecret).toBe(initial[SECRET_KEY] || created);
    expect(storage.state.get(ID_KEY)).toBe(identity.browserId);
    expect(storage.state.get(SECRET_KEY)).toBe(identity.browserSecret);
  });

  it.each([
    [ID_KEY, " "],
    [SECRET_KEY, "\tcontrol"],
    [ID_KEY, "line\nfeed"],
    [SECRET_KEY, "\rreturn"]
  ] as const)(
    "fails closed for an invalid existing header value (%j), without overwrite or request",
    (invalidKey, invalidValue) => {
      const storage = stubStorage({
        [ID_KEY]: invalidKey === ID_KEY ? invalidValue : "valid-id-03",
        [SECRET_KEY]: invalidKey === SECRET_KEY ? invalidValue : "valid-secret-03"
      });
      const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
      vi.stubGlobal("fetch", fetchMock);

      expect(() => getBrowserIdentity()).toThrow(/BrowserOwnershipUnavailableError/);
      expect(storage.state.get(invalidKey)).toBe(invalidValue);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("redacts storage read failures and makes no account request", () => {
    const rawFailure = new Error("storage failure includes owner-secret-04");
    const storage = {
      getItem: vi.fn(() => { throw rawFailure; }),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };
    vi.stubGlobal("localStorage", storage);
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown;
    try {
      getBrowserIdentity();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "BrowserOwnershipUnavailableError", reason: "storage-read" });
    expect(String(thrown)).not.toContain("owner-secret-04");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["id", ID_KEY],
    ["secret", SECRET_KEY]
  ] as const)("redacts a %s write failure and does not fetch", (_label, failedKey) => {
    const values: Record<string, string | null> = { [ID_KEY]: null, [SECRET_KEY]: null };
    const storage = stubStorage(values);
    storage.setItem.mockImplementation((key: string, value: string) => {
      if (key === failedKey) throw new Error(`quota includes owner-secret-05-${key}`);
      storage.state.set(key, value);
    });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `secure-${failedKey}`) });

    let thrown: unknown;
    try {
      getBrowserIdentity();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "BrowserOwnershipUnavailableError", reason: "storage-write" });
    expect(String(thrown)).not.toContain("owner-secret-05");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses a successfully persisted half after a partial write failure", () => {
    const storage = stubStorage();
    const randomUUID = vi.fn()
      .mockReturnValueOnce("partial-id-06")
      .mockReturnValueOnce("discarded-secret-06")
      .mockReturnValueOnce("retry-secret-06");
    let writeCount = 0;
    storage.setItem.mockImplementation((key: string, value: string) => {
      writeCount += 1;
      if (writeCount === 2) throw new Error("second write failed");
      storage.state.set(key, value);
    });
    vi.stubGlobal("crypto", { randomUUID });

    expect(() => getBrowserIdentity()).toThrow(/BrowserOwnershipUnavailableError/);
    expect(getBrowserIdentity()).toEqual({ browserId: "partial-id-06", browserSecret: "retry-secret-06" });
    expect(storage.state.get(ID_KEY)).toBe("partial-id-06");
    expect(storage.state.get(SECRET_KEY)).toBe("retry-secret-06");
    expect(randomUUID).toHaveBeenCalledTimes(3);
  });

  it("uses getRandomValues when randomUUID is unavailable and never Math.random", () => {
    stubStorage();
    const randomBytes = new Uint8Array(16).fill(0xab);
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(randomBytes.subarray(0, bytes.length));
      return bytes;
    });
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Math.random is not secure"); });
    vi.stubGlobal("crypto", { getRandomValues });

    const identity = getBrowserIdentity();

    expect(getRandomValues).toHaveBeenCalled();
    expect(identity.browserId).not.toContain("Math.random");
    expect(identity.browserSecret).not.toContain("Math.random");
  });

  it("fails closed when secure randomness is unavailable for a missing key", () => {
    const storage = stubStorage({ [ID_KEY]: "valid-id-07", [SECRET_KEY]: null });
    vi.stubGlobal("crypto", {});
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("insecure entropy"); });

    let thrown: unknown;
    try {
      getBrowserIdentity();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "BrowserOwnershipUnavailableError", reason: "secure-random-unavailable" });
    expect(storage.state.get(SECRET_KEY)).toBeNull();
  });

  it("keeps an existing valid pair usable when secure randomness is unavailable", () => {
    stubStorage({ [ID_KEY]: "valid-id-08", [SECRET_KEY]: "valid-secret-08" });
    vi.stubGlobal("crypto", {});
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("insecure entropy"); });

    expect(getBrowserIdentity()).toEqual({ browserId: "valid-id-08", browserSecret: "valid-secret-08" });
  });

  it("reads the latest committed pair for every request rather than caching authority", async () => {
    const storage = stubStorage({ [ID_KEY]: "pair-a-id", [SECRET_KEY]: "pair-a-secret" });
    const account = buildAccount("alpha");
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/session") return sessionResponse(account);
      return accountResponse(account);
    });
    vi.stubGlobal("fetch", fetchMock);

    await connectAccount({ type: "nextcloud", baseUrl: account.baseUrl, username: account.username, appPassword: "first" });
    storage.state.set(ID_KEY, "pair-b-id");
    storage.state.set(SECRET_KEY, "pair-b-secret");
    await createSession({ accountId: account.id });

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-davora-browser-id")).toBe("pair-a-id");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("x-davora-browser-id")).toBe("pair-b-id");
  });

  it("does not rotate or retry when the Worker rejects a foreign/replaced identity", async () => {
    const storage = stubStorage({ [ID_KEY]: "foreign-id", [SECRET_KEY]: "foreign-secret" });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: {
      message: "browser ownership rejected",
      code: "browser_ownership_mismatch"
    } }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectAccount({ type: "nextcloud", baseUrl: "https://cloud.example.com", username: "alpha", appPassword: "request-only" }))
      .rejects.toMatchObject({ status: 403, code: "browser_ownership_mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.state.get(ID_KEY)).toBe("foreign-id");
    expect(storage.state.get(SECRET_KEY)).toBe("foreign-secret");
  });

  it("does not duplicate generation under StrictMode-like concurrent reads", async () => {
    const storage = stubStorage();
    const randomUUID = vi.fn()
      .mockReturnValueOnce("concurrent-id")
      .mockReturnValueOnce("concurrent-secret");
    vi.stubGlobal("crypto", { randomUUID });

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => getBrowserIdentity()),
      Promise.resolve().then(() => getBrowserIdentity())
    ]);

    expect(first).toEqual(second);
    expect(storage.state.get(ID_KEY)).toBe("concurrent-id");
    expect(storage.state.get(SECRET_KEY)).toBe("concurrent-secret");
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it("does not read identity or send ownership headers for health", async () => {
    const storage = stubStorage({ [ID_KEY]: "health-id", [SECRET_KEY]: "health-secret" });
    const read = storage.getItem;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: {
      app: "davora",
      configLoaded: true,
      backend: "mock",
      rootPath: ".davora-agent-test",
      unlockRequired: false,
      connectionMode: "in_app",
      supportedAccountTypes: ["nextcloud"]
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await getHealth();

    expect(read).not.toHaveBeenCalled();
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-davora-browser-id")).toBeNull();
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-davora-browser-secret")).toBeNull();
  });

  it("preserves connect, reconnect, session/unlock, and encoded delete HTTP contracts", async () => {
    stubStorage({ [ID_KEY]: "transport-id", [SECRET_KEY]: "transport-secret" });
    const account = buildAccount("alpha");
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/session") return sessionResponse(account);
      if (path.startsWith("/api/accounts/")) return new Response(null, { status: 204 });
      return accountResponse(account);
    });
    vi.stubGlobal("fetch", fetchMock);
    const connectRequest = {
      type: "nextcloud" as const,
      baseUrl: account.baseUrl,
      username: account.username,
      appPassword: "not-persisted",
      accountId: account.id,
      cacheNamespace: account.cacheNamespace
    };

    await connectAccount(connectRequest);
    await createSession({ accountId: account.id, unlockCode: "unlock-only" });
    await deleteConnectedAccount("alpha/beta");

    const connectCall = fetchMock.mock.calls[0];
    expect(String(connectCall?.[0])).toBe("/api/accounts");
    expect(connectCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(connectCall?.[1]?.body))).toEqual(connectRequest);
    expect(new Headers(connectCall?.[1]?.headers).get("x-davora-browser-id")).toBe("transport-id");
    const sessionCall = fetchMock.mock.calls[1];
    expect(JSON.parse(String(sessionCall?.[1]?.body))).toEqual({ accountId: account.id, unlockCode: "unlock-only" });
    expect(new Headers(sessionCall?.[1]?.headers).get("x-davora-browser-secret")).toBe("transport-secret");
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("/api/accounts/alpha%2Fbeta");
  });

  it("preserves normalized HTTP error mapping for account calls", async () => {
    stubStorage({ [ID_KEY]: "error-id", [SECRET_KEY]: "error-secret" });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ data: {
      message: "account rejected",
      code: "account_rejected",
      details: "stable details"
    } }), { status: 409, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectAccount({ type: "nextcloud", baseUrl: "https://cloud.example.com", username: "alpha", appPassword: "request-only" }))
      .rejects.toMatchObject({ status: 409, code: "account_rejected", details: "stable details", message: "account rejected" });
    await expect(createSession({ accountId: "alpha" })).rejects.toMatchObject({ status: 409, code: "account_rejected" });
    await expect(deleteConnectedAccount("alpha")).rejects.toMatchObject({ status: 409, code: "account_rejected" });
  });

  it("preserves delete retry behavior and ownership headers after a transient failure", async () => {
    stubStorage({ [ID_KEY]: "retry-id", [SECRET_KEY]: "retry-secret" });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { message: "temporary", code: "temporary" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteConnectedAccount("alpha")).rejects.toMatchObject({ status: 503, code: "temporary" });
    await expect(deleteConnectedAccount("alpha")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const retryHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(retryHeaders.get("x-davora-browser-id")).toBe(firstHeaders.get("x-davora-browser-id"));
    expect(retryHeaders.get("x-davora-browser-secret")).toBe(firstHeaders.get("x-davora-browser-secret"));
  });

  it.each([
    ["200 JSON", new Response(JSON.stringify({ data: {} }), { status: 200 }), "invalid_response"],
    ["200 empty", new Response(null, { status: 200 }), "invalid_response"]
  ] as const)("rejects DELETE %s as an invalid success", async (_label, response, code) => {
    stubStorage({ [ID_KEY]: "delete-id", [SECRET_KEY]: "delete-secret" });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(deleteConnectedAccount("alpha")).rejects.toMatchObject({ status: 200, code });
  });

  it("accepts only a 204 DELETE success and preserves the server error parser", async () => {
    stubStorage({ [ID_KEY]: "delete-id", [SECRET_KEY]: "delete-secret" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(deleteConnectedAccount("alpha")).resolves.toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { code: "temporary", message: "temporary" } }), { status: 503 })));
    await expect(deleteConnectedAccount("alpha")).rejects.toMatchObject({ status: 503, code: "temporary" });
  });

  it("uses shared descriptor paths for all account transport operations", () => {
    const transport = source("./platform/api/browserAccountTransport.ts");
    expect(transport).toMatch(/backendApiUrl\(connectAccountEndpoint\.path\)/);
    expect(transport).toMatch(/sessionEndpoint\.path/);
    expect(transport).toMatch(/deleteAccountEndpoint\.buildPath/);
    expect(transport).not.toMatch(/backendApiUrl\(["']\/api\/accounts["']\)/);
  });
});

describe("account transport retirement characterization", () => {
  it("has an injected account transport in AppServices and browser composition", () => {
    expect(source("./app/AppServices.ts")).toMatch(/accountTransport/);
    expect(source("./app/createBrowserAppServices.ts")).toMatch(/accountTransport/);
    expect(source("./app/createBrowserAppServices.ts")).toMatch(/createBrowserOwnershipIdentityService/);
  });

  it("does not bypass the account transport from App or session-port composition", () => {
    const app = source("./App.tsx");
    const sessionPorts = source("./app/browserAccountSessionPorts.ts");
    const apiImport = app.match(/import\s*{[^}]+}\s*from ["']\.\/lib\/api["']/)?.[0] ?? "";
    expect(apiImport).not.toMatch(/\b(connectAccount|createSession|deleteConnectedAccount|getHealth)\b/);
    expect(app).not.toMatch(/(?:import|accountCommands).*\bdeleteConnectedAccount\b/);
    expect(app).not.toMatch(/accountCommands\.connectAccount\([^)]*,\s*connectAccount\)/);
    expect(sessionPorts).not.toMatch(/from ["']\.\.\/lib\/api["']/);
  });

  it("removes the per-call raw transport from account-state workspace commands", () => {
    const ports = source("./features/accounts/workspace/ports.ts");
    expect(ports).not.toMatch(/connectAccount:\s*\(\s*request:\s*ConnectAccountRequest,\s*transport/);
    expect(ports).toMatch(/connectAccount:\s*\(request:\s*ConnectAccountRequest\)/);
  });

  it("retires account-ingress-only outer app error alternatives", () => {
    const app = source("../../worker/src/app.ts");
    const application = source("../../worker/src/http/application.ts");
    const failure = source("../../worker/src/http/failure.ts");
    expect(app).not.toMatch(/account has been revoked/i);
    expect(app).not.toMatch(/different browser context|Browser ownership headers/);
    expect(app).not.toMatch(/verifySessionToken|verifyStreamToken/);
    expect(application).toMatch(/verifySessionToken|verifyStreamToken/);
    expect(failure).toMatch(/unexpected_error/);
  });
});
