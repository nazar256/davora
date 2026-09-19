/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleRequest } from "../src/app";
import { signSessionToken, signStreamToken, verifySessionToken } from "../src/security/token";
import { MemoryAccountStateStorage } from "../src/accounts/storage";

const ORIGIN = "http://127.0.0.1:4173";
const SESSION_SECRET = "route-matrix-secret-0123456789abcdef";
const originalFetch = globalThis.fetch;
const accountStorage = new MemoryAccountStateStorage();
const baseEnv = {
  SESSION_SECRET,
  RUNTIME_MODE: "development",
  ALLOWED_ORIGINS: ORIGIN,
  ACCOUNT_STATE_STORAGE: accountStorage
};
const ownerHeaders = {
  origin: ORIGIN,
  "x-davora-browser-id": "route-matrix-browser",
  "x-davora-browser-secret": "route-matrix-secret"
};

type Lane = "mock" | "nextcloud";
type FakeNode = { path: string; name: string; isFolder: boolean; mimeType?: string; content: Uint8Array };

function xmlResponse(baseUrl: string, username: string, items: FakeNode[]): Response {
  const responses = items.map((item) => `<d:response><d:href>${baseUrl}/remote.php/dav/files/${username}/${item.path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${item.name}</d:displayname><d:getcontentlength>${item.content.byteLength}</d:getcontentlength><d:getcontenttype>${item.mimeType ?? ""}</d:getcontenttype><d:getetag>etag-${item.path || "root"}</d:getetag>${item.isFolder ? "<d:resourcetype><d:collection/></d:resourcetype>" : ""}</d:prop></d:propstat></d:response>`).join("");
  return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`, { status: 207, headers: { "content-type": "application/xml" } });
}

function createFakeNextcloudFetch() {
  const baseUrl = "https://nextcloud.ownhost.top";
  const username = "route-user";
  const files = new Map<string, FakeNode>([
    ["", { path: "", name: "Fake Root", isFolder: true, content: new Uint8Array() }],
    ["Projects", { path: "Projects", name: "Projects", isFolder: true, content: new Uint8Array() }],
    ["Projects/roadmap.txt", { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, mimeType: "text/plain", content: new TextEncoder().encode("fake normalized API roadmap") }],
    ["Projects/song.mp3", { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, mimeType: "audio/mpeg", content: new Uint8Array([0x49, 0x44, 0x33, 0x00]) }],
    ["Archive", { path: "Archive", name: "Archive", isFolder: true, content: new Uint8Array() }],
    ["Archive/image.bin", { path: "Archive/image.bin", name: "image.bin", isFolder: false, mimeType: "application/octet-stream", content: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) }]
  ]);
  const calls: string[] = [];
  let failNextStatus: number | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    const davRoot = `/remote.php/dav/files/${username}`;
    if (parsed.origin !== baseUrl || (parsed.pathname !== davRoot && !parsed.pathname.startsWith(`${davRoot}/`))) {
      throw new Error(`Unexpected fake Nextcloud URL: ${url}`);
    }
    calls.push(url);
    if (failNextStatus !== undefined) {
      const status = failNextStatus;
      failNextStatus = undefined;
      return new Response("UPSTREAM_SECRET_BODY", { status });
    }
    const prefix = `/remote.php/dav/files/${username}`;
    const encodedPath = parsed.pathname.slice(prefix.length).replace(/^\//, "");
    const path = encodedPath.split("/").filter(Boolean).map(decodeURIComponent).join("/");
    const method = init?.method ?? "GET";
    if (method === "PROPFIND") {
      const depth = new Headers(init?.headers).get("depth");
      const target = files.get(path);
      if (!target) return new Response(null, { status: 404 });
      const listed = depth === "1" ? [...files.values()].filter((item) => item.path === path || item.path.startsWith(`${path}/`) && !item.path.slice(path.length + 1).includes("/")) : [target];
      return xmlResponse(baseUrl, username, listed);
    }
    const target = files.get(path);
    if (method === "GET") {
      if (!target || target.isFolder) return new Response(null, { status: 404 });
      const headers = new Headers({ "content-type": target.mimeType ?? "application/octet-stream", "content-length": String(target.content.byteLength) });
      const range = new Headers(init?.headers).get("range");
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Number(match[2]) : target.content.byteLength - 1;
          if (start >= target.content.byteLength) return new Response(null, { status: 416 });
          const bounded = target.content.slice(start, Math.min(end, target.content.byteLength - 1) + 1);
          headers.set("content-range", `bytes ${start}-${start + bounded.byteLength - 1}/${target.content.byteLength}`);
          headers.set("content-length", String(bounded.byteLength));
          return new Response(bounded, { status: 206, headers });
        }
      }
      return new Response(target.content.buffer as ArrayBuffer, { status: 200, headers });
    }
    if (method === "MKCOL") {
      if (target) return new Response(null, { status: 405 });
      const name = path.split("/").at(-1) ?? path;
      files.set(path, { path, name, isFolder: true, content: new Uint8Array() });
      return new Response(null, { status: 201 });
    }
    if (method === "PUT") {
      const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer());
      files.set(path, { path, name: path.split("/").at(-1) ?? path, isFolder: false, mimeType: new Headers(init?.headers).get("content-type") ?? "application/octet-stream", content: body });
      return new Response(null, { status: 201 });
    }
    if (method === "MOVE" || method === "COPY") {
      if (!target) return new Response(null, { status: 404 });
      const destination = new URL(new Headers(init?.headers).get("destination") ?? "").pathname.split(`/remote.php/dav/files/${username}/`)[1] ?? "";
      const destPath = destination.split("/").map(decodeURIComponent).join("/");
      files.set(destPath, { ...target, path: destPath, name: destPath.split("/").at(-1) ?? destPath });
      if (method === "MOVE") files.delete(path);
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") {
      if (!target) return new Response(null, { status: 404 });
      files.delete(path);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fake Nextcloud method: ${method}`);
  };
  return { fetch, calls, failNextRequest: (status = 500) => { failNextStatus = status; } };
}

