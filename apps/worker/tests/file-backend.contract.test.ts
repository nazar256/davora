import { afterEach, describe, expect, it, vi } from "vitest";

import { executeFileRoute } from "../src/files/service";
import { workerFailureResponse } from "../src/http/failure";
import type { FileBackend } from "../src/files/backend";
import { MockFileBackend } from "../src/files/mockFileBackend";
import { NextcloudFileBackend } from "../src/files/nextcloudFileBackend";
import { resetMockEntries } from "../src/mock/data";
import { NextcloudClient } from "../src/nextcloud/client";
import { createNextcloudDestinationPolicy } from "../src/security/nextcloudDestinationPolicy";

const accountId = "file-backend-contract";
const baseClientOptions = {
  baseUrl: "https://fake.nextcloud.test",
  username: "contract-user",
  appPassword: "contract-password",
  rootPath: "",
  maxFileBytes: 1024 * 1024,
  maxTextFileBytes: 64 * 1024
};

function mutation(action: "createFolder" | "upload" | "move" | "copy" | "delete") {
  return {
    action,
    parentPath: "Projects",
    path: action === "delete" ? "Projects/roadmap.txt" : "Projects/result.txt",
    ...(action === "move" || action === "copy" ? { destinationPath: "Projects/result.txt" } : {})
  } as const;
}

describe("FileBackend adapter contract", () => {
  afterEach(() => {
    resetMockEntries();
    vi.restoreAllMocks();
  });

  it("exposes all twelve operations through the mock adapter", async () => {
    const backend: FileBackend = new MockFileBackend(accountId);
    resetMockEntries(accountId);

    await expect(backend.list("Projects").then((listing) => listing.items)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "Projects/roadmap.txt" })
    ]));
    await expect(backend.metadata("Projects/roadmap.txt")).resolves.toMatchObject({ path: "Projects/roadmap.txt" });
    await expect(backend.preview("Projects/roadmap.txt")).resolves.toMatchObject({ viewer: "text" });
    await expect(backend.original("Projects/song.mp3")).resolves.toMatchObject({ metadata: { name: "song.mp3" } });
    await expect(backend.stream("Projects/song.mp3", "bytes=1-2")).resolves.toMatchObject({ status: 206, contentLength: 2 });
    await expect(backend.search("Projects", "roadmap").then((result) => result.items)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "Projects/roadmap.txt" })
    ]));
    await expect(backend.download("Archive/image.bin")).resolves.toMatchObject({ filename: "image.bin", mimeType: "application/octet-stream" });
    await expect(backend.createFolder({ path: "", name: "ContractFolder" })).resolves.toMatchObject({ action: "createFolder", path: "ContractFolder", parentPath: "" });
    await expect(backend.upload({ path: "Projects", name: "result.txt", mimeType: "text/plain", contentBase64: "cmVzdWx0" })).resolves.toMatchObject(mutation("upload"));
    await expect(backend.move({ path: "Projects/roadmap.txt", destinationPath: "Projects/moved-result.txt" })).resolves.toMatchObject({ action: "move" });
    await expect(backend.copy({ path: "Projects/song.mp3", destinationPath: "Projects/copied-result.mp3" })).resolves.toMatchObject({ action: "copy" });
    await expect(backend.delete({ path: "Projects/moved-result.txt", confirmName: "moved-result.txt" })).resolves.toMatchObject({ action: "delete" });
  });

  it("maps the existing Nextcloud client to the same backend-neutral results", async () => {
    const client = new NextcloudClient(baseClientOptions, vi.fn<typeof fetch>(), createNextcloudDestinationPolicy({ runtimeMode: "production", allowLocalNextcloud: false, allowedHosts: ["nextcloud.example.invalid"] }));
    const metadata = { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, mimeType: "text/plain" } as const;
    vi.spyOn(client, "listFolder").mockResolvedValue({ completeness: "complete", items: [metadata] });
    vi.spyOn(client, "getMetadata").mockResolvedValue(metadata);
    vi.spyOn(client, "readFile").mockResolvedValue({ ...metadata, viewer: "text", content: "roadmap", encoding: "utf8", truncated: false, bytesRead: 7 });
    vi.spyOn(client, "readOriginal").mockResolvedValue({ metadata, body: new Uint8Array([1, 2]) });
    const upstreamStreamResponse = new Response(new Uint8Array([2]), { status: 206, headers: { "content-type": "text/plain", "content-length": "1", "content-range": "bytes 1-1/2" } });
    const upstreamArrayBuffer = vi.spyOn(upstreamStreamResponse, "arrayBuffer");
    vi.spyOn(client, "streamOriginal").mockResolvedValue({
      metadata,
      response: upstreamStreamResponse
    });
    vi.spyOn(client, "download").mockResolvedValue({ metadata, body: new Uint8Array([3]) });
    vi.spyOn(client, "createFolder").mockResolvedValue(mutation("createFolder"));
    vi.spyOn(client, "uploadFile").mockResolvedValue(mutation("upload"));
    vi.spyOn(client, "moveResource").mockResolvedValue(mutation("move"));
    vi.spyOn(client, "copyResource").mockResolvedValue(mutation("copy"));
    vi.spyOn(client, "deleteResource").mockResolvedValue(mutation("delete"));

    const backend: FileBackend = new NextcloudFileBackend(client);
    await expect(backend.list("Projects")).resolves.toEqual({ completeness: "complete", items: [metadata] });
    await expect(backend.metadata("Projects/roadmap.txt")).resolves.toEqual(metadata);
    await expect(backend.preview("Projects/roadmap.txt")).resolves.toMatchObject({ viewer: "text" });
    await expect(backend.original("Projects/roadmap.txt")).resolves.toMatchObject({ metadata, body: new Uint8Array([1, 2]) });
    const streamed = await backend.stream("Projects/roadmap.txt", "bytes=1-1");
    expect(streamed).toMatchObject({ status: 206, contentRange: "bytes 1-1/2", contentLength: 1 });
    expect(streamed?.body).toBe(upstreamStreamResponse.body);
    expect(upstreamArrayBuffer).not.toHaveBeenCalled();
    await expect(backend.search("Projects", "roadmap").then((result) => result.items)).resolves.toEqual([{ ...metadata, score: 75 }]);
    await expect(backend.download("Projects/roadmap.txt")).resolves.toMatchObject({ filename: "roadmap.txt", mimeType: "text/plain" });
    await expect(backend.createFolder({ path: "Projects", name: "result" })).resolves.toMatchObject({ action: "createFolder" });
    await expect(backend.upload({ path: "Projects", name: "result.txt", contentBase64: "cmVzdWx0" })).resolves.toMatchObject({ action: "upload" });
    await expect(backend.move({ path: "Projects/roadmap.txt", destinationPath: "Projects/result.txt" })).resolves.toMatchObject({ action: "move" });
    await expect(backend.copy({ path: "Projects/roadmap.txt", destinationPath: "Projects/result.txt" })).resolves.toMatchObject({ action: "copy" });
    await expect(backend.delete({ path: "Projects/roadmap.txt", confirmName: "roadmap.txt" })).resolves.toMatchObject({ action: "delete" });
  });
});

