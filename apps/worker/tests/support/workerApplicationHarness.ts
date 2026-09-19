import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect } from "vitest";
import { appSessionSchema, connectAccountSuccessSchema, sessionSuccessSchema } from "@davora/shared";

import { handleRequest } from "../../src/app";
import { MemoryAccountStateStorage } from "../../src/accounts/storage";
import { createNextcloudDestinationPolicy } from "../../src/security/nextcloudDestinationPolicy";

export const testNextcloudPolicy = createNextcloudDestinationPolicy({ runtimeMode: "production", allowLocalNextcloud: false, allowedHosts: ["nextcloud.ownhost.top"] });

const memoryAccountStorage = new MemoryAccountStateStorage();

export const env = {
  SESSION_SECRET: "secret",
  RUNTIME_MODE: "development",
  MOCK_BACKEND: "true",
  ALLOWED_ORIGINS: "http://127.0.0.1:4173",
  ACCOUNT_STATE_STORAGE: memoryAccountStorage
};

export const ownerHeaders = {
  origin: "http://127.0.0.1:4173",
  "x-davora-browser-id": "browser-alpha",
  "x-davora-browser-secret": "browser-secret"
};

export const resetConnectedAccountStoreForTests = (): void => {
  memoryAccountStorage.reset();
};

export async function createProjectTempDir(prefix: string): Promise<string> {
  const baseDir = resolve(process.cwd(), "../../.tmp/worker-tests");
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, prefix));
}

export async function connectMockAccount(overrides: Record<string, string> = {}, envOverrides: Record<string, unknown> = overrides) {
  const response = await handleRequest(
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
        label: "Demo account",
        ...overrides
      })
    }),
    { ...env, ...envOverrides }
  );

  expect(response.status).toBeLessThan(300);
  return connectAccountSuccessSchema.parse(await response.json());
}

export async function createSessionToken(overrides: Record<string, string> = {}) {
  const account = await connectMockAccount(overrides);
  const response = await handleRequest(
    new Request("http://127.0.0.1:8787/api/session", {
      method: "POST",
      headers: {
        ...ownerHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({ accountId: account.data.account.id, ...(overrides.APP_UNLOCK_CODE ? { unlockCode: overrides.APP_UNLOCK_CODE } : {}) })
    }),
    { ...env, ...overrides }
  );

  const payload = sessionSuccessSchema.parse(await response.json());
  return { token: payload.data.session.token, accountId: payload.data.session.account.id };
}

export function parseSessionToken(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) {
    throw new Error("Session response envelope was invalid.");
  }
  const data = payload.data;
  if (typeof data !== "object" || data === null || !("session" in data)) {
    throw new Error("Session response envelope was invalid.");
  }
  return appSessionSchema.parse(data.session).token;
}

export function parseErrorField(payload: unknown, field: "code" | "message"): string {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) {
    throw new Error("Error response envelope was invalid.");
  }
  const data = payload.data;
  if (typeof data !== "object" || data === null) {
    throw new Error("Error response envelope was invalid.");
  }
  if (field === "code") {
    if (!("code" in data) || typeof data.code !== "string") {
      throw new Error("Error response field was invalid.");
    }
    return data.code;
  }
  if (!("message" in data) || typeof data.message !== "string") {
    throw new Error("Error response field was invalid.");
  }
  return data.message;
}

export async function authorizedRequest(token: string, input: string, init: RequestInit = {}) {
  return handleRequest(
    new Request("http://127.0.0.1:8787" + input, {
      ...init,
      headers: {
        origin: "http://127.0.0.1:4173",
        authorization: "Bearer " + token,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers
      }
    }),
    env
  );
}