async function connectAndSession(lane: Lane, overrides: Record<string, unknown> = {}) {
  const fake = lane === "nextcloud" ? createFakeNextcloudFetch() : undefined;
  if (fake) globalThis.fetch = fake.fetch;
  const env = lane === "mock" ? { ...baseEnv, MOCK_BACKEND: "true", ...overrides } : { ...baseEnv, MOCK_BACKEND: "false", NEXTCLOUD_ALLOWED_HOSTS: "nextcloud.ownhost.top", ...overrides };
  const accountResponse = await handleRequest(new Request("http://127.0.0.1:8787/api/accounts", {
    method: "POST", headers: { ...ownerHeaders, "content-type": "application/json" },
    body: JSON.stringify({ type: "nextcloud", baseUrl: lane === "mock" ? "https://mock-account.example.com" : "https://nextcloud.ownhost.top", username: "route-user", appPassword: "route-password", label: `${lane} route account` })
  }), env);
  expect(accountResponse.status).toBe(201);
  const account = (await accountResponse.json() as { data: { account: { id: string } } }).data.account;
  const sessionResponse = await handleRequest(new Request("http://127.0.0.1:8787/api/session", {
    method: "POST", headers: { ...ownerHeaders, "content-type": "application/json" }, body: JSON.stringify({ accountId: account.id })
  }), env);
  expect(sessionResponse.status).toBe(200);
  const token = (await sessionResponse.json() as { data: { session: { token: string } } }).data.session.token;
  return { env, token, fake };
}

function request(env: Record<string, unknown>, token: string, path: string, init: RequestInit = {}) {
  return handleRequest(new Request(`http://127.0.0.1:8787${path}`, {
    ...init,
    headers: { origin: ORIGIN, authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers }
  }), env);
}

