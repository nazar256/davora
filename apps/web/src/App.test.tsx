import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount, FilePreview, HealthResponse } from "@davora/shared";

import App from "./App";
import { ApiRequestError } from "./lib/api";
import * as api from "./lib/api";
import * as cache from "./lib/cache";
import { formatFileSize } from "./lib/fileSize";
import * as openedFileCache from "./lib/openedFileCache";
import { saveAccountSession, saveConnectedAccount } from "./lib/accountState";

const { registerSwMock } = vi.hoisted(() => ({
  registerSwMock: vi.fn(() => ({
    offlineReady: [false, vi.fn()] as [boolean, (value: boolean) => void],
    needRefresh: [false, vi.fn()] as [boolean, (value: boolean) => void],
    updateServiceWorker: vi.fn(async () => undefined)
  }))
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: registerSwMock
}));
vi.mock("./components/MarkdownPreview", () => ({ MarkdownPreview: ({ content }: { content: string }) => <div data-testid="markdown-preview">{content}</div> }));

vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  return {
    ...actual,
    getHealth: vi.fn(),
    connectAccount: vi.fn(),
    createSession: vi.fn(),
    deleteConnectedAccount: vi.fn(),
    listFiles: vi.fn(),
    getFile: vi.fn(),
    searchFiles: vi.fn(),
    downloadFile: vi.fn(),
    fetchDownloadBlob: vi.fn(),
    fetchOriginalFile: vi.fn(),
    triggerBrowserDownload: vi.fn(),
    createFolder: vi.fn(),
    uploadFile: vi.fn(),
    uploadFileWithProgress: vi.fn(),
    moveFile: vi.fn(),
    copyFile: vi.fn(),
    deleteFile: vi.fn()
  };
});

vi.mock("./lib/cache", async () => ({
  ...(await vi.importActual<typeof import("./lib/cache")>("./lib/cache")),
  cacheFolder: vi.fn(),
  cacheSearch: vi.fn(),
  clearFolderAndSearchCache: vi.fn(),
  readFolderCache: vi.fn(),
  readFolderCacheEnvelope: vi.fn(),
  readSearchCache: vi.fn()
}));

vi.mock("./lib/openedFileCache", async () => {
  const actual = await vi.importActual<typeof import("./lib/openedFileCache")>("./lib/openedFileCache");
  return {
    ...actual,
    cacheOpenedFile: vi.fn(),
    getCachedOpenedFile: vi.fn(),
    clearOpenedFileCache: vi.fn(),
    configureOpenedFileCache: vi.fn(),
    getOpenedFileCacheSummary: vi.fn(async () => ({ itemCount: 1, totalBytes: 128, limitBytes: actual.DEFAULT_OPENED_FILE_CACHE_LIMIT }))
  };
});

const mockedApi = vi.mocked(api);
const mockedCache = vi.mocked(cache);
const mockedOpenedFileCache = vi.mocked(openedFileCache);

const createObjectUrlMock = vi.fn(() => "blob:preview");
const revokeObjectUrlMock = vi.fn();
const windowOpenMock = vi.fn(() => ({ closed: false } as Window));
const addMediaListenerMock = vi.fn();
const removeMediaListenerMock = vi.fn();
let matchMediaMatches = false;
const matchMediaMock = vi.fn((query?: string) => ({
  matches: query === "(display-mode: standalone)" ? false : matchMediaMatches,
  media: query ?? "(max-width: 900px)",
  onchange: null,
  addEventListener: addMediaListenerMock,
  removeEventListener: removeMediaListenerMock,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn()
}));

const healthResponse: HealthResponse = {
  app: "davora",
  configLoaded: true,
  backend: "mock",
  rootPath: ".davora-agent-test",
  unlockRequired: false,
  connectionMode: "in_app",
  supportedAccountTypes: ["nextcloud"]
};

function buildAccount(id: string, overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id,
    type: "nextcloud",
    displayName: `Account ${id}`,
    label: `Account ${id}`,
    baseUrl: `https://${id}.example.com`,
    username: `${id}-user`,
    rootPath: ".davora-agent-test",
    backend: "mock",
    connectionState: "connected",
    lastValidatedAt: "2026-05-21T10:00:00.000Z",
    cacheNamespace: `ns-${id}`,
    ...overrides
  };
}

