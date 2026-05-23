import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { handleRequest } from "../src/app";
import { resetConnectedAccountStoreForTests } from "../src/accounts/store";
import { NextcloudClient } from "../src/nextcloud/client";

const env = {
  SESSION_SECRET: "secret",
  MOCK_BACKEND: "true",
  ALLOWED_ORIGINS: "http://127.0.0.1:4173"
};

const ownerHeaders = {
  origin: "http://127.0.0.1:4173",
  "x-davora-browser-id": "browser-alpha",
  "x-davora-browser-secret": "browser-secret"
};

beforeEach(() => {
  resetConnectedAccountStoreForTests();
});

async function createProjectTempDir(prefix: string): Promise<string> {
  const baseDir = resolve(process.cwd(), "../../.tmp/worker-tests");
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, prefix));
}

async function connectMockAccount(overrides: Record<string, string> = {}) {
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
    { ...env, ...overrides }
  );

  expect(response.status).toBeLessThan(300);
  return (await response.json()) as { data: { account: { id: string } } };
}

async function createSessionToken(overrides: Record<string, string> = {}) {
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

  const payload = (await response.json()) as { data: { session: { token: string; account: { id: string } } } };
  return { token: payload.data.session.token, accountId: payload.data.session.account.id };
}

async function authorizedRequest(token: string, input: string, init: RequestInit = {}) {
  return handleRequest(
    new Request(`http://127.0.0.1:8787${input}`, {
      ...init,
      headers: {
        origin: "http://127.0.0.1:4173",
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers
      }
    }),
    env
  );
}

function createDurableObjectEnv(overrides: Record<string, string> = {}) {
  const storage = new Map<string, unknown>();
  let durablePromise: Promise<typeof import("../src/accounts/durable-object")> | undefined;
  let failGetStatus: number | undefined;
  let failPutStatus: number | undefined;

  const envWithBinding = {
    ...env,
    ...overrides,
    DAVORA_ACCOUNT_STORE: {
      idFromName(name: string) {
        return { toString: () => name };
      },
      get() {
        return {
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            durablePromise ??= import("../src/accounts/durable-object");
            const { AccountStoreDurableObject } = await durablePromise;
            const object = new AccountStoreDurableObject({
              storage: {
                async get<T>(key: string) {
                  return storage.get(key) as T | undefined;
                },
                async put(key: string, value: unknown) {
                  storage.set(key, value);
                }
              }
            });

            const request = input instanceof Request
              ? input
              : new Request(String(input), init);

            const url = new URL(request.url);
            if (url.pathname === "/accounts" && request.method === "GET" && failGetStatus) {
              return new Response(JSON.stringify({ message: "forced get failure" }), { status: failGetStatus, headers: { "content-type": "application/json" } });
            }
            if (url.pathname === "/accounts" && request.method === "PUT" && failPutStatus) {
              return new Response(JSON.stringify({ message: "forced put failure" }), { status: failPutStatus, headers: { "content-type": "application/json" } });
            }

            return object.fetch(request);
          }
        };
      }
    }
  };

  return {
    env: envWithBinding,
    storage,
    setFailGetStatus(status: number | undefined) {
      failGetStatus = status;
    },
    setFailPutStatus(status: number | undefined) {
      failPutStatus = status;
    }
  };
}

