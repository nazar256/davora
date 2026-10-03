import { afterEach, describe, expect, it, vi } from "vitest";
import { legacySearchSuccessSchema, searchEndpoint, type FileEntry } from "@davora/shared";
import { boundedSearch } from "../src/files/boundedSearch";
import { NextcloudFileBackend } from "../src/files/nextcloudFileBackend";
import { MockFileBackend } from "../src/files/mockFileBackend";
import { NextcloudClient } from "../src/nextcloud/client";
import { resetMockEntries } from "../src/mock/data";
import { handleRequest } from "../src/app";
import { executeFileRoute } from "../src/files/service";
import { connectMockAccount, ownerHeaders, parseSessionToken, env, resetConnectedAccountStoreForTests, testNextcloudPolicy } from "./support/workerApplicationHarness";

const entry = (path: string, isFolder = false): FileEntry => ({ path, name: path.split("/").at(-1)!, isFolder });
const files = (count: number) => Array.from({ length: count }, (_, i) => entry(`Scope/needle-${String(i).padStart(3, "0")}.txt`));
const folders = (count: number) => Array.from({ length: count }, (_, i) => entry(`Scope/folder-${i}`, true));
type Tree = Record<string, FileEntry[] | undefined>;

function davFetch(tree: Tree) {
  const responses: Response[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    expect(responses.every((response) => response.bodyUsed)).toBe(true);
    expect(init?.method).toBe("PROPFIND");
    expect(new Headers(init?.headers).get("depth")).toBe("1");
    expect(init?.redirect).toBe("manual");
    if (fetch.mock.calls.length > 50) throw new Error("External request 51");
    const path = decodeURIComponent(new URL(String(input)).pathname).replace("/remote.php/dav/files/alice/", "");
    const xml = (tree[path] ?? []).map((item) => `<d:response><d:href>/remote.php/dav/files/alice/${item.path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype>${item.isFolder ? "<d:collection/>" : ""}</d:resourcetype></d:prop></d:propstat></d:response>`).join("");
    const response = new Response(`<d:multistatus xmlns:d="DAV:">${xml}</d:multistatus>`, { status: 207 });
    responses.push(response);
    return response;
  });
  return fetch;
}

async function adapter(kind: "mock" | "real", tree: Tree) {
  const fetch = davFetch(tree);
  if (kind === "real") return { fetch, backend: new NextcloudFileBackend(new NextcloudClient({ baseUrl: "https://nextcloud.example.invalid", username: "alice", appPassword: "test", rootPath: "", maxFileBytes: 1024, maxTextFileBytes: 1024 }, fetch, testNextcloudPolicy)) };
  const backend = new MockFileBackend("policy-fixture");
  await backend.createFolder({ path: "", name: "Scope" });
  for (const item of Object.values(tree).flatMap((items) => items ?? [])) {
    const path = item.path.split("/").slice(0, -1).join("/");
    if (item.isFolder) await backend.createFolder({ path, name: item.name });
    else await backend.upload({ path, name: item.name, contentBase64: "YQ==" });
  }
  return { fetch, backend };
}