describe("authorized file route matrix (public handleRequest characterization)", () => {
  beforeEach(() => {
    accountStorage.reset();
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const routeCases: Array<{ name: string; path: string; method?: string; init?: RequestInit; body?: unknown; status: number; assert: (response: Response) => Promise<void> }> = [
    { name: "files", path: "/api/files?path=Projects", status: 200, assert: async (r) => expect((await r.json() as { data: { path: string; items: unknown[] } }).data.path).toBe("Projects") },
    { name: "metadata", path: "/api/metadata?path=Projects/roadmap.txt", method: "POST", status: 200, assert: async (r) => expect((await r.json() as { data: { metadata: { path: string } } }).data.metadata.path).toBe("Projects/roadmap.txt") },
    { name: "preview", path: "/api/file?path=Projects/roadmap.txt", method: "POST", status: 200, assert: async (r) => expect((await r.json() as { data: { file: { viewer: string } } }).data.file.viewer).toBe("text") },
    { name: "original", path: "/api/file/original?path=Projects/song.mp3", status: 200, assert: async (r) => { expect(r.headers.get("cache-control")).toBe("no-store"); expect(r.headers.get("content-type")).toBe("audio/mpeg"); expect(r.headers.get("content-disposition")).toMatch(/inline; filename\*=UTF-8''song\.mp3/); expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0x49, 0x44, 0x33, 0x00])); } },
    { name: "stream", path: "/api/file/stream?path=Projects/song.mp3", init: { headers: { range: "bytes=1-2" } }, status: 206, assert: async (r) => { expect(r.headers.get("accept-ranges")).toBe("bytes"); expect(r.headers.get("cache-control")).toBe("no-store"); expect(r.headers.get("content-type")).toBe("audio/mpeg"); expect(r.headers.get("content-disposition")).toMatch(/inline; filename\*=UTF-8''song\.mp3/); expect(r.headers.get("content-length")).toBe("2"); expect(r.headers.get("content-range")).toBe("bytes 1-2/4"); expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0x44, 0x33])); } },
    { name: "search", path: "/api/search?path=Projects&q=roadmap", method: "POST", status: 200, assert: async (r) => expect((await r.json() as { data: { query: string } }).data.query).toBe("roadmap") },
    { name: "download GET", path: "/api/download?path=Archive/image.bin", status: 200, assert: async (r) => { expect(r.headers.get("content-type")).toBe("application/octet-stream"); expect(r.headers.get("cache-control")).toBe("no-store"); expect(r.headers.get("content-disposition")).toMatch(/attachment; filename\*=UTF-8''image\.bin/); expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef])); } },
    { name: "folder", path: "/api/folders", method: "POST", body: { path: "", name: "MatrixFolder" }, status: 201, assert: async (r) => expect((await r.json() as { data: { result: { path: string } } }).data.result.path).toBe("MatrixFolder") },
    { name: "upload", path: "/api/upload", method: "POST", body: { path: "Projects", name: "matrix.txt", mimeType: "text/plain", contentBase64: "bWF0cml4" }, status: 201, assert: async (r) => expect((await r.json() as { data: { result: { path: string } } }).data.result.path).toBe("Projects/matrix.txt") },
    { name: "move", path: "/api/move", method: "POST", body: { path: "Projects/roadmap.txt", destinationPath: "Projects/moved.txt" }, status: 200, assert: async (r) => expect((await r.json() as { data: { result: { action: string; path: string; destinationPath?: string; parentPath: string } } }).data.result).toMatchObject({ action: "move", path: "Projects/roadmap.txt", destinationPath: "Projects/moved.txt", parentPath: "Projects" }) },
    { name: "copy", path: "/api/copy", method: "POST", body: { path: "Projects/song.mp3", destinationPath: "Projects/copied.mp3" }, status: 201, assert: async (r) => expect((await r.json() as { data: { result: { action: string; path: string; destinationPath?: string; parentPath: string } } }).data.result).toMatchObject({ action: "copy", path: "Projects/song.mp3", destinationPath: "Projects/copied.mp3", parentPath: "Projects" }) },
    { name: "delete", path: "/api/delete", method: "POST", body: { path: "Archive/image.bin", confirmName: "image.bin" }, status: 200, assert: async (r) => expect((await r.json() as { data: { result: { action: string } } }).data.result.action).toBe("delete") },
    { name: "unknown route", path: "/api/unknown", status: 404, assert: async (r) => expect((await r.json() as { data: { code: string } }).data.code).toBe("not_found") }
  ];

  for (const lane of ["mock", "nextcloud"] as const) {
    describe(`${lane} backend`, () => {
      for (const route of routeCases) {
        it(`serves ${route.name} with the frozen public contract`, async () => {
          const { env, token, fake } = await connectAndSession(lane);
          const response = await request(env, token, route.path, { ...route.init, method: route.method, ...(route.body ? { body: JSON.stringify(route.body) } : {}) });
          expect(response.status).toBe(route.status);
          if (!['original', 'stream', 'download GET'].includes(route.name)) {
            expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
          }
          await route.assert(response);
          if (route.status < 300) {
            expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
            expect(response.headers.get("cache-control")).toBe("no-store");
          }
          if (fake) expect(fake.calls.every((url) => url.startsWith("https://nextcloud.ownhost.top/remote.php/dav/files/route-user"))).toBe(true);
        });
      }
    });

    it(`freezes stream-token issuance and ingress for ${lane}`, async () => {
      const { env, token } = await connectAndSession(lane);
      const issued = await request(env, token, "/api/file/stream-token?path=Projects/song.mp3", { method: "POST" });
      expect(issued.status).toBe(200);
      expect(issued.headers.get("content-type")).toBe("application/json; charset=utf-8");
      const payload = (await issued.json() as { data: { token: string; path: string; expiresAt: string } }).data;
      expect(payload.path).toBe("Projects/song.mp3");
      expect(Date.parse(payload.expiresAt) - Date.now()).toBeGreaterThan(0);
      expect(Date.parse(payload.expiresAt) - Date.now()).toBeLessThanOrEqual(120_000);
      expect((await request(env, token, "/api/file/stream-token?path=Projects/song.mp3")).status).toBe(404);
      expect((await handleRequest(new Request("http://127.0.0.1:8787/api/file/stream-token?path=Projects/song.mp3", { method: "POST", headers: { origin: ORIGIN } }), env)).status).toBe(401);
    });

    it(`preserves full stream and unsatisfiable range behavior for ${lane}`, async () => {
      const { env, token } = await connectAndSession(lane);
      const full = await request(env, token, "/api/file/stream?path=Projects/song.mp3");
      expect(full.status).toBe(200);
      expect(full.headers.get("content-length")).toBe("4");
      expect(full.headers.get("content-range")).toBeNull();
      expect(new Uint8Array(await full.arrayBuffer())).toEqual(new Uint8Array([0x49, 0x44, 0x33, 0x00]));
      const unsatisfiable = await request(env, token, "/api/file/stream?path=Projects/song.mp3", { headers: { range: "bytes=999-1000" } });
      if (lane === "mock") {
        expect(unsatisfiable.status).toBe(416);
        expect(unsatisfiable.headers.get("content-type")).toBe("audio/mpeg");
      } else {
        expect(unsatisfiable.status).toBe(416);
        expect(unsatisfiable.headers.get("content-type")).toBe("audio/mpeg");
      }
      const malformed = await request(env, token, "/api/file/stream?path=Projects/song.mp3", { headers: { range: "not-a-range" } });
      expect(malformed.status).toBe(200);
    });

    it(`caps stream-token expiry at a shorter session TTL for ${lane}`, async () => {
      const { env, token } = await connectAndSession(lane, { SESSION_TTL_SECONDS: "30" });
      const issued = await request(env, token, "/api/file/stream-token?path=Projects/song.mp3", { method: "POST" });
      expect(issued.status).toBe(200);
      const expiresAt = Date.parse((await issued.json() as { data: { expiresAt: string } }).data.expiresAt);
      expect(expiresAt - Date.now()).toBeLessThanOrEqual(30_000);
    });
  }

  for (const lane of ["mock", "nextcloud"] as const) {
    it(`freezes mutation validation and containment errors for ${lane}`, async () => {
      const { env, token, fake } = await connectAndSession(lane);
      for (const wrongMethodPath of ["/api/folders", "/api/upload", "/api/move", "/api/copy", "/api/delete"]) {
        const callsBeforeWrongMethod = fake?.calls.length;
        expect((await request(env, token, wrongMethodPath)).status).toBe(404);
        if (fake) expect(fake.calls.length).toBe(callsBeforeWrongMethod);
      }
      for (const path of ["/api/folders", "/api/upload", "/api/move", "/api/copy", "/api/delete"]) {
        const callsBeforeValidation = fake?.calls.length;
        expect((await request(env, token, path, { method: "POST", body: "not-json" })).status).toBe(path === "/api/move" || path === "/api/copy" ? 500 : 400);
        if (fake) expect(fake.calls.length).toBe(callsBeforeValidation);
      }
      const callsBeforeUploadValidation = fake?.calls.length;
      expect((await request(env, token, "/api/upload", { method: "POST", body: JSON.stringify({ path: "Projects", name: "bad.txt", mimeType: "text/plain", contentBase64: "%%%" }) })).status).toBe(400);
      if (fake) expect(fake.calls.length).toBe(callsBeforeUploadValidation);
      const callsBeforeFolderValidation = fake?.calls.length;
      expect((await request(env, token, "/api/folders", { method: "POST", body: JSON.stringify({ path: "Projects", name: "" }) })).status).toBe(400);
      if (fake) expect(fake.calls.length).toBe(callsBeforeFolderValidation);
      const duplicate = await request(env, token, "/api/folders", { method: "POST", body: JSON.stringify({ path: "", name: "Projects" }) });
      expect(duplicate.status).toBe(409);
      expect((await duplicate.json() as { data: { code: string } }).data.code).toBe("conflict");
      const callsBeforeRootDelete = fake?.calls.length;
      const rootDelete = await request(env, token, "/api/delete", { method: "POST", body: JSON.stringify({ path: "", confirmName: "" }) });
      expect(rootDelete.status).toBe(400);
      expect((await rootDelete.json() as { data: { code: string } }).data.code).toBe("invalid_request");
      if (fake) expect(fake.calls.length).toBe(callsBeforeRootDelete);
      const move = await request(env, token, "/api/move", { method: "POST", body: JSON.stringify({ path: "Projects", destinationPath: "Projects/child" }) });
      expect(move.status).toBe(200);
      expect((await move.json() as { data: { result: unknown } }).data.result).toMatchObject({ action: "move", path: "Projects", destinationPath: "Projects/child", parentPath: "Projects" });
      const copy = await request(env, token, "/api/copy", { method: "POST", body: JSON.stringify({ path: "Projects/child", destinationPath: "Projects/child/grandchild" }) });
      expect(copy.status).toBe(201);
      expect((await copy.json() as { data: { result: unknown } }).data.result).toMatchObject({ action: "copy", path: "Projects/child", destinationPath: "Projects/child/grandchild", parentPath: "Projects/child" });
    });
  }

  for (const lane of ["mock", "nextcloud"] as const) {
    it(`freezes missing-resource, invalid-path, and rejected-request behavior for ${lane}`, async () => {
      const { env, token, fake } = await connectAndSession(lane);
      for (const path of ["/api/metadata?path=Missing/nope.txt", "/api/file?path=Missing/nope.txt", "/api/file/original?path=Missing/nope.txt", "/api/file/stream?path=Missing/nope.txt", "/api/download?path=Missing/nope.txt"]) {
        const response = await request(env, token, path);
        expect(response.status).toBe(404);
        expect((await response.json() as { data: { code: string } }).data.code).toBe("not_found");
      }
      const invalidPath = await request(env, token, "/api/files?path=../escape");
      expect(invalidPath.status).toBe(500);
      expect((await invalidPath.json() as { data: { code: string } }).data.code).toBe("mutation_failed");
      const malformed = await request(env, token, "/api/upload", { method: "POST", body: "not-json" });
      expect(malformed.status).toBe(400);
      if (fake) {
        fake.failNextRequest();
        const upstreamFailure = await request(env, token, "/api/metadata?path=Projects/roadmap.txt");
        expect(upstreamFailure.status).toBe(500);
        const failureText = await upstreamFailure.text();
        expect(failureText).not.toMatch(/UPSTREAM_SECRET_BODY|route-password|route-matrix-secret|Authorization/i);
        fake.failNextRequest(403);
        const permissionFailure = await request(env, token, "/api/metadata?path=Projects/roadmap.txt");
        expect(permissionFailure.status).toBe(500);
        expect((await permissionFailure.json() as { data: { code: string } }).data.code).toBe("mutation_failed");
      }
      const callsBeforeNoBearer = fake?.calls.length;
      const noBearer = await handleRequest(new Request("http://127.0.0.1:8787/api/files?path=Projects", { headers: { origin: ORIGIN } }), env);
      expect(noBearer.status).toBe(401);
      const invalidBearer = await request(env, "invalid-session-token", "/api/files?path=Projects");
      expect(invalidBearer.status).toBe(401);
      const session = await verifySessionToken(token, SESSION_SECRET);
      const expired = await signSessionToken({ ...session, exp: Math.floor(Date.now() / 1000) - 1 }, SESSION_SECRET);
      const expiredResponse = await request(env, expired, "/api/files?path=Projects");
      expect(expiredResponse.status).toBe(401);
      const mismatched = await signSessionToken({ ...session, accountNonce: "stale-nonce" }, SESSION_SECRET);
      expect((await request(env, mismatched, "/api/files?path=Projects")).status).toBe(401);
      if (fake) expect(fake.calls.length).toBe(callsBeforeNoBearer);
    });
  }

  for (const lane of ["mock", "nextcloud"] as const) {
    it(`normalizes browser POST download for ${lane} and rejects missing fields`, async () => {
      const { env, token, fake } = await connectAndSession(lane);
      const form = new FormData(); form.set("path", "Archive/image.bin"); form.set("token", token);
      const response = await handleRequest(new Request("http://127.0.0.1:8787/api/download", { method: "POST", headers: { origin: ORIGIN }, body: form }), env);
      expect(response.status).toBe(200);
      const missing = await handleRequest(new Request("http://127.0.0.1:8787/api/download", { method: "POST", headers: { origin: ORIGIN }, body: new FormData() }), env);
      expect(missing.status).toBe(400);
      const invalid = new FormData(); invalid.set("path", "Archive/image.bin"); invalid.set("token", "invalid-session-token");
      const callsBeforeInvalid = fake?.calls.length;
      expect((await handleRequest(new Request("http://127.0.0.1:8787/api/download", { method: "POST", headers: { origin: ORIGIN }, body: invalid }), env)).status).toBe(401);
      if (fake) expect(fake.calls.length).toBe(callsBeforeInvalid);
      expect((await request(env, token, "/api/download?path=Archive/image.bin&token=invalid-session-token")).status).toBe(200);
      expect((await handleRequest(new Request(`http://127.0.0.1:8787/api/download?path=Archive/image.bin&token=${encodeURIComponent(token)}`, { headers: { origin: ORIGIN } }), env)).status).toBe(401);
      const wrongReset = await handleRequest(new Request("http://127.0.0.1:8787/api/mock/reset", { method: "POST", headers: { origin: ORIGIN, "x-davora-reset-token": "wrong" } }), env);
      expect(wrongReset.status).toBe(404);
    });
  }

  it("keeps stream-token ingress bound and rejects session tokens in query or other routes", async () => {
    const { env, token } = await connectAndSession("mock");
    const issued = await request(env, token, "/api/file/stream-token?path=Projects/song.mp3", { method: "POST" });
    expect(issued.status).toBe(200);
    const payload = (await issued.json() as { data: { token: string } }).data.token;
    const good = await request(env, "", `/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(payload)}`, { headers: { range: "bytes=0-0" } });
    expect(good.status).toBe(206);
    const wrongPath = await request(env, "", `/api/file/stream?path=Archive/image.bin&streamToken=${encodeURIComponent(payload)}`, { headers: {} });
    expect(wrongPath.status).toBe(401);
    const ordinaryQuery = await request(env, "", `/api/file/stream?path=Projects/song.mp3&token=${encodeURIComponent(token)}`, { headers: {} });
    expect(ordinaryQuery.status).toBe(401);
    const original = await request(env, "", `/api/file/original?path=Projects/song.mp3&streamToken=${encodeURIComponent(payload)}`, { headers: {} });
    expect(original.status).toBe(401);

    const session = await verifySessionToken(token, SESSION_SECRET);
    for (const claims of [
      { backend: "nextcloud" as const },
      { rootPath: "other-root" },
      { accountNonce: "other-nonce" },
      { accountId: "other-account" },
      { exp: Math.floor(Date.now() / 1000) - 1 }
    ]) {
      const forged = await signStreamToken({ scope: "davora-stream", accountId: session.accountId, backend: session.backend, rootPath: session.rootPath, accountNonce: session.accountNonce, path: "Projects/song.mp3", exp: Math.floor(Date.now() / 1000) + 120, ...claims }, SESSION_SECRET);
      const rejected = await request(env, "", `/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(forged)}`);
      expect(rejected.status).toBe(claims.accountId ? 409 : 401);
    }
  });

  for (const lane of ["mock", "nextcloud"] as const) {
    it(`rejects forged stream claims before backend execution for ${lane}`, async () => {
      const { env, token, fake } = await connectAndSession(lane);
      const session = await verifySessionToken(token, SESSION_SECRET);
      const forged = await signStreamToken({ ...session, scope: "davora-stream", path: "Projects/song.mp3", accountNonce: "stale" }, SESSION_SECRET);
      const before = fake?.calls.length;
      const response = await request(env, "", `/api/file/stream?path=Projects/song.mp3&streamToken=${encodeURIComponent(forged)}`);
      expect(response.status).toBe(401);
      if (fake) expect(fake.calls.length).toBe(before);
    });
  }

  it("applies CORS/auth/error redaction before backend work and keeps reset unreachable in real mode", async () => {
    const { env, token, fake } = await connectAndSession("nextcloud");
    const callsBefore = fake!.calls.length;
    const disallowed = await handleRequest(new Request("http://127.0.0.1:8787/api/files?path=Projects", { headers: { origin: "https://evil.example", authorization: `Bearer ${token}` } }), env);
    expect(disallowed.status).toBe(403);
    expect(fake!.calls.length).toBe(callsBefore);
    const unauthorized = await handleRequest(new Request("http://127.0.0.1:8787/api/files?path=Projects", { headers: { origin: ORIGIN } }), env);
    expect(unauthorized.status).toBe(401);
    const callsBeforeUnknown = fake!.calls.length;
    const unknown = await request(env, token, "/api/unknown");
    expect(unknown.status).toBe(404);
    expect(fake!.calls.length).toBe(callsBeforeUnknown);
    expect(await unknown.text()).not.toMatch(/route-password|Authorization|secret/i);
    const reset = await handleRequest(new Request("http://127.0.0.1:8787/api/mock/reset", { method: "POST", headers: { origin: ORIGIN, "x-davora-reset-token": SESSION_SECRET } }), env);
    expect(reset.status).toBe(404);
  });

  it("returns strict mutation errors and keeps mutation routes POST-only", async () => {
    const { env, token } = await connectAndSession("mock");
    for (const path of ["/api/folders", "/api/upload", "/api/move", "/api/copy", "/api/delete"]) {
      expect((await request(env, token, path)).status).toBe(404);
    }
    const invalid = await request(env, token, "/api/delete", { method: "POST", body: JSON.stringify({ path: "Archive/image.bin", confirmName: "wrong" }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toMatch(/route-matrix-secret|route-password/i);
  });
});
