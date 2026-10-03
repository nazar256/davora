import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiRequestError,
  copyFile,
  createFolder,
  deleteFile,
  downloadFile,
  fetchDownloadBlob,
  fetchOriginalFile,
  getFile,
  listFiles,
  moveFile,
  prepareDownloadFile,
  resolveApiBase,
  searchFiles,
  uploadFile,
  uploadFileWithProgress
} from "./lib/api";
import { createBrowserAccountTransport } from "./platform/api/browserAccountTransport";
import { createBrowserOwnershipEnvironmentPort } from "./platform/security/browserOwnershipEnvironmentPort";
import { createBrowserOwnershipStoragePort } from "./platform/security/browserOwnershipStoragePort";
import { createBrowserOwnershipIdentityService } from "./features/accounts/ownership";
import { createBrowserStringStorage } from "./platform/storage/browserStringStorage";
import { setBackendNetworkBlocked } from "./lib/networkPolicy";
import { buildAccount, buildSession } from "./test/accounts";

const accountTransport = createBrowserAccountTransport(createBrowserOwnershipIdentityService({
  storage: createBrowserOwnershipStoragePort(createBrowserStringStorage()),
  environment: createBrowserOwnershipEnvironmentPort()
}));
const connectAccount = accountTransport.connectAccount;
const createSession = accountTransport.createSession;
const deleteConnectedAccount = accountTransport.deleteConnectedAccount;
const getHealth = accountTransport.getHealth;