afterEach(() => { resetMockEntries(); resetConnectedAccountStoreForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(["mock", "real"] as const)("%s backend bounded policy", (kind) => {
  it.each([
    { name: "empty tree", tree: { Scope: [] }, query: "needle", count: 0, completeness: "complete", calls: 1 },
    { name: "empty query", tree: { Scope: files(1) }, query: "  ", count: 0, completeness: "complete", calls: 0 },
    { name: "exactly 20 exhausted", tree: { Scope: files(20) }, query: "needle", count: 20, completeness: "complete", calls: 1 },
    { name: "20 with work", tree: { Scope: files(21) }, query: "needle", count: 20, completeness: "partial", calls: 1 },
    { name: "exactly 50 exhausted", tree: { Scope: folders(49) }, query: "needle", count: 0, completeness: "complete", calls: 50 },
    { name: "50 with queue", tree: { Scope: folders(50) }, query: "needle", count: 0, completeness: "partial", calls: 50 },
    { name: "200 children exhausted", tree: { Scope: files(200) }, query: "absent", count: 0, completeness: "complete", calls: 1 },
    { name: "201 children incomplete", tree: { Scope: files(201) }, query: "absent", count: 0, completeness: "partial", calls: 1 },
    { name: "depth omitted", tree: { Scope: [entry("Scope/a", true)], "Scope/a": [entry("Scope/a/b", true)], "Scope/a/b": [entry("Scope/a/b/c", true)], "Scope/a/b/c": [entry("Scope/a/b/c/d", true)] }, query: "absent", count: 0, completeness: "partial", calls: 4 }
  ])("$name", async ({ tree, query, count, completeness, calls }) => {
    const { backend, fetch } = await adapter(kind, tree);
    const result = await backend.search("Scope", query);
    expect(result.completeness).toBe(completeness);
    expect(result.items).toHaveLength(count);
    if (kind === "real") expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it.each([20, 21])("negotiates exact old/new shape for %i matches", async (count) => {
    const { backend } = await adapter(kind, { Scope: files(count) });
    for (const coverage of [undefined, "bounded-v1"] as const) {
      const response = await executeFileRoute({ id: "search", auth: "session", input: { path: "Scope", query: "needle", ...(coverage ? { coverage } : {}) } }, new Request("https://worker.test/api/search"), backend);
      const payload = (coverage ? searchEndpoint.successSchema : legacySearchSuccessSchema).parse(await response.json());
      expect(Object.keys(payload.data).sort()).toEqual(coverage ? ["completeness", "items", "path", "query"] : ["items", "path", "query"]);
      if (coverage) expect(searchEndpoint.successSchema.parse(payload).data.completeness).toBe(count === 20 ? "complete" : "partial");
    }
  });
});

describe("search policy list-port invariants", () => {
  it("deduplicates normalized folders and restricts scope, with deterministic scores", async () => {
    const list = vi.fn(async (path: string) => ({ completeness: "complete" as const, items: path === "Scope" ? [entry("Scope", true), entry("Scope2/needle"), entry("Scope/needle", true), entry("Scope//needle", true)] : [entry("Scope/needle/z"), entry("Scope/needle/a-needle"), entry("Scope/needle/needle")] }));
    const result = await boundedSearch("/Scope/", " NEEDLE ", list);
    expect(list.mock.calls.map(([path]) => path)).toEqual(["Scope", "Scope/needle"]);
    expect(result.completeness).toBe("complete");
    expect(result.items.map((item) => [item.path, item.score])).toEqual([["Scope/needle", 100], ["Scope/needle", 100], ["Scope/needle/needle", 100], ["Scope/needle/a-needle", 75], ["Scope/needle/z", 50]]);
  });
  it("enforces its own 200-child ceiling and propagates explicit partialness", async () => {
    for (const count of [200, 201]) {
      expect(await boundedSearch("Scope", "absent", async () => ({ items: files(count), completeness: "complete" }))).toEqual({ items: [], completeness: count === 200 ? "complete" : "partial" });
    }
    expect(await boundedSearch("Scope", "absent", async () => ({ items: [], completeness: "partial" }))).toEqual({ items: [], completeness: "partial" });
  });
  it("propagates subtree errors", async () => {
    const failure = new Error("upstream unavailable");
    await expect(boundedSearch("Scope", "needle", async () => { throw failure; })).rejects.toBe(failure);
  });
});

it("bounds external calls through authenticated handleRequest and distinguishes selector absence from invalid values", async () => {
  const realEnv = { ...env, MOCK_BACKEND: "false", NEXTCLOUD_ALLOWED_HOSTS: "nextcloud.example.invalid", NEXTCLOUD_ROOT_PATH: "" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/alice/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`, { status: 207 })));
  const account = await connectMockAccount({ baseUrl: "https://nextcloud.example.invalid", username: "alice" }, realEnv);
  const session = await handleRequest(new Request("http://127.0.0.1:8787/api/session", { method: "POST", headers: { ...ownerHeaders, "content-type": "application/json" }, body: JSON.stringify({ accountId: account.data.account.id }) }), realEnv);
  const token = parseSessionToken(await session.json());
  const fetch = davFetch({ Scope: folders(60) });
  vi.stubGlobal("fetch", fetch);
  const request = (suffix: string, authorized = true) => new Request(`http://127.0.0.1:8787/api/search?path=Scope&q=absent${suffix}`, { headers: { origin: "http://127.0.0.1:4173", ...(authorized ? { authorization: `Bearer ${token}` } : {}) } });
  const response = await handleRequest(request("&coverage=bounded-v1"), realEnv);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { path: "Scope", query: "absent", items: [], completeness: "partial" } });
  expect(fetch).toHaveBeenCalledTimes(50);
  for (const suffix of ["&coverage=", "&coverage=unknown"]) {
    expect((await handleRequest(request(suffix, false), realEnv)).status).toBe(401);
    expect((await handleRequest(request(suffix), realEnv)).status).toBe(400);
  }
  expect(fetch).toHaveBeenCalledTimes(50);
});
