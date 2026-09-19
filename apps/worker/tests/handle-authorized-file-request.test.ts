import { describe, expect, it, vi } from "vitest";

import type { CreateFolderRequestInput, DeleteRequestInput, MoveCopyRequestInput, MutationResult, UploadRequestInput } from "@davora/shared";
import type { FileBackend } from "../src/files/backend";
import { executeFileRoute, type FileApplicationRoute } from "../src/files/service";
import { workerFailure, workerFailureResponse } from "../src/http/failure";
import { matchWorkerRoute, type WorkerRoute } from "../src/http/router";

function backend(overrides: Partial<FileBackend> = {}): FileBackend {
  return {
    list: vi.fn(async () => []),
    metadata: vi.fn(async () => undefined),
    preview: vi.fn(async () => undefined),
    original: vi.fn(async () => undefined),
    stream: vi.fn(async () => undefined),
    search: vi.fn(async () => []),
    download: vi.fn(async () => undefined),
    createFolder: vi.fn(async (input: CreateFolderRequestInput): Promise<MutationResult> => ({ action: "createFolder", parentPath: input.path, path: `${input.path ? `${input.path}/` : ""}${input.name}`, item: { path: `${input.path ? `${input.path}/` : ""}${input.name}`, name: input.name, isFolder: true } })),
    upload: vi.fn(async (input: UploadRequestInput): Promise<MutationResult> => ({ action: "upload", parentPath: input.path, path: `${input.path ? `${input.path}/` : ""}${input.name}`, item: { path: `${input.path ? `${input.path}/` : ""}${input.name}`, name: input.name, isFolder: false } })),
    move: vi.fn(async (input: MoveCopyRequestInput): Promise<MutationResult> => ({ action: "move", parentPath: "Projects", path: input.path, destinationPath: input.destinationPath })),
    copy: vi.fn(async (input: MoveCopyRequestInput): Promise<MutationResult> => ({ action: "copy", parentPath: "Projects", path: input.path, destinationPath: input.destinationPath })),
    delete: vi.fn(async (input: DeleteRequestInput): Promise<MutationResult> => ({ action: "delete", parentPath: "Projects", path: input.path })),
    ...overrides
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://worker.test${path}`, init);
}

function isFileRoute(route: WorkerRoute): route is FileApplicationRoute {
  return !["health", "reset", "connectAccount", "deleteAccount", "session", "streamToken"].includes(route.id);
}

async function handleFileRequest(input: Request, files: FileBackend): Promise<Response> {
  try {
    const route = await matchWorkerRoute(input);
    if (!isFileRoute(route)) throw workerFailure("not_found", "non-file-route");
    return await executeFileRoute(route, input, files);
  } catch (error) {
    return workerFailureResponse(error);
  }
}

describe("file application service", () => {
  it.each([
    {
      name: "reconnect-required",
      path: "/api/files?path=Projects",
      init: {},
      method: "list" as const,
      message: "Reconnect this account before browsing files. account-secret",
      status: 409,
      code: "account_reconnect_required"
    },
    {
      name: "confirmation-required",
      path: "/api/delete",
      init: { method: "POST", body: JSON.stringify({ path: "Projects/roadmap.txt", confirmName: "roadmap.txt" }) },
      method: "delete" as const,
      message: "Delete confirmation does not match the target name. private-path",
      status: 400,
      code: "delete_confirmation_required"
    },
    {
      name: "conflict",
      path: "/api/folders",
      init: { method: "POST", body: JSON.stringify({ path: "Projects", name: "Archive" }) },
      method: "createFolder" as const,
      message: "Destination already exists. bearer-token",
      status: 409,
      code: "conflict"
    },
    {
      name: "not-found",
      path: "/api/metadata?path=Projects/roadmap.txt",
      init: {},
      method: "metadata" as const,
      message: "Resource not found. /private/upstream/path",
      status: 404,
      code: "not_found"
    },
    {
      name: "permission-denied",
      path: "/api/metadata?path=Projects/roadmap.txt",
      init: {},
      method: "metadata" as const,
      message: "Permission denied by upstream. authorization-detail",
      status: 403,
      code: "permission_denied"
    }
  ] as const)("redacts raw classified backend details for $name", async ({ path, init, method, message, status, code }) => {
    const files = backend({ [method]: vi.fn(async () => { throw new Error(message); }) });
    const response = await handleFileRequest(request(path, init), files);
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(text)).toMatchObject({ data: { code } });
    expect(text).not.toContain(message);
    expect(text).not.toContain("account-secret");
    expect(text).not.toContain("private-path");
    expect(text).not.toContain("bearer-token");
    expect(text).not.toContain("/private/upstream/path");
    expect(text).not.toContain("authorization-detail");
  });

  it("dispatches the read routes through one backend and keeps unknown routes inert", async () => {
    const file = { path: "Projects/a.txt", name: "a.txt", isFolder: false, mimeType: "text/plain" };
    const files = backend({ list: vi.fn(async () => [file]), metadata: vi.fn(async () => file) });

    const listed = await handleFileRequest(request("/api/files?path=Projects"), files);
    expect(listed.status).toBe(200);
    expect(files.list).toHaveBeenCalledWith("Projects");

    const metadata = await handleFileRequest(request("/api/metadata?path=Projects/a.txt"), files);
    expect(metadata.status).toBe(200);
    expect(files.metadata).toHaveBeenCalledWith("Projects/a.txt");

    const unknown = await handleFileRequest(request("/api/unknown?path=Projects"), files);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ data: { code: "not_found", message: "Route not found." } });
  });

  it("maps missing resources, schema failures, stream headers, and download headers", async () => {
    const stream = {
      body: new Uint8Array([1, 2]),
      metadata: { path: "song.mp3", name: "song.mp3", isFolder: false, mimeType: "audio/mpeg" },
      status: 206,
      contentRange: "bytes 1-2/4",
      contentLength: 2
    };
    const files = backend({
      stream: vi.fn(async () => stream),
      download: vi.fn(async () => ({ body: new Uint8Array([3]), filename: "image.bin", mimeType: "application/octet-stream" }))
    });

    const missing = await handleFileRequest(request("/api/file?path=missing.txt"), files);
    expect(missing.status).toBe(404);
    expect((await missing.json())).toEqual({ data: { code: "not_found", message: "File not found." } });

    const invalid = await handleFileRequest(request("/api/files?path=../escape"), files);
    expect(invalid.status).toBe(500);
    expect((await invalid.json())).toMatchObject({ data: { code: "mutation_failed" } });

    const malformed = await handleFileRequest(request("/api/folders", { method: "POST", body: "not-json" }), files);
    expect(malformed.status).toBe(400);

    const streamed = await handleFileRequest(request("/api/file/stream?path=song.mp3", { headers: { range: "bytes=1-2" } }), files);
    expect(streamed.status).toBe(206);
    expect(streamed.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(streamed.headers.get("content-length")).toBe("2");
    expect(streamed.headers.get("content-disposition")).toMatch(/inline; filename\*=UTF-8''song\.mp3/);

    const downloaded = await handleFileRequest(request("/api/download?path=image.bin"), files);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toMatch(/attachment; filename\*=UTF-8''image\.bin/);
  });
});
