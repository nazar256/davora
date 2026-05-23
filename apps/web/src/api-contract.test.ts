import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectAccount,
  copyFile,
  createFolder,
  createSession,
  deleteFile,
  deleteConnectedAccount,
  downloadFile,
  fetchDownloadBlob,
  fetchOriginalFile,
  getFile,
  getHealth,
  listFiles,
  moveFile,
  resolveApiBase,
  searchFiles,
  uploadFile
} from "./lib/api";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("browser API contract", () => {
  it("sends one browser ownership identity for account bootstrap requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/accounts/alpha")) {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/session")) {
        return new Response(JSON.stringify({
          data: {
            session: {
              token: "token",
              expiresAt: "2099-01-01T00:00:00.000Z",
              rootPath: ".davora-agent-test",
              capabilities: {
                backend: "mock",
                readOnly: false,
                search: true,
                preview: true,
                download: true,
                offlineCache: true,
                createFolder: true,
                upload: true,
                move: true,
                copy: true,
                delete: true,
                mediaPreview: true,
                markdownPreview: true,
                openedFileCache: true
              },
              account: {
                id: "alpha",
                type: "nextcloud",
                displayName: "alpha@example.com",
                baseUrl: "https://cloud.example.com",
                username: "alpha",
                rootPath: ".davora-agent-test",
                backend: "mock",
                connectionState: "connected",
                lastValidatedAt: "2026-05-21T10:00:00.000Z",
                cacheNamespace: "ns-alpha"
              }
            }
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        data: {
          account: {
            id: "alpha",
            type: "nextcloud",
            displayName: "alpha@example.com",
            baseUrl: "https://cloud.example.com",
            username: "alpha",
            rootPath: ".davora-agent-test",
            backend: "mock",
            connectionState: "connected",
            lastValidatedAt: "2026-05-21T10:00:00.000Z",
            cacheNamespace: "ns-alpha"
          }
        }
      }), { status: 201, headers: { "content-type": "application/json" } });
    });

    vi.stubGlobal("fetch", fetchMock);

    await connectAccount({ type: "nextcloud", baseUrl: "https://cloud.example.com", username: "alpha", appPassword: "not-persisted" });
    await createSession({ accountId: "alpha" });
    await deleteConnectedAccount("alpha");

    const connectHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    const sessionHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers as HeadersInit);
    const deleteHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers as HeadersInit);

    const browserId = connectHeaders.get("x-davora-browser-id");
    const browserSecret = connectHeaders.get("x-davora-browser-secret");

    expect(browserId).toBeTruthy();
    expect(browserSecret).toBeTruthy();
    expect(sessionHeaders.get("x-davora-browser-id")).toBe(browserId);
    expect(sessionHeaders.get("x-davora-browser-secret")).toBe(browserSecret);
    expect(deleteHeaders.get("x-davora-browser-id")).toBe(browserId);
    expect(deleteHeaders.get("x-davora-browser-secret")).toBe(browserSecret);
    expect(localStorage.getItem("davora-account-state")).not.toContain("not-persisted");
  });

  it("uses only normalized /api endpoints for browser requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/file/original")) {
        return new Response(new Blob(["hello"]), {
          status: 200,
          headers: {
            "content-disposition": "attachment; filename*=UTF-8''hello.txt",
            "content-type": "text/plain"
          }
        });
      }
      if (url.includes("/api/download?path=")) {
        return new Response(new Blob(["download"]), {
          status: 200,
          headers: {
            "content-disposition": "attachment; filename*=UTF-8''roadmap.txt",
            "content-type": "text/plain"
          }
        });
      }

      if (url.includes("/api/health")) {
        return new Response(
          JSON.stringify({
            data: {
              app: "davora",
              configLoaded: true,
              backend: "mock",
              rootPath: ".davora-agent-test",
              unlockRequired: false,
              connectionMode: "in_app",
              supportedAccountTypes: ["nextcloud"]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/accounts")) {
        return new Response(
          JSON.stringify({
            data: {
              account: {
                id: "alpha",
                type: "nextcloud",
                displayName: "alpha@example.com",
                baseUrl: "https://cloud.example.com",
                username: "alpha",
                rootPath: ".davora-agent-test",
                backend: "mock",
                connectionState: "connected",
                lastValidatedAt: "2026-05-21T10:00:00.000Z",
                cacheNamespace: "ns-alpha"
              }
            }
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/session")) {
        return new Response(
          JSON.stringify({
            data: {
              session: {
                token: "token",
                expiresAt: "2099-01-01T00:00:00.000Z",
                rootPath: ".davora-agent-test",
                capabilities: {
                  backend: "mock",
                  readOnly: false,
                  search: true,
                  preview: true,
                  download: true,
                  offlineCache: true,
                  createFolder: true,
                  upload: true,
                  move: true,
                  copy: true,
                  delete: true,
                  mediaPreview: true,
                  markdownPreview: true,
                  openedFileCache: true
                },
                account: {
                  id: "alpha",
                  type: "nextcloud",
                  displayName: "alpha@example.com",
                  baseUrl: "https://cloud.example.com",
                  username: "alpha",
                  rootPath: ".davora-agent-test",
                  backend: "mock",
                  connectionState: "connected",
                  lastValidatedAt: "2026-05-21T10:00:00.000Z",
                  cacheNamespace: "ns-alpha"
                }
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/file")) {
        return new Response(
          JSON.stringify({
            data: {
              file: {
                path: "Projects/roadmap.txt",
                name: "roadmap.txt",
                isFolder: false,
                viewer: "text",
                content: "hello",
                encoding: "utf8",
                truncated: false,
                bytesRead: 5
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/metadata")) {
        return new Response(
          JSON.stringify({
            data: {
              metadata: {
                path: "Projects/roadmap.txt",
                name: "roadmap.txt",
                isFolder: false,
                size: 5,
                mimeType: "text/plain"
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ data: { path: "", items: [], result: { action: "copy", path: "x", parentPath: "" } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    const createObjectUrl = typeof URL.createObjectURL === "function"
      ? vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download")
      : vi.fn(() => "blob:download");
    if (typeof URL.createObjectURL !== "function") {
      Object.defineProperty(URL, "createObjectURL", { value: createObjectUrl, configurable: true });
    }
    const revokeObjectUrl = typeof URL.revokeObjectURL === "function"
      ? vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
      : vi.fn(() => undefined);
    if (typeof URL.revokeObjectURL !== "function") {
      Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectUrl, configurable: true });
    }
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(this: HTMLAnchorElement) {
      expect(this.download).toBe("roadmap.txt");
      expect(this.href).toBe("blob:download");
    });

    try {
      await getHealth();
      await connectAccount({ type: "nextcloud", baseUrl: "https://cloud.example.com", username: "alpha", appPassword: "not-persisted" });
      await createSession({ accountId: "alpha" });
      await listFiles("", "token");
      await getFile("Projects/roadmap.txt", "token");
      await searchFiles("", "roadmap", "token");
      await createFolder({ path: "", name: "Temp" }, "token");
      await uploadFile({ path: "", name: "test.txt", contentBase64: "aGVsbG8=", mimeType: "text/plain" }, "token");
      await moveFile({ path: "test.txt", destinationPath: "moved.txt" }, "token");
      await copyFile({ path: "moved.txt", destinationPath: "copied.txt" }, "token");
      await deleteFile({ path: "copied.txt", confirmName: "copied.txt" }, "token");
      await fetchOriginalFile("Projects/roadmap.txt", "token");
      await downloadFile("Projects/roadmap.txt", "token");

      const calledUrls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(calledUrls.length).toBeGreaterThan(0);
      calledUrls.forEach((url) => expect(url).toContain("/api/"));
      expect(calledUrls.join(" ")).not.toMatch(/remote\.php\/dav|authorization:\s*basic|nextcloud_app_password/i);
      expect(calledUrls.some((url) => url.includes("/api/metadata?path=Projects%2Froadmap.txt"))).toBe(true);
      expect(calledUrls.some((url) => url.includes("/api/download?path=Projects%2Froadmap.txt"))).toBe(true);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(document.querySelector('a[download="roadmap.txt"]')).toBeNull();
    } finally {
      clickSpy.mockRestore();
      if ("mockRestore" in createObjectUrl) {
        (createObjectUrl as unknown as { mockRestore(): void }).mockRestore();
      }
      if ("mockRestore" in revokeObjectUrl) {
        (revokeObjectUrl as unknown as { mockRestore(): void }).mockRestore();
      }
    }
  });

  it("defaults browser API requests to same-origin /api paths in local dev", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      data: {
        app: "davora",
        configLoaded: true,
        backend: "mock",
        rootPath: ".davora-agent-test",
        unlockRequired: false,
        connectionMode: "in_app",
        supportedAccountTypes: ["nextcloud"]
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);
    await getHealth();

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls).toEqual(["/api/health"]);
  });

  it("returns an empty blob for zero-byte downloads without re-reading the body", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(0), {
      status: 200,
      headers: {
        "content-disposition": "attachment; filename*=UTF-8''empty.txt",
        "content-type": "text/plain",
        "content-length": "0"
      }
    }));

    vi.stubGlobal("fetch", fetchMock);

    const progress = vi.fn();
    const result = await fetchDownloadBlob("Projects/empty.txt", "token", { onProgress: progress });

    expect(result.filename).toBe("empty.txt");
    expect(result.blob.size).toBe(0);
    expect(result.blob.type).toBe("text/plain");
    expect(progress).toHaveBeenCalledWith(0, 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors an explicit API base override when configured", async () => {
    expect(resolveApiBase("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(resolveApiBase("   http://127.0.0.1:8787   ")).toBe("http://127.0.0.1:8787");
    expect(resolveApiBase(undefined)).toBe("");
    expect(resolveApiBase("   ")).toBe("");
  });
});