beforeEach(() => {
  setBackendNetworkBlocked(false);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

class ControlledUploadRequest {
  static responseText = "";
  static lastInstance: ControlledUploadRequest | undefined;

  readonly upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  status = 201;
  responseText = ControlledUploadRequest.responseText;
  responseType = "";
  onload: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  abortCalls = 0;

  constructor() {
    ControlledUploadRequest.lastInstance = this;
  }

  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.abortCalls += 1;
    this.aborted = true;
    this.onabort?.();
    this.onloadend?.();
  }

  fail() {
    this.onerror?.();
    this.onloadend?.();
  }

  emitLateProgress(loaded: number) {
    this.upload.onprogress?.({ loaded });
  }

  complete() {
    this.onload?.();
    this.onloadend?.();
  }
}

describe("browser API contract", () => {
  it("classifies invalid JSON without retaining the response body", async () => {
    const body = '{"private-sentinel":';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-davora-worker-build": "worker-abc123",
        "x-davora-api-contract": "2"
      }
    })));

    const error = await listFiles("Docs", "token").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      code: "invalid_response",
      responseDiagnostic: {
        phase: "json-decode",
        status: 200,
        contentType: "json",
        payloadBytes: new TextEncoder().encode(body).byteLength,
        workerBuild: "worker-abc123",
        apiContract: "2"
      }
    });
    expect(JSON.stringify(error)).not.toContain("private-sentinel");
  });

  it("summarizes invalid envelope issues without retaining rejected values", async () => {
    const body = JSON.stringify({ data: { completeness: "complete", path: "Docs", items: [{ path: "../private-sentinel", name: "x", isFolder: false }] } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    const error = await listFiles("Docs", "token").catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: "invalid_response",
      responseDiagnostic: {
        phase: "envelope-schema",
        status: 200,
        contentType: "json",
        issues: [{ path: ["data", "items", 0, "path"], code: "custom", actualType: "string" }]
      }
    });
    expect(JSON.stringify(error)).not.toContain("private-sentinel");
  });

  it("rejects malformed successful health responses at the browser trust boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: {
        app: "davora",
        configLoaded: "yes"
      }
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(getHealth()).rejects.toMatchObject({
      name: "Error",
      status: 200,
      code: "invalid_response"
    });
  });

  it("rejects malformed successful account responses at the transport trust boundary", async () => {
    const malformed = { account: { id: "alpha", appPassword: "response-secret-sentinel" } };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: malformed }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectAccount({
      type: "nextcloud",
      baseUrl: "https://cloud.example.com",
      username: "alpha",
      appPassword: "request-password-sentinel"
    })).resolves.toEqual({ kind: "invalid-http-success" });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ appPassword: "request-password-sentinel" });
    expect(localStorage.getItem("davora-account-state")).toBeNull();
  });

  it.each(["invalid JSON", "empty body"] as const)(
    "marks a 201 account response with %s as an invalid HTTP success",
    async (bodyKind) => {
      const body = bodyKind === "invalid JSON" ? '{"response-secret-sentinel":' : "";
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body, {
        status: 201,
        headers: { "content-type": "application/json" }
      }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(connectAccount({
        type: "nextcloud",
        baseUrl: "https://cloud.example.com",
        username: "alpha",
        appPassword: "request-password-sentinel"
      })).resolves.toEqual({ kind: "invalid-http-success" });

      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ appPassword: "request-password-sentinel" });
      expect(localStorage.getItem("davora-account-state")).toBeNull();
    }
  );

  it("keeps session transport separate from account-state persistence", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    const session = buildSession(account);
    localStorage.setItem("davora-browser-id", "browser-id");
    localStorage.setItem("davora-browser-secret", "browser-secret");
    localStorage.setItem("davora-account-state", JSON.stringify({ activeAccountId: account.id, accounts: [{ account }] }));
    const before = localStorage.getItem("davora-account-state");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { session } }), { status: 200 })));

    await expect(createSession({ accountId: account.id })).resolves.toEqual(session);
    expect(localStorage.getItem("davora-account-state")).toBe(before);
  });

  it("rejects mismatched create-folder and upload responses at the browser trust boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const isFolder = path === "/api/folders";
      return new Response(JSON.stringify({
        data: {
          result: {
            action: isFolder ? "createFolder" : "upload",
            parentPath: "",
            path: "wrong",
            item: { path: "wrong", name: "wrong", isFolder }
          }
        }
      }), { status: 201, headers: { "content-type": "application/json" } });
    }));

    await expect(createFolder({ path: "", name: "Temp" }, "token")).rejects.toMatchObject({ code: "invalid_response" });
    await expect(uploadFile({ path: "", name: "test.txt", contentBase64: "YQ==" }, "token")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("validates progressive upload responses and forwards caller cancellation", async () => {
    ControlledUploadRequest.responseText = JSON.stringify({
      data: {
        result: {
          action: "upload",
          parentPath: "",
          path: "wrong.txt",
          item: { path: "wrong.txt", name: "wrong.txt", isFolder: false }
        }
      }
    });
    vi.stubGlobal("XMLHttpRequest", ControlledUploadRequest);

    const invalidResponse = uploadFileWithProgress({ path: "", name: "test.txt", contentBase64: "YQ==" }, "token");
    ControlledUploadRequest.lastInstance?.complete();
    await expect(invalidResponse).rejects.toMatchObject({ code: "invalid_response", status: 201 });

    const controller = new AbortController();
    const cancelled = uploadFileWithProgress({ path: "", name: "test.txt", contentBase64: "YQ==" }, "token", undefined, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ message: "Request aborted", status: 0 });
    expect(ControlledUploadRequest.lastInstance?.aborted).toBe(true);
  });

  it("releases progressive XHR ownership exactly once and ignores late progress after success", async () => {
    ControlledUploadRequest.responseText = JSON.stringify({
      data: {
        result: {
          action: "upload",
          parentPath: "",
          path: "test.txt",
          item: { path: "test.txt", name: "test.txt", isFolder: false }
        }
      }
    });
    vi.stubGlobal("XMLHttpRequest", ControlledUploadRequest);
    const onProgress = vi.fn();
    const request = uploadFileWithProgress({ path: "", name: "test.txt", contentBase64: "YQ==" }, "token", onProgress);
    const xhr = ControlledUploadRequest.lastInstance;
    if (!xhr) throw new Error("Controlled upload request was not created.");

    xhr.emitLateProgress(1);
    xhr.complete();
    await expect(request).resolves.toBeDefined();
    expect(onProgress).toHaveBeenCalledTimes(1);
    xhr.emitLateProgress(2);
    expect(onProgress).toHaveBeenCalledTimes(1);

    setBackendNetworkBlocked(true);
    expect(xhr.abortCalls).toBe(0);
  });

  it("keeps progressive XHR failure and abort terminals inert for late callbacks", async () => {
    ControlledUploadRequest.responseText = "{}";
    vi.stubGlobal("XMLHttpRequest", ControlledUploadRequest);
    const onProgress = vi.fn();

    const failed = uploadFileWithProgress({ path: "", name: "failed.txt", contentBase64: "YQ==" }, "token", onProgress);
    const failedXhr = ControlledUploadRequest.lastInstance;
    if (!failedXhr) throw new Error("Controlled failure request was not created.");
    failedXhr.fail();
    await expect(failed).rejects.toMatchObject({ message: "Request failed", status: 0 });
    failedXhr.emitLateProgress(3);
    failedXhr.complete();
    expect(onProgress).not.toHaveBeenCalled();
    setBackendNetworkBlocked(true);
    expect(failedXhr.abortCalls).toBe(0);

    setBackendNetworkBlocked(false);
    const controller = new AbortController();
    const cancelled = uploadFileWithProgress({ path: "", name: "cancelled.txt", contentBase64: "YQ==" }, "token", onProgress, controller.signal);
    const cancelledXhr = ControlledUploadRequest.lastInstance;
    if (!cancelledXhr) throw new Error("Controlled cancellation request was not created.");
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ message: "Request aborted", status: 0 });
    cancelledXhr.emitLateProgress(4);
    cancelledXhr.complete();
    expect(onProgress).not.toHaveBeenCalled();
    expect(cancelledXhr.abortCalls).toBe(1);
    setBackendNetworkBlocked(true);
    expect(cancelledXhr.abortCalls).toBe(1);
  });

  it("rejects malformed create-folder and upload requests before transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createFolder({ path: "", name: "nested/folder" }, "token")).rejects.toBeDefined();
    await expect(uploadFile({ path: "", name: "bad/name", contentBase64: "YQ==" }, "token")).rejects.toBeDefined();
    await expect(uploadFileWithProgress({ path: "", name: "test.txt", contentBase64: "not base64" }, "token")).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks every API request before transport while explicit offline mode is active", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setBackendNetworkBlocked(true);

    await expect(getHealth()).rejects.toThrow(/explicit offline mode/i);
    await expect(listFiles("", "token")).rejects.toThrow(/explicit offline mode/i);
    await expect(fetchOriginalFile("photo.jpg", "token")).rejects.toThrow(/explicit offline mode/i);
    await expect(uploadFileWithProgress({ path: "", name: "blocked.txt", contentBase64: "YQ==" }, "token")).rejects.toThrow(/explicit offline mode/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards folder request cancellation to fetch", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const request = listFiles("", "token", controller.signal);

    const forwardedSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(forwardedSignal).toBeInstanceOf(AbortSignal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(forwardedSignal?.aborted).toBe(true);
  });

  it("validates search responses and forwards cancellation", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      if (!init?.signal) resolve(new Response(JSON.stringify({ data: { path: "Docs", query: "x", items: "invalid" } }), { status: 200 }));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = searchFiles("Docs", " Raw ", "token", controller.signal);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/search?path=Docs&q=%20Raw%20&coverage=bounded-v1");
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { path: "Docs", query: "x", items: "invalid" } }), { status: 200 })));
    await expect(searchFiles("Docs", "x", "token")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("sends one browser ownership identity for account bootstrap requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
    expect(localStorage.getItem("davora-account-state")).toBeNull();
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

      if (new URL(url, "http://localhost").pathname === "/api/files") {
        return new Response(JSON.stringify({ data: { completeness: "complete", path: "", items: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (new URL(url, "http://localhost").pathname === "/api/search") {
        const parsed = new URL(url, "http://localhost");
        return new Response(JSON.stringify({ data: { completeness: "complete", path: parsed.searchParams.get("path") ?? "", query: parsed.searchParams.get("q") ?? "", items: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
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

      if (url.includes("/api/move")) {
        return new Response(JSON.stringify({
          data: { result: { action: "move", path: "test.txt", destinationPath: "moved.txt", parentPath: "" } }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (url.includes("/api/copy")) {
        return new Response(JSON.stringify({
          data: { result: { action: "copy", path: "moved.txt", destinationPath: "copied.txt", parentPath: "" } }
        }), { status: 201, headers: { "content-type": "application/json" } });
      }

      if (url.includes("/api/delete")) {
        return new Response(JSON.stringify({
          data: { result: { action: "delete", path: "copied.txt", parentPath: "" } }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (url.includes("/api/folders")) {
        return new Response(JSON.stringify({
          data: { result: { action: "createFolder", path: "Temp", parentPath: "", item: { path: "Temp", name: "Temp", isFolder: true } } }
        }), { status: 201, headers: { "content-type": "application/json" } });
      }

      if (url.includes("/api/upload")) {
        return new Response(JSON.stringify({
          data: { result: { action: "upload", path: "test.txt", parentPath: "", item: { path: "test.txt", name: "test.txt", isFolder: false } } }
        }), { status: 201, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({ data: { completeness: "complete", path: "", items: [], result: { action: "copy", path: "x", parentPath: "" } } }), {
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

  it.each([
    ["move", moveFile, { action: "move", parentPath: "Archive", path: "Docs/other.txt", destinationPath: "Archive/a.txt" }],
    ["copy", copyFile, { action: "copy", parentPath: "Archive", path: "Docs/a.txt", destinationPath: "Archive/other.txt" }]
  ] as const)("rejects a structurally valid but identity-mismatched %s response", async (_operation, execute, result) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { result } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    await expect(execute({ path: "Docs/a.txt", destinationPath: "Archive/a.txt" }, "token"))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects a structurally valid but identity-mismatched delete response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { result: { action: "delete", parentPath: "Docs", path: "Docs/other.txt" } }
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(deleteFile({ path: "Docs/a.txt", confirmName: "a.txt" }, "token"))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects account-root deletion before issuing a browser request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteFile({ path: "", confirmName: "" }, "token")).rejects.toThrow(/root cannot be deleted/i);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("propagates one abort signal through direct-download metadata and body requests", async () => {
    const controller = new AbortController();
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (String(input).includes("/api/metadata")) {
        return new Response(JSON.stringify({
          data: {
            metadata: {
              path: "Projects/roadmap.txt",
              name: "roadmap.txt",
              isFolder: false,
              size: 8,
              mimeType: "text/plain"
            }
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      markBodyStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const prepared = prepareDownloadFile("Projects/roadmap.txt", "token", { signal: controller.signal });
    await bodyStarted;
    controller.abort();

    await expect(prepared).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors an explicit API base override when configured", async () => {
    expect(resolveApiBase("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(resolveApiBase("   http://127.0.0.1:8787   ")).toBe("http://127.0.0.1:8787");
    expect(resolveApiBase(undefined)).toBe("");
    expect(resolveApiBase("   ")).toBe("");
  });
});

describe("current folder listing protocol", () => {
  it("opts in and refuses legacy responses without an unguarded retry", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ data: { path: "Docs", items: [] } }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(listFiles("Docs", "token")).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toContain("listing=complete-v1");
  });
});