function buildSession(account: ConnectedAccount): AppSession {
  return {
    token: `token-${account.id}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
    rootPath: account.rootPath,
    capabilities: {
      backend: account.backend,
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
    account
  };
}

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] }; pendingReconnect?: { baseUrl: string; username: string; label?: string } }>, activeAccountId?: string) {
  localStorage.setItem("davora-account-state", JSON.stringify({
    activeAccountId: activeAccountId ?? records[0]?.account.id,
    accounts: records
  }));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const textPreview: FilePreview = {
  path: "Projects/roadmap.txt",
  name: "roadmap.txt",
  isFolder: false,
  size: 70,
  mimeType: "text/plain",
  viewer: "text",
  content: "normalized API preview",
  encoding: "utf8",
  truncated: false,
  bytesRead: 22
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
  registerSwMock.mockReturnValue({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(async () => undefined)
  });
  matchMediaMatches = false;
  createObjectUrlMock.mockReturnValue("blob:preview");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(window, "matchMedia", { value: matchMediaMock, configurable: true, writable: true });
  Object.defineProperty(URL, "createObjectURL", { value: createObjectUrlMock, configurable: true, writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectUrlMock, configurable: true, writable: true });
  Object.defineProperty(window, "open", { value: windowOpenMock, configurable: true, writable: true });

  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.connectAccount.mockImplementation(async (request) => {
    const account = buildAccount(request.accountId ?? "connected", {
      displayName: request.label?.trim() || `${request.username}@${new URL(request.baseUrl).hostname}`,
      label: request.label,
      baseUrl: request.baseUrl,
      username: request.username,
      cacheNamespace: request.cacheNamespace ?? `ns-${request.accountId ?? "connected"}`
    });
    saveConnectedAccount(account);
    return { account };
  });
  mockedApi.createSession.mockImplementation(async ({ accountId }) => {
    const session = buildSession(buildAccount(accountId, { displayName: `Account ${accountId}` }));
    saveAccountSession(accountId, session);
    return session;
  });
  mockedApi.listFiles.mockImplementation(async (path: string) => {
    if (path === "Projects") {
      return {
        path,
        items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }]
      };
    }
    return {
      path,
      items: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
      ]
    };
  });
  mockedApi.getFile.mockResolvedValue({ file: textPreview });
  mockedApi.searchFiles.mockResolvedValue({
    query: "roadmap",
    path: "",
    items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", score: 75 }]
  });
  mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["download"], { type: "application/octet-stream" }), filename: undefined });
  mockedApi.fetchOriginalFile.mockResolvedValue({ blob: new Blob(["binary"], { type: "image/png" }), mimeType: "image/png", filename: "photo.png" });
  mockedApi.triggerBrowserDownload.mockImplementation(() => undefined);
  mockedApi.createFolder.mockResolvedValue({ result: { action: "createFolder", parentPath: "", path: "Plans" } });
  mockedApi.uploadFileWithProgress.mockResolvedValue({ result: { action: "upload", parentPath: "", path: "Projects/roadmap.txt" } });
  mockedApi.moveFile.mockResolvedValue({ result: { action: "move", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/renamed.txt" } });
  mockedApi.copyFile.mockResolvedValue({ result: { action: "copy", parentPath: "", path: "Projects/roadmap.txt", destinationPath: "Projects/roadmap-copy.txt" } });
  mockedApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "", path: "Projects/roadmap.txt" } });
  mockedCache.readFolderCache.mockReturnValue(undefined);
  mockedCache.readFolderCacheEnvelope.mockReturnValue(undefined);
  mockedCache.readSearchCache.mockReturnValue(undefined);
  mockedOpenedFileCache.getCachedOpenedFile.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("shows the first-run connect account flow", async () => {
    render(<App />);

    await waitFor(() => expect(mockedApi.getHealth).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: /No connected accounts yet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect account/i })).toBeInTheDocument();
  });

  it("surfaces missing SESSION_SECRET from health before the operator reaches a broken release flow", async () => {
    mockedApi.getHealth.mockResolvedValue({
      ...healthResponse,
      configLoaded: false,
      backend: "nextcloud",
      missing: ["SESSION_SECRET"]
    });

    render(<App />);

    expect(await screen.findByText(/SESSION_SECRET is missing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect account/i })).toBeInTheDocument();
  });

  it("connects an account and loads a session", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Connect account/i }));
    await screen.findByRole("heading", { name: /Connect Nextcloud account/i });
    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: "https://cloud.example.com" } });
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(/App password/i), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText(/^Label$/i), { target: { value: "Personal" } });
    fireEvent.submit(screen.getByRole("button", { name: /^Connect account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.connectAccount).toHaveBeenCalled());
    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /Create folder/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Profile & settings/i })).toBeInTheDocument();
  });

  it("auto-restores an account even if browser state is marked reconnect_required but worker state is still intact", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace", connectionState: "reconnect_required" });
    seedAccounts([
      {
        account,
        pendingReconnect: { baseUrl: account.baseUrl, username: account.username, label: account.label }
      }
    ], account.id);

    render(<App />);

    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledWith({ accountId: account.id }));
    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
  });

  it("shows reconnect form with prefilled account info when auto-restore pauses after reconnect failure", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace", connectionState: "reconnect_required" });
    seedAccounts([
      {
        account,
        pendingReconnect: { baseUrl: account.baseUrl, username: account.username, label: account.label }
      }
    ], account.id);
    mockedApi.createSession.mockRejectedValueOnce(new ApiRequestError("Reconnect this account.", 409, "account_reconnect_required"));

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Reconnect Alpha workspace/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue(account.baseUrl)).toBeInTheDocument();
    expect(screen.getByDisplayValue(account.username)).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue(account.label ?? "");
    expect(screen.getByRole("button", { name: /Reconnect account/i })).toBeInTheDocument();
  });

  it("pauses automatic restore after a terminal session failure until the user retries manually", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace" });
    seedAccounts([{ account }], account.id);
    mockedApi.createSession
      .mockRejectedValueOnce(new ApiRequestError("Session expired", 401, "session_invalid"))
      .mockResolvedValueOnce(buildSession(account));

    render(<App />);

    expect(await screen.findByRole("button", { name: /Retry restore/i })).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Retry restore/i }));

    await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
  });

  it("keeps reconnect local to search when a transient search request fails", async () => {
    const account = buildAccount("alpha", { displayName: "Search workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.searchFiles.mockRejectedValueOnce(new TypeError("fetch failed"));
    mockedCache.readSearchCache.mockReturnValue([
      { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain", score: 75 }
    ]);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.change(screen.getByLabelText(/Search files/i), { target: { value: "roadmap" } });

    await waitFor(() => expect(mockedApi.searchFiles).toHaveBeenCalledWith("", "roadmap", "token-alpha"));
    expect(await screen.findByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Reconnect Search workspace/i })).not.toBeInTheDocument();
  });

  it("keeps reconnect local to upload when a transient upload request fails", async () => {
    const account = buildAccount("alpha", { displayName: "Upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.uploadFileWithProgress.mockRejectedValueOnce(new TypeError("fetch failed"));

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    const input = screen.getByLabelText(/Upload files/i) as HTMLInputElement;
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockedApi.uploadFileWithProgress).toHaveBeenCalledWith(expect.objectContaining({ name: "hello.txt", path: "" }), "token-alpha", expect.any(Function)));
    expect(await screen.findByText(/fetch failed/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Reconnect Upload workspace/i })).not.toBeInTheDocument();
  });

  it("uploads multiple files from the normal picker flow", async () => {
    const account = buildAccount("alpha", { displayName: "Multi upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    const input = screen.getByLabelText(/Upload files/i) as HTMLInputElement;
    const first = new File(["alpha"], "alpha.txt", { type: "text/plain" });
    const second = new File(["beta"], "beta.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [first, second] } });

    await waitFor(() => expect(mockedApi.uploadFileWithProgress).toHaveBeenCalledTimes(2));
    expect(mockedApi.uploadFileWithProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "", name: "alpha.txt" }), "token-alpha", expect.any(Function));
    expect(mockedApi.uploadFileWithProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: "", name: "beta.txt" }), "token-alpha", expect.any(Function));
    expect(await screen.findByText(/Uploaded 2 files into \//i)).toBeInTheDocument();
  });

  it("uploads a directory while preserving relative paths under the current folder", async () => {
    const account = buildAccount("alpha", { displayName: "Folder upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    const input = screen.getByLabelText(/Upload folder/i) as HTMLInputElement;
    const first = new File(["cover"], "cover.png", { type: "image/png" });
    const second = new File(["track"], "track.mp3", { type: "audio/mpeg" });
    Object.defineProperty(first, "webkitRelativePath", { configurable: true, value: "Mixtape/assets/cover.png" });
    Object.defineProperty(second, "webkitRelativePath", { configurable: true, value: "Mixtape/track.mp3" });
    fireEvent.change(input, { target: { files: [first, second] } });

    await waitFor(() => expect(mockedApi.createFolder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedApi.uploadFileWithProgress).toHaveBeenCalledTimes(2));
    expect(mockedApi.createFolder).toHaveBeenNthCalledWith(1, { path: "", name: "Mixtape" }, "token-alpha");
    expect(mockedApi.createFolder).toHaveBeenNthCalledWith(2, { path: "Mixtape", name: "assets" }, "token-alpha");
    expect(mockedApi.uploadFileWithProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "Mixtape/assets", name: "cover.png" }), "token-alpha", expect.any(Function));
    expect(mockedApi.uploadFileWithProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: "Mixtape", name: "track.mp3" }), "token-alpha", expect.any(Function));
    expect(await screen.findByText(/Uploaded 2 files from 1 folder into \//i)).toBeInTheDocument();
  });

  it("downloads a mixed file and folder batch as one zip archive", async () => {
    const account = buildAccount("alpha", { displayName: "Batch download workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Archive") {
        return {
          path,
          items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" }]
        };
      }

      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "notes.txt", name: "notes.txt", isFolder: false, size: 9, mimeType: "text/plain" }
        ]
      };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByLabelText(/Select Archive folder for batch download/i));
    fireEvent.click(screen.getByLabelText(/Select notes.txt file for batch download/i));

    expect(await screen.findByText(/2 items selected for download \(1 file and 1 folder\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Download selected$/i }));

    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedApi.triggerBrowserDownload).toHaveBeenCalled());
    expect(mockedApi.fetchDownloadBlob).toHaveBeenNthCalledWith(1, "Archive/photo.png", "token-alpha", expect.any(Object));
    expect(mockedApi.fetchDownloadBlob).toHaveBeenNthCalledWith(2, "notes.txt", "token-alpha", expect.any(Object));
    expect(mockedApi.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "davora-home-download.zip");
    expect(await screen.findByText(/Downloaded 1 file and 1 folder as davora-home-download.zip in Batch download workspace\./i)).toBeInTheDocument();
  });

  it("keeps single-item details download on the existing direct file path", async () => {
    const account = buildAccount("alpha", { displayName: "Single download workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Show details for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Download$/i }));

    await waitFor(() => expect(mockedApi.downloadFile).toHaveBeenCalledWith("Projects/roadmap.txt", "token-alpha", expect.any(Object)));
    expect(mockedApi.fetchDownloadBlob).not.toHaveBeenCalled();
    expect(mockedApi.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it("disables batch-download checkboxes when downloads are unavailable", async () => {
    const account = buildAccount("alpha", { displayName: "Read only cached workspace" });
    seedAccounts([{ account }], account.id);
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    mockedCache.readFolderCacheEnvelope.mockReturnValue({
      cachedAt: "2026-05-21T10:00:00.000Z",
      value: [{ path: "Projects", name: "Projects", isFolder: true }]
    });

    render(<App />);

    const checkbox = await screen.findByLabelText(/Select Projects folder for batch download/i);
    expect(checkbox).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Show details for Projects/i }));
    expect(screen.getByRole("button", { name: /Add to batch download/i })).toBeDisabled();
  });

  it("keeps an offline cached shell usable while the live session is unavailable", async () => {
    const account = buildAccount("alpha", { displayName: "Offline shell workspace" });
    seedAccounts([{ account }], account.id);
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    mockedCache.readFolderCacheEnvelope.mockReturnValue({
      cachedAt: "2026-05-21T10:00:00.000Z",
      value: [{ path: "Projects", name: "Projects", isFolder: true }]
    });

    render(<App />);

    expect(await screen.findByText(/Offline cache only for Offline shell workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Reconnect Offline shell workspace/i })).not.toBeInTheDocument();
  });

  it("keeps an offline cached shell usable even when browser state is reconnect_required", async () => {
    const account = buildAccount("alpha", {
      displayName: "Offline reconnect workspace",
      connectionState: "reconnect_required"
    });
    seedAccounts([
      {
        account,
        pendingReconnect: { baseUrl: account.baseUrl, username: account.username, label: account.label }
      }
    ], account.id);
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    mockedCache.readFolderCacheEnvelope.mockReturnValue({
      cachedAt: "2026-05-21T10:00:00.000Z",
      value: [{ path: "Projects", name: "Projects", isFolder: true }]
    });

    render(<App />);

    expect(await screen.findByText(/Offline cache only for Offline reconnect workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Reconnect Offline reconnect workspace/i })).not.toBeInTheDocument();
  });

  it("keeps a cached shell usable when the local worker is unreachable while the browser stays online", async () => {
    vi.useFakeTimers();

    try {
      const account = buildAccount("alpha", { displayName: "Stopped server workspace" });
      seedAccounts([{ account }], account.id);
      mockedApi.getHealth.mockRejectedValue(new TypeError("fetch failed"));
      mockedApi.createSession.mockRejectedValue(new TypeError("fetch failed"));
      mockedCache.readFolderCacheEnvelope.mockImplementation((cacheNamespace, path) => {
        if (cacheNamespace === account.cacheNamespace && path === "") {
          return {
            cachedAt: "2026-05-21T10:00:00.000Z",
            value: [{ path: "Projects", name: "Projects", isFolder: true }]
          };
        }

        return undefined;
      });

      render(<App />);
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByText(/Cached shell only for Stopped server workspace/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument();
      expect(screen.getByText(/Showing cached data while the local server is unavailable/i)).toBeInTheDocument();
      expect(screen.getAllByText("Server unavailable")).toHaveLength(2);
      expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled();
      expect(screen.queryByRole("button", { name: /Retry restore/i })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens account management from the main workspace and can switch accounts", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace", label: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);

    mockedOpenedFileCache.getOpenedFileCacheSummary.mockResolvedValue({ itemCount: 1, totalBytes: 1536, limitBytes: openedFileCache.DEFAULT_OPENED_FILE_CACHE_LIMIT });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));

    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByText(/The main shell stays focused on files/i)).toBeInTheDocument();
    fireEvent.change(within(settingsDialog).getByLabelText(/Active account/i), { target: { value: beta.id } });

    await waitFor(() => expect(within(settingsDialog).getByLabelText(/Active account/i)).toHaveValue(beta.id));
  });

  it("uses account-scoped stale folder cache when offline", async () => {
    const account = buildAccount("alpha", { displayName: "Offline workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    mockedCache.readFolderCacheEnvelope.mockReturnValue({
      cachedAt: "2026-05-21T10:00:00.000Z",
      value: [{ path: "Projects", name: "Projects", isFolder: true }]
    });
    mockedApi.listFiles.mockRejectedValueOnce(new Error("offline"));

    render(<App />);

    expect(await screen.findByText(/Showing cached data while offline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled();
  });

  it("shows unlock guidance when APP_UNLOCK_CODE is required", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    seedAccounts([{ account }], account.id);
    mockedApi.getHealth.mockResolvedValue({ ...healthResponse, unlockRequired: true });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Unlock required/i })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: /Unlock and connect/i }).closest("form")!);
    expect(await screen.findByText(/Enter the deployment unlock code/i)).toBeInTheDocument();
  });

  it("keeps the mobile shell header minimal while moving account status into profile and settings", async () => {
    const account = buildAccount("alpha", { displayName: "Mobile shell workspace", label: "Mobile shell workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    matchMediaMatches = true;

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    expect(screen.queryAllByLabelText(/Active account/i)).toHaveLength(0);
    expect(document.querySelector(".app-bar .badge")).toBeNull();
    expect(document.querySelector(".app-bar .app-bar-subtitle")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));

    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByLabelText(/Active account/i)).toHaveValue(account.id);
    expect(within(settingsDialog).getByText("Workspace status")).toBeInTheDocument();
    expect(within(settingsDialog).getByText("Online")).toBeInTheDocument();
  });

  it("shows an image preview fallback instead of a broken browser image affordance", async () => {
    const account = buildAccount("alpha", { displayName: "Image preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.png",
        name: "photo.png",
        mimeType: "image/png",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob(["not-a-real-png"], { type: "image/png" }),
      mimeType: "image/png",
      filename: "photo.png"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    const image = await within(previewDialog).findByAltText("photo.png");
    fireEvent.error(image);

    await waitFor(() => expect(within(previewDialog).getByText(/Image preview is unavailable right now/i)).toBeInTheDocument());
    expect(within(previewDialog).queryByAltText("photo.png")).not.toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Open original in new tab/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download file/i })).toBeInTheDocument();
  });

  it("shows file sizes from the main workspace control and keeps settings free of the duplicate control", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    expect(screen.getByText("70 B")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/File size display in file list/i), { target: { value: "kb" } });

    await waitFor(() => expect(screen.getByText(/File sizes now use KB/i)).toBeInTheDocument());
    expect(screen.getAllByText(formatFileSize(70, "kb")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).queryByLabelText(/^File size display$/i)).not.toBeInTheDocument();
    expect(within(settingsDialog).getByText(/Current mode for cache-related sizes: KB/i)).toBeInTheDocument();
  });

  it("lets cache controls use slider/manual inputs and removes the cache preset dropdown", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedOpenedFileCache.getOpenedFileCacheSummary.mockResolvedValue({ itemCount: 1, totalBytes: 1536, limitBytes: 24 * 1024 * 1024 });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));

    const slider = await screen.findByLabelText(/Opened-file cache limit slider/i);
    expect(screen.queryByLabelText(/Opened-file cache limit presets/i)).not.toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "512" } });
    await waitFor(() => expect(mockedOpenedFileCache.configureOpenedFileCache).toHaveBeenCalledWith("ns-alpha", 512 * 1024 * 1024));

    const manualInput = screen.getByLabelText(/Opened-file cache limit in MB/i);
    fireEvent.change(manualInput, { target: { value: "2048" } });
    fireEvent.keyDown(manualInput, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(mockedOpenedFileCache.configureOpenedFileCache).toHaveBeenCalledWith("ns-alpha", 2048 * 1024 * 1024));

    const maxCacheableSlider = screen.getByLabelText(/Max file size eligible for browser cache slider/i);
    fireEvent.change(maxCacheableSlider, { target: { value: "32" } });
    await waitFor(() => expect(screen.getByText(/Files up to 32 MB stay eligible for browser blob caching/i)).toBeInTheDocument());
  });

  it("uses breadcrumb home navigation without redundant all-files or up-level buttons", async () => {
    const account = buildAccount("alpha", { displayName: "Navigation workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open folder Projects/i }));

    const breadcrumbs = await screen.findByRole("navigation", { name: /Breadcrumbs/i });
    expect(within(breadcrumbs).getByRole("button", { name: /Go to home folder/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go to all files/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go up one folder level/i })).not.toBeInTheDocument();
    expect(within(breadcrumbs).getAllByText("/").length).toBeGreaterThan(0);
  });

  it("accepts drag-and-drop upload in the folder view", async () => {
    const account = buildAccount("alpha", { displayName: "Drop workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    const dropZone = document.querySelector(".file-list-panel") as HTMLElement;
    const file = new File(["dropped"], "dropped.txt", { type: "text/plain" });

    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [file], types: ["Files"] } });
    expect(dropZone.className).toContain("file-list-panel-drop-active");
    fireEvent.drop(dropZone, { dataTransfer: { files: [file], types: ["Files"] } });

    await waitFor(() => expect(mockedApi.uploadFileWithProgress).toHaveBeenCalledWith(expect.objectContaining({ name: "dropped.txt", path: "" }), "token-alpha", expect.any(Function)));
    expect(await screen.findByText(/Uploaded 1 file into \/ via drag and drop/i)).toBeInTheDocument();
  });

  it("adds gallery next controls for photos and ignores oversized blobs for browser cache storage", async () => {
    const account = buildAccount("alpha", { displayName: "Gallery workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 20 * 1024 * 1024
      }
    }));
    mockedApi.fetchOriginalFile.mockImplementation(async (path: string) => ({
      blob: path.endsWith(".png")
        ? new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
        : new Blob([new Uint8Array(20 * 1024 * 1024)], { type: "audio/mpeg" }),
      mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
      filename: path.split("/").pop() ?? path
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    expect(within(previewDialog).getByRole("button", { name: /Next media item/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await waitFor(() => expect(screen.getByRole("dialog", { name: /Preview song.mp3/i })).toBeInTheDocument());
    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({ path: "Projects/song.mp3", maxBlobBytes: 15 * 1024 * 1024 })));
  });

  it("navigates from audio preview back to the previous media item", async () => {
    const account = buildAccount("alpha", { displayName: "Gallery workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/photo.png", name: "photo.png", isFolder: false, size: 12, mimeType: "image/png" },
        { path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
        viewer: path.endsWith(".png") ? "image" : "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".png") ? 12 : 18
      }
    }));
    mockedApi.fetchOriginalFile.mockImplementation(async (path: string) => ({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: path.endsWith(".png") ? "image/png" : "audio/mpeg" }),
      mimeType: path.endsWith(".png") ? "image/png" : "audio/mpeg",
      filename: path.split("/").pop() ?? path
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file song.mp3/i }));
    const audioPreview = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    fireEvent.click(within(audioPreview).getByRole("button", { name: /Previous media item/i }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: /Preview photo.png/i })).toBeInTheDocument());
  });

  it("restores the last known audio position when reopening the same file for the same account", async () => {
    const account = buildAccount("alpha", { displayName: "Audio resume workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Projects/song.mp3",
        name: "song.mp3",
        mimeType: "audio/mpeg",
        viewer: "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: 18
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
      mimeType: "audio/mpeg",
      filename: "song.mp3"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file song.mp3/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const firstAudio = previewDialog.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(firstAudio, "currentTime", { configurable: true, writable: true, value: 37.25 });
    Object.defineProperty(firstAudio, "duration", { configurable: true, writable: true, value: 180 });
    fireEvent.timeUpdate(firstAudio);
    fireEvent.pause(firstAudio);

    fireEvent.click(within(previewDialog).getByRole("button", { name: /Back to files/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview song.mp3/i })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Open file song.mp3/i }));
    const reopenedPreview = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const reopenedAudio = reopenedPreview.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(reopenedAudio, "currentTime", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(reopenedAudio, "duration", { configurable: true, writable: true, value: 180 });

    fireEvent(reopenedAudio, new Event("loadedmetadata"));

    expect(reopenedAudio.currentTime).toBeCloseTo(37.25);
  });

  it("clears an unusable near-end audio resume position instead of pretending resume is available", async () => {
    const account = buildAccount("alpha", { displayName: "Audio resume workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    localStorage.setItem("davora-audio-preview-position:alpha:Projects/song.mp3", "179.5");
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 18, mimeType: "audio/mpeg" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Projects/song.mp3",
        name: "song.mp3",
        mimeType: "audio/mpeg",
        viewer: "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: 18
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
      mimeType: "audio/mpeg",
      filename: "song.mp3"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file song.mp3/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const audio = previewDialog.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, writable: true, value: 180 });

    fireEvent(audio, new Event("loadedmetadata"));

    expect(audio.currentTime).toBe(0);
    expect(localStorage.getItem("davora-audio-preview-position:alpha:Projects/song.mp3")).toBeNull();
  });

  it("removes the persistent Davora app name from connected in-app chrome", async () => {
    const account = buildAccount("alpha", { displayName: "Chrome cleanup workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    const appBar = document.querySelector(".app-bar") as HTMLElement;
    expect(within(appBar).queryByRole("heading", { name: /^Davora$/i })).toBeNull();
    expect(within(appBar).getByRole("button", { name: /Profile & settings/i })).toBeInTheDocument();
    expect(within(appBar).getByLabelText(/Transfers/i)).toBeInTheDocument();
  });

  it("closes settings and action dialogs when clicking outside", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(settingsDialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Create folder/i }));
    const createDialog = await screen.findByRole("dialog", { name: /Create folder/i });
    fireEvent.click(createDialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Create folder/i })).not.toBeInTheDocument());
  });

  it("opens video preview with muted autoplay-compatible attributes", async () => {
    const account = buildAccount("alpha", { displayName: "Video workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Projects/clip.mp4",
        name: "clip.mp4",
        mimeType: "video/mp4",
        viewer: "video",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({
      blob: new Blob([new Uint8Array([0, 0, 0, 24])], { type: "video/mp4" }),
      mimeType: "video/mp4",
      filename: "clip.mp4"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file clip.mp4/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview clip.mp4/i });
    const video = within(previewDialog).getByLabelText(/Video preview clip.mp4/i) as HTMLVideoElement;
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
  });

  it("keeps cached preview visible until the user applies the refreshed version", async () => {
    const account = buildAccount("alpha", { displayName: "Preview cache workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    const previewRefresh = createDeferred<{ file: FilePreview }>();
    mockedOpenedFileCache.getCachedOpenedFile.mockResolvedValue({
      entry: {
        path: textPreview.path,
        preview: { ...textPreview, content: "cached preview" },
        mimeType: "text/plain",
        filename: "roadmap.txt",
        blobSize: 22,
        cachedAt: "2026-05-21T10:00:00.000Z",
        lastAccessedAt: "2026-05-21T10:00:00.000Z"
      },
      blob: new Blob(["cached preview"], { type: "text/plain" })
    });
    mockedApi.getFile.mockImplementationOnce(async () => previewRefresh.promise);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview roadmap.txt/i });
    await waitFor(() => expect(within(previewDialog).getByText("cached preview")).toBeInTheDocument());
    expect(within(previewDialog).getByText(/Showing cached preview/i)).toBeInTheDocument();

    previewRefresh.resolve({ file: { ...textPreview, content: "fresh preview" } });

    await waitFor(() => expect(within(previewDialog).getByRole("button", { name: /Apply refreshed version/i })).toBeInTheDocument());
    fireEvent.click(within(previewDialog).getByRole("button", { name: /Apply refreshed version/i }));
    await waitFor(() => expect(within(previewDialog).getByText("fresh preview")).toBeInTheDocument());
    expect(within(previewDialog).queryByText("cached preview")).not.toBeInTheDocument();
  });


  it("keeps install affordance out of the first-run zero state", async () => {
    const prompt = vi.fn(async () => undefined);
    const userChoice = Promise.resolve({ outcome: "dismissed" as const });

    render(<App />);
    await screen.findByRole("heading", { name: /No connected accounts yet/i });

    const installEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof userChoice;
      preventDefault: () => void;
    };
    installEvent.preventDefault = vi.fn();
    installEvent.prompt = prompt;
    installEvent.userChoice = userChoice;
    window.dispatchEvent(installEvent);

    await waitFor(() => expect(screen.queryByRole("button", { name: /Install app/i })).not.toBeInTheDocument());
  });

  it("hides a dismissed install affordance until a new browser install event arrives", async () => {
    const account = buildAccount("alpha", { displayName: "Install workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const prompt = vi.fn(async () => undefined);
    const firstChoice = Promise.resolve({ outcome: "dismissed" as const });

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });

    const firstEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof firstChoice;
      preventDefault: () => void;
    };
    firstEvent.preventDefault = vi.fn();
    firstEvent.prompt = prompt;
    firstEvent.userChoice = firstChoice;
    window.dispatchEvent(firstEvent);

    const firstInstallButton = await screen.findByRole("button", { name: /Install app/i });
    fireEvent.click(firstInstallButton);
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Install app/i })).not.toBeInTheDocument());

    const secondChoice = Promise.resolve({ outcome: "accepted" as const });
    const secondEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof secondChoice;
      preventDefault: () => void;
    };
    secondEvent.preventDefault = vi.fn();
    secondEvent.prompt = prompt;
    secondEvent.userChoice = secondChoice;
    window.dispatchEvent(secondEvent);

    expect(await screen.findByRole("button", { name: /Install app/i })).toBeInTheDocument();
  });

  it("shows a contextual install action only after the workspace is ready", async () => {
    const account = buildAccount("alpha", { displayName: "Install workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const prompt = vi.fn(async () => undefined);
    const userChoice = Promise.resolve({ outcome: "accepted" as const });

    registerSwMock.mockReturnValue({
      offlineReady: [false, vi.fn()],
      needRefresh: [false, vi.fn()],
      updateServiceWorker: vi.fn(async () => undefined)
    });

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });

    const installEvent = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: typeof userChoice;
      preventDefault: () => void;
    };
    installEvent.preventDefault = vi.fn();
    installEvent.prompt = prompt;
    installEvent.userChoice = userChoice;

    window.dispatchEvent(installEvent);

    const installButton = await screen.findByRole("button", { name: /Install app/i });
    fireEvent.click(installButton);

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: /Install app/i })).not.toBeInTheDocument());
    expect(screen.queryByText(/Davora installed successfully/i)).not.toBeInTheDocument();
  });

  it("shows the current app build label in profile and settings", async () => {
    const account = buildAccount("alpha", { displayName: "Build label workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByTestId("app-build-label")).toHaveTextContent("1.0.0");
  });

  it("uses a clearer update prompt message and reload action state", async () => {
    const account = buildAccount("alpha", { displayName: "Update workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const updateServiceWorker = vi.fn(async () => undefined);
    registerSwMock.mockReturnValue({
      offlineReady: [false, vi.fn()],
      needRefresh: [true, vi.fn()],
      updateServiceWorker
    });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    expect(screen.getByText(/Updated app shell ready\. Reload to apply it now\./i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Reload$/i }));
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalled());
  });

  it("clears offline-ready state without showing a global toast", async () => {
    const account = buildAccount("alpha", { displayName: "Offline-ready workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const setOfflineReady = vi.fn();

    registerSwMock.mockReturnValue({
      offlineReady: [true, setOfflineReady],
      needRefresh: [false, vi.fn()],
      updateServiceWorker: vi.fn(async () => undefined)
    });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    expect(setOfflineReady).toHaveBeenCalledWith(false);
    expect(screen.queryByText(/App ready to work offline/i)).not.toBeInTheDocument();
  });
});
