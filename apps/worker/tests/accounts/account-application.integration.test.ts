import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { handleRequest } from "../../src/app";
import { TokenVerificationError, verifySessionToken } from "../../src/security/token";
import { deserializePersistedAccountState } from "../../src/accounts/persistedAccountStateCodec";
import { createDurableObjectEnv } from "../support/durableAccountStoreHarness";
import { authorizedRequest, connectMockAccount, createProjectTempDir, createSessionToken, env, ownerHeaders, parseErrorField, parseSessionToken, resetConnectedAccountStoreForTests } from "../support/workerApplicationHarness";

beforeEach(() => {
  resetConnectedAccountStoreForTests();
});

function encryptedFromRevisionedEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("encrypted" in value)) {
    throw new Error("Expected revisioned account-state envelope.");
  }
  return value.encrypted;
}

describe("worker account application", () => {
  it("allows selecting a per-account root folder during connection", async () => {
    const account = await connectMockAccount({ rootPath: ".davora-agent-test/docs" });
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      env
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { session: { rootPath: string; account: { rootPath: string } } } };
    expect(payload.data.session.rootPath).toBe(".davora-agent-test/docs");
    expect(payload.data.session.account.rootPath).toBe(".davora-agent-test/docs");
  })

  it("uses the configured worker root when account root input is omitted", async () => {
    const testEnv = { NEXTCLOUD_ROOT_PATH: ".davora-agent-test" };
    const account = await connectMockAccount({}, testEnv);
    expect(account.data.account.rootPath).toBe(".davora-agent-test");

    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      { ...env, ...testEnv }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { session: { rootPath: string; account: { rootPath: string } } } };
    expect(payload.data.session.rootPath).toBe(".davora-agent-test");
    expect(payload.data.session.account.rootPath).toBe(".davora-agent-test");
  })

  it("rejects account connection without browser ownership headers", async () => {
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/accounts", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:4173",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "nextcloud",
          baseUrl: "https://mock-account.example.com",
          username: "demo-user",
          appPassword: "demo-password",
          label: "Demo account"
        })
      }),
      env
    );

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { data: { code: string; message: string } };
    expect(payload.data.code).toBe("permission_denied");
    expect(payload.data.message).toMatch(/browser ownership headers/i);
  })

  it("rejects session creation when unlock code is invalid", async () => {
    const account = await connectMockAccount();
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id, unlockCode: "wrong" })
      }),
      { ...env, APP_UNLOCK_CODE: "open-sesame" }
    );

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { data: { code: string; message: string } };
    expect(payload.data.code).toBe("invalid_unlock_code");
    expect(payload.data.message).toMatch(/invalid/i);
  })

  it("rejects session creation without browser ownership headers", async () => {
    const account = await connectMockAccount();
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:4173",
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      env
    );

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { data: { code: string; message: string } };
    expect(payload.data.code).toBe("permission_denied");
    expect(payload.data.message).toMatch(/browser ownership headers/i);
  })

  it("rejects session creation from a different browser context", async () => {
    const account = await connectMockAccount();
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:4173",
          "x-davora-browser-id": "browser-beta",
          "x-davora-browser-secret": "browser-secret-beta",
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      env
    );

    expect(response.status).toBe(403);
  })

  it("isolates mock filesystem state between connected accounts", async () => {
    const first = await createSessionToken();
    const second = await handleRequest(
      new Request("http://127.0.0.1:8787/api/accounts", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:4173",
          "x-davora-browser-id": "browser-beta",
          "x-davora-browser-secret": "browser-secret-beta",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "nextcloud",
          baseUrl: "https://mock-account.example.com",
          username: "beta-user",
          appPassword: "beta-pass",
          label: "Beta"
        })
      }),
      env
    );
    const secondAccount = (await second.json()) as { data: { account: { id: string } } };
    const secondSession = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:4173",
          "x-davora-browser-id": "browser-beta",
          "x-davora-browser-secret": "browser-secret-beta",
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: secondAccount.data.account.id })
      }),
      env
    );
    const secondPayload = (await secondSession.json()) as { data: { session: { token: string } } };

    await authorizedRequest(first.token, "/api/folders", {
      method: "POST",
      body: JSON.stringify({ path: "", name: "OnlyFirst" })
  });

    const secondList = await authorizedRequest(secondPayload.data.session.token, "/api/files?path=");
    const secondListPayload = (await secondList.json()) as { data: { items: Array<{ path: string }> } };
    expect(secondListPayload.data.items.map((item) => item.path)).not.toContain("OnlyFirst");
  })

  it("can rotate session signing without changing the account-state key", async () => {
    const tokenSecret = "abcdef0123456789abcdef0123456789";
    const { token } = await createSessionToken({ SESSION_TOKEN_SECRET: tokenSecret });

    await expect(verifySessionToken(token, tokenSecret)).resolves.toHaveProperty("scope", "davora");
    await expect(verifySessionToken(token, env.SESSION_SECRET)).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it("restores a connected account after a worker-side local dev restart", async () => {
    const tempDir = await createProjectTempDir("davora-worker-state-");
    const localStatePath = join(tempDir, "worker-state.json");
    const persistedEnv = { ...env, LOCAL_DEV_STATE_PATH: localStatePath };

    const account = await connectMockAccount({ LOCAL_DEV_STATE_PATH: localStatePath });
    resetConnectedAccountStoreForTests();

    const sessionResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      persistedEnv
    );

    expect(sessionResponse.status).toBe(200);
    const payload = (await sessionResponse.json()) as { data: { session: { account: { id: string } } } };
    expect(payload.data.session.account.id).toBe(account.data.account.id);

    const persistedRaw = await readFile(localStatePath, "utf8");
    expect(persistedRaw).not.toContain("demo-password");
    expect(persistedRaw).toContain('"ciphertext"');
  })

  it("restores a connected account in durable-object-backed deployed runtime storage", async () => {
    const { env: durableEnv } = createDurableObjectEnv();

    const accountResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/accounts", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "nextcloud",
          baseUrl: "https://mock-account.example.com",
          username: "demo-user",
          appPassword: "demo-password",
          label: "Demo account"
        })
      }),
      durableEnv
    );

    expect(accountResponse.status).toBe(201);
    const accountPayload = (await accountResponse.json()) as { data: { account: { id: string } } };
    resetConnectedAccountStoreForTests();

    const sessionResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: accountPayload.data.account.id })
      }),
      durableEnv
    );

    expect(sessionResponse.status).toBe(200);
    const sessionPayload = (await sessionResponse.json()) as { data: { session: { account: { id: string } } } };
    expect(sessionPayload.data.session.account.id).toBe(accountPayload.data.account.id);
  })

  it("migrates legacy durable account state before issuing a session", async () => {
    const durable = createDurableObjectEnv();
    const accountResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/accounts", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "nextcloud",
          baseUrl: "https://mock-account.example.com",
          username: "demo-user",
          appPassword: "demo-password",
          label: "Demo account"
        })
      }),
      durable.env
    );

    expect(accountResponse.status).toBe(201);
    const accountPayload = (await accountResponse.json()) as { data: { account: { id: string } } };
    resetConnectedAccountStoreForTests();

    const accountStateSecret = "abcdef0123456789abcdef0123456789";
    const sessionTokenSecret = "0123456789abcdef0123456789abcdef";
    const migratedEnv = {
      ...durable.env,
      RUNTIME_MODE: "production",
      ACCOUNT_STATE_SECRET: accountStateSecret,
      SESSION_TOKEN_SECRET: sessionTokenSecret
    };

    const sessionResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: accountPayload.data.account.id })
      }),
      migratedEnv
    );

    expect(sessionResponse.status).toBe(200);
    const encrypted = encryptedFromRevisionedEnvelope(durable.storage.get("accounts"));
    expect((await deserializePersistedAccountState(encrypted, accountStateSecret)).kind).toBe("ready");
    expect((await deserializePersistedAccountState(encrypted, env.SESSION_SECRET)).kind).toBe("invalid");
  })

  it("fails closed on a transient durable read outage and recovers after storage is available", async () => {
    const durable = createDurableObjectEnv();

    const accountResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/accounts", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "nextcloud",
          baseUrl: "https://mock-account.example.com",
          username: "demo-user",
          appPassword: "demo-password",
          label: "Demo account"
        })
      }),
      durable.env
    );

    const accountPayload = (await accountResponse.json()) as { data: { account: { id: string } } };
    durable.setFailGetStatus(503);

    const sessionResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: accountPayload.data.account.id })
      }),
      durable.env
    );

    expect(sessionResponse.status).toBe(500);
    expect(parseErrorField(await sessionResponse.json(), "code")).toBe("internal_error");
    durable.setFailGetStatus(undefined);
    const recovered = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: JSON.stringify({ accountId: accountPayload.data.account.id })
      }),
      durable.env
    );
    expect(recovered.status).toBe(200);
  })

  it("keeps runtime and durable accounts plus existing bearer sessions when DELETE persistence fails", async () => {
    const durable = createDurableObjectEnv();
    const account = await connectMockAccount({}, durable.env);
    const sessionResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      durable.env
    );
    const token = parseSessionToken(await sessionResponse.json());
    const accountId = account.data.account.id;
    durable.setFailPutStatus(503);

    const deleteResponse = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/accounts/${accountId}`, {
        method: "DELETE",
        headers: ownerHeaders
      }),
      durable.env
    );

    expect(deleteResponse.status).toBe(500);
    expect(parseErrorField(await deleteResponse.json(), "message")).toMatch(/Account store persistence failed/i);
    const afterFailure = await handleRequest(
      new Request("http://127.0.0.1:8787/api/files?path=", {
        headers: {
          ...ownerHeaders,
          authorization: `Bearer ${token}`
        }
      }),
      durable.env
    );
    expect(afterFailure.status).toBe(200);

    resetConnectedAccountStoreForTests();
    const restoredSession = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId })
      }),
      durable.env
    );
    expect(restoredSession.status).toBe(200);
  })

  it("does not recreate an account when a delayed reconnect POST replays after DELETE", async () => {
    const durable = createDurableObjectEnv();
    const account = await connectMockAccount({}, durable.env);
    const accountId = account.data.account.id;
    durable.deferNextPut();

    const deleteRequest = handleRequest(
      new Request(`http://127.0.0.1:8787/api/accounts/${accountId}`, {
        method: "DELETE",
        headers: ownerHeaders
      }),
      durable.env
    );
    await durable.waitForDeferredPut();

    const reconnectRequest = handleRequest(
      new Request("http://127.0.0.1:8787/api/accounts", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "nextcloud",
          accountId,
          baseUrl: "https://mock-account.example.com",
          username: "demo-user",
          appPassword: "replayed-password",
          label: "Replayed account"
        })
      }),
      durable.env
    );

    durable.releaseDeferredPut();
    expect((await deleteRequest).status).toBe(204);
    expect((await reconnectRequest).status).toBe(410);

    const sessionResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId })
      }),
      durable.env
    );
    expect(sessionResponse.status).toBe(409);
  })

  it("surfaces durable persistence outages as local errors instead of reconnect-required", async () => {
    const durable = createDurableObjectEnv();
    durable.setFailPutStatus(503);

    const accountResponse = await handleRequest(
      new Request("http://127.0.0.1:8787/api/accounts", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "nextcloud",
          baseUrl: "https://mock-account.example.com",
          username: "demo-user",
          appPassword: "demo-password",
          label: "Demo account"
        })
      }),
      durable.env
    );

    expect(accountResponse.status).toBe(500);
    const payload = await accountResponse.json() as { data?: { code?: string; message?: string } };
    expect(payload.data?.code).toBe("internal_error");
    expect(payload.data?.message).toMatch(/Account store persistence failed/i);
  })

  it("restores a session after restart even when the browser attempts session creation before account hydration settles", async () => {
    const tempDir = await createProjectTempDir("davora-worker-state-");
    const localStatePath = join(tempDir, "worker-state.json");
    const persistedEnv = { ...env, LOCAL_DEV_STATE_PATH: localStatePath };

    const account = await connectMockAccount({ LOCAL_DEV_STATE_PATH: localStatePath });
    resetConnectedAccountStoreForTests();

    const firstAttempt = handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      persistedEnv
    );

    const secondAttempt = handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json"
        },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      persistedEnv
    );

    expect((await firstAttempt).status).toBe(200);
    expect((await secondAttempt).status).toBe(200);
  })

  it("removing a connected account also clears local dev persisted state", async () => {
    const tempDir = await createProjectTempDir("davora-worker-state-");
    const localStatePath = join(tempDir, "worker-state.json");
    const persistedEnv = { ...env, LOCAL_DEV_STATE_PATH: localStatePath };

    const { token, accountId } = await createSessionToken({ LOCAL_DEV_STATE_PATH: localStatePath });
    const deleteResponse = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/accounts/${accountId}`, {
        method: "DELETE",
        headers: ownerHeaders
      }),
      persistedEnv
    );

    expect(deleteResponse.status).toBe(204);
    const persistedRaw = await readFile(localStatePath, "utf8");
    expect(persistedRaw).not.toContain(accountId);

    const afterDelete = await authorizedRequest(token, "/api/files?path=");
    expect(afterDelete.status).toBe(409);
  })

  it("removing an account invalidates subsequent session use", async () => {
    const { token, accountId } = await createSessionToken();
    const deleteResponse = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/accounts/${accountId}`, {
        method: "DELETE",
        headers: ownerHeaders
      }),
      env
    );
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await authorizedRequest(token, "/api/files?path=");
    expect(afterDelete.status).toBe(409);
  })

  it("treats deleting an already removed owner-bound account as an idempotent no-op", async () => {
    const { token, accountId } = await createSessionToken();
    const firstDelete = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/accounts/${accountId}`, {
        method: "DELETE",
        headers: ownerHeaders
      }),
      env
    );
    const secondDelete = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/accounts/${accountId}`, {
        method: "DELETE",
        headers: ownerHeaders
      }),
      env
    );

    expect(firstDelete.status).toBe(204);
    const afterDelete = await authorizedRequest(token, "/api/files?path=");
    expect(afterDelete.status).toBe(409);
    expect(secondDelete.status).toBe(204);
    expect(await secondDelete.text()).toBe("");
  })

  it("rejects account deletion from a different browser context and preserves the owner session", async () => {
    const { token, accountId } = await createSessionToken();
    const deleteResponse = await handleRequest(
      new Request(`http://127.0.0.1:8787/api/accounts/${accountId}`, {
        method: "DELETE",
        headers: {
          origin: ownerHeaders.origin,
          "x-davora-browser-id": "browser-beta",
          "x-davora-browser-secret": "browser-secret-beta"
        }
      }),
      env
    );

    expect(deleteResponse.status).toBe(403);
    expect(parseErrorField(await deleteResponse.json(), "code")).toBe("permission_denied");

    const ownerRequest = await authorizedRequest(token, "/api/files?path=");
    expect(ownerRequest.status).toBe(200);
  })
  it("migrates legacy encrypted account state to a new state key", async () => {
    const tempDir = await createProjectTempDir("davora-worker-state-migration-");
    const localStatePath = join(tempDir, "worker-state.json");
    const legacyEnv = { ...env, LOCAL_DEV_STATE_PATH: localStatePath };
    const account = await connectMockAccount({}, { LOCAL_DEV_STATE_PATH: localStatePath });
    resetConnectedAccountStoreForTests();

    const accountStateSecret = "abcdef0123456789abcdef0123456789";
    const sessionTokenSecret = "0123456789abcdef0123456789abcdef";
    const migratedEnv = {
      ...legacyEnv,
      RUNTIME_MODE: "production",
      ACCOUNT_STATE_SECRET: accountStateSecret,
      SESSION_TOKEN_SECRET: sessionTokenSecret
    };
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/session", {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.data.account.id })
      }),
      migratedEnv
    );

    expect(response.status).toBe(200);
    const persisted = encryptedFromRevisionedEnvelope(JSON.parse(await readFile(localStatePath, "utf8")) as unknown);
    expect((await deserializePersistedAccountState(persisted, accountStateSecret)).kind).toBe("ready");
  });
});