describe("worker app multi-account foundation", () => {
  it("connects an account, creates a bound session, and lists files in mock mode", async () => {
    const { token } = await createSessionToken();
    const response = await authorizedRequest(token, "/api/files?path=Projects");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { items: Array<{ path: string }> } };
    expect(payload.data.items.map((item) => item.path)).toContain("Projects/roadmap.txt");
  });

  it("reports in-app account connection model from health", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:8787/api/health"), { ...env, APP_UNLOCK_CODE: "open-sesame" });
    expect(response.status).toBe(200);

    const payload = (await response.json()) as { data: { unlockRequired: boolean; connectionMode: string; supportedAccountTypes: string[] } };
    expect(payload.data.unlockRequired).toBe(true);
    expect(payload.data.connectionMode).toBe("in_app");
    expect(payload.data.supportedAccountTypes).toEqual(["nextcloud"]);
  });

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
  });

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
  });

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
  });

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
  });

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
  });

  it("returns preview results for text, markdown MIME variants, media, and PDFs", async () => {
    const { token } = await createSessionToken();
    const textResponse = await authorizedRequest(token, "/api/file?path=Projects/roadmap.txt");
    const textPayload = (await textResponse.json()) as { data: { file: { content: string; viewer: string } } };
    expect(textPayload.data.file.content).toContain("normalized API");
    expect(textPayload.data.file.viewer).toBe("text");

    const markdownResponse = await authorizedRequest(token, "/api/file?path=Design/spec.md");
    const markdownPayload = (await markdownResponse.json()) as { data: { file: { viewer: string; mimeType?: string } } };
    expect(markdownPayload.data.file.viewer).toBe("markdown");

    const mediaResponse = await authorizedRequest(token, "/api/file?path=Archive/photo.png");
    const mediaPayload = (await mediaResponse.json()) as { data: { file: { viewer: string; requiresOriginalBlob: boolean } } };
    expect(mediaPayload.data.file.viewer).toBe("image");
    expect(mediaPayload.data.file.requiresOriginalBlob).toBe(true);

    const pdfResponse = await authorizedRequest(token, "/api/file?path=Archive/guide.pdf");
    const pdfPayload = (await pdfResponse.json()) as { data: { file: { viewer: string; requiresOriginalBlob: boolean; unsupportedReason?: string } } };
    expect(pdfPayload.data.file.viewer).toBe("pdf");
    expect(pdfPayload.data.file.requiresOriginalBlob).toBe(true);
    expect(pdfPayload.data.file.unsupportedReason).toMatch(/Open the original PDF/i);
  });

  it("creates the configured real Nextcloud root during validation when missing", async () => {
    const calls: Array<{ url: string; method?: string; destination?: string | null }> = [];
    const existingPaths = new Set<string>();
    const client = new NextcloudClient(
      {
        baseUrl: "https://nextcloud.example.invalid",
        username: "demo-user",
        appPassword: "app-pass",
        rootPath: ".davora-agent-test/docs",
        maxFileBytes: 1024 * 1024,
        maxTextFileBytes: 64 * 1024
      },
      async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method,
          destination: headers.get("Destination")
        });

        const path = decodeURIComponent(new URL(url).pathname.replace(/^.*\/files\/[^/]+\//, ""));
        if (init?.method === "PROPFIND") {
          if (!existingPaths.has(path)) {
            return new Response("<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\"></d:multistatus>", { status: 404 });
          }
          return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/demo-user/${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${path.split("/").at(-1)}</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`, { status: 207 });
        }
        if (init?.method === "MKCOL") {
          existingPaths.add(path);
          return new Response(null, { status: 201 });
        }
        return new Response(null, { status: 204 });
      }
    );

    const metadata = await client.validateRoot();

    expect(metadata.path).toBe("");
    expect(calls.filter((call) => call.method === "MKCOL").map((call) => call.url)).toEqual([
      "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test",
      "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs"
    ]);
  });

  it("creates only the missing leaf when an ancestor sandbox path already exists", async () => {
    const calls: Array<{ url: string; method?: string; destination?: string | null }> = [];
    const existingPaths = new Set<string>([".davora-agent-test"]);
    const client = new NextcloudClient(
      {
        baseUrl: "https://nextcloud.example.invalid",
        username: "demo-user",
        appPassword: "app-pass",
        rootPath: ".davora-agent-test/docs",
        maxFileBytes: 1024 * 1024,
        maxTextFileBytes: 64 * 1024
      },
      async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method,
          destination: headers.get("Destination")
        });

        const path = decodeURIComponent(new URL(url).pathname.replace(/^.*\/files\/[^/]+\//, ""));
        if (init?.method === "PROPFIND") {
          if (!existingPaths.has(path)) {
            return new Response("<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\"></d:multistatus>", { status: 404 });
          }
          return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/demo-user/${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${path.split("/").at(-1)}</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`, { status: 207 });
        }
        if (init?.method === "MKCOL") {
          existingPaths.add(path);
          return new Response(null, { status: 201 });
        }
        return new Response(null, { status: 204 });
      }
    );

    const metadata = await client.validateRoot();

    expect(metadata.path).toBe("");
    expect(calls.filter((call) => call.method === "MKCOL").map((call) => call.url)).toEqual([
      "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs"
    ]);
  });

  it("uses the sandbox root for real Nextcloud mutation requests", async () => {
    const calls: Array<{ url: string; method?: string; destination?: string | null }> = [];
    const client = new NextcloudClient(
      {
        baseUrl: "https://nextcloud.example.invalid",
        username: "demo-user",
        appPassword: "app-pass",
        rootPath: ".davora-agent-test",
        maxFileBytes: 1024 * 1024,
        maxTextFileBytes: 64 * 1024
      },
      async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method,
          destination: headers.get("Destination")
        });
        return new Response(null, { status: 204 });
      }
    );

    await client.createFolder({ path: "docs", name: "nested" });
    await client.uploadFile({
      path: "docs",
      name: "source.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello world", "utf8").toString("base64")
    });
    await client.moveResource({ path: "docs/source.txt", destinationPath: "docs/renamed.txt" });
    await client.copyResource({ path: "docs/renamed.txt", destinationPath: "docs/copied.txt" });
    await client.deleteResource({ path: "docs/copied.txt", confirmName: "copied.txt" });

    expect(calls.filter((call) => ["MKCOL", "PUT", "MOVE", "COPY", "DELETE"].includes(call.method ?? ""))).toEqual([
      {
        method: "MKCOL",
        url: "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs/nested",
        destination: null
      },
      {
        method: "PUT",
        url: "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs/source.txt",
        destination: null
      },
      {
        method: "MOVE",
        url: "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs/source.txt",
        destination: "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs/renamed.txt"
      },
      {
        method: "COPY",
        url: "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs/renamed.txt",
        destination: "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs/copied.txt"
      },
      {
        method: "DELETE",
        url: "https://nextcloud.example.invalid/remote.php/dav/files/demo-user/.davora-agent-test/docs/copied.txt",
        destination: null
      }
    ]);
  });

  it("supports browser-native POST download handoff for the active account", async () => {
    const { token } = await createSessionToken();
    const formData = new FormData();
    formData.set("path", "Archive/image.bin");
    formData.set("token", token);

    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/download", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4173" },
        body: formData
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename\*=UTF-8''image\.bin/);
  });

  it("supports create/upload/move/copy/delete operations for the active account", async () => {
    const { token } = await createSessionToken();

    const createFolderResponse = await authorizedRequest(token, "/api/folders", {
      method: "POST",
      body: JSON.stringify({ path: "", name: "Temp" })
    });
    expect(createFolderResponse.status).toBe(201);

    const uploadResponse = await authorizedRequest(token, "/api/upload", {
      method: "POST",
      body: JSON.stringify({
        path: "Temp",
        name: "note.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("hello world", "utf8").toString("base64")
      })
    });
    expect(uploadResponse.status).toBe(201);

    const moveResponse = await authorizedRequest(token, "/api/move", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note.txt", destinationPath: "Temp/note-renamed.txt" })
    });
    expect(moveResponse.status).toBe(200);

    const copyResponse = await authorizedRequest(token, "/api/copy", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note-renamed.txt", destinationPath: "Temp/note-copy.txt" })
    });
    expect(copyResponse.status).toBe(201);

    const deleteFailResponse = await authorizedRequest(token, "/api/delete", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note-copy.txt", confirmName: "wrong" })
    });
    expect(deleteFailResponse.status).toBe(400);

    const deleteResponse = await authorizedRequest(token, "/api/delete", {
      method: "POST",
      body: JSON.stringify({ path: "Temp/note-copy.txt", confirmName: "note-copy.txt" })
    });
    expect(deleteResponse.status).toBe(200);
  });

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
  });

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
  });

  it("keeps an existing deployed-runtime account usable when durable hydration fails transiently", async () => {
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

    expect(sessionResponse.status).toBe(200);
    const sessionPayload = (await sessionResponse.json()) as { data: { session: { account: { id: string } } } };
    expect(sessionPayload.data.session.account.id).toBe(accountPayload.data.account.id);
  });

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
  });

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
  });

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
  });

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
  });

  it("gates mock reset behind the configured reset token", async () => {
    const denied = await handleRequest(
      new Request("http://127.0.0.1:8787/api/mock/reset", { method: "POST" }),
      env
    );
    expect(denied.status).toBe(404);

    const allowed = await handleRequest(
      new Request("http://127.0.0.1:8787/api/mock/reset", {
        method: "POST",
        headers: { "x-davora-reset-token": env.SESSION_SECRET }
      }),
      env
    );
    expect(allowed.status).toBe(204);
  });

  it("blocks requests without a token", async () => {
    const response = await handleRequest(
      new Request("http://127.0.0.1:8787/api/files", {
        headers: { origin: "http://127.0.0.1:4173" }
      }),
      env
    );

    expect(response.status).toBe(401);
  });
});