describe("mock bounded listing parity", () => {
  it.each([0, 199, 200, 201, 205])("reports completeness for %i direct children", async (count) => {
    const backend = new MockFileBackend(`bounded-${count}`);
    await backend.createFolder({ path: "", name: "bounded" });
    for (let index = 0; index < count; index += 1) await backend.createFolder({ path: "bounded", name: `child-${index}` });
    const listing = await backend.list("bounded");
    expect(listing.completeness).toBe(count > 200 ? "partial" : "complete");
    expect(listing.items).toHaveLength(Math.min(count, 200));
  });
});


describe("listing compatibility across backends", () => {
  it.each(["mock", "nextcloud"] as const)("projects complete and partial %s listings at the service boundary", async (kind) => {
    const mock = new MockFileBackend(`compatibility-${kind}`);
    await mock.createFolder({ path: "", name: "bounded" });
    const client = new NextcloudClient(baseClientOptions, vi.fn<typeof fetch>(), createNextcloudDestinationPolicy({ runtimeMode: "production", allowLocalNextcloud: false, allowedHosts: ["nextcloud.example.invalid"] }));
    const list = vi.spyOn(client, "listFolder").mockImplementation(() => mock.list("bounded"));
    const backend = kind === "mock" ? mock : new NextcloudFileBackend(client);
    const request = new Request("https://worker.test/api/files?path=bounded");
    const legacy = { id: "files" as const, auth: "session" as const, input: { path: "bounded" } };
    const current = { id: "files" as const, auth: "session" as const, input: { path: "bounded", listing: "complete-v1" as const } };
    expect(await (await executeFileRoute(legacy, request, backend)).json()).toEqual({ data: { path: "bounded", items: [] } });
    expect(await (await executeFileRoute(current, request, backend)).json()).toEqual({ data: { path: "bounded", items: [], completeness: "complete" } });
    for (let index = 0; index < 201; index += 1) await mock.createFolder({ path: "bounded", name: `child-${index}` });
    const failure = await executeFileRoute(legacy, request, backend).catch(workerFailureResponse);
    expect(failure.status).toBe(426);
    expect(await failure.json()).toEqual({ data: { code: "invalid_request", message: "Reopen Davora and apply the app update to open this folder safely." } });
    expect(await (await executeFileRoute(current, request, backend)).json()).toMatchObject({ data: { path: "bounded", completeness: "partial" } });
    if (kind === "nextcloud") expect(list).toHaveBeenCalledTimes(4);
  });
});
