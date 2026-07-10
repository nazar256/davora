import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount, FilePreview, HealthResponse } from "@davora/shared";

import App from "./App";
import { ApiRequestError } from "./lib/api";
import * as api from "./lib/api";
import * as cache from "./lib/cache";
import { formatFileSize } from "./lib/fileSize";
import * as heicPreview from "./lib/heicPreview";
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
vi.mock("./lib/heicPreview", async () => {
  const actual = await vi.importActual<typeof import("./lib/heicPreview")>("./lib/heicPreview");
  return {
    ...actual,
    decodeHeicPreview: vi.fn()
  };
});

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
    createStreamingFileUrl: vi.fn(async (path: string) => `/api/file/stream?path=${encodeURIComponent(path)}&streamToken=stream-token-alpha`),
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
  clearFolderCacheForPath: vi.fn(),
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
    listOfflineFileCacheEntries: vi.fn(async () => []),
    removeOfflineRoot: vi.fn(),
    getOpenedFileCacheSummary: vi.fn(async () => ({ itemCount: 1, totalBytes: 128, limitBytes: actual.DEFAULT_OPENED_FILE_CACHE_LIMIT }))
  };
});

const mockedApi = vi.mocked(api);
const mockedCache = vi.mocked(cache);
const mockedHeicPreview = vi.mocked(heicPreview);
const mockedOpenedFileCache = vi.mocked(openedFileCache);

const createObjectUrlMock = vi.fn(() => "blob:preview");
const revokeObjectUrlMock = vi.fn();
const windowOpenMock = vi.fn(() => ({ closed: false } as Window));
const addMediaListenerMock = vi.fn();
const removeMediaListenerMock = vi.fn();
const mediaPlayMock = vi.fn<() => Promise<void>>(async () => undefined);
const mediaPauseMock = vi.fn<() => void>(() => undefined);
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
  Object.defineProperty(HTMLMediaElement.prototype, "play", { value: mediaPlayMock, configurable: true, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { value: mediaPauseMock, configurable: true, writable: true });
  window.history.replaceState(null, "", "/");

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
  mockedHeicPreview.decodeHeicPreview.mockResolvedValue({
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    width: 1200,
    height: 900,
    mimeType: "image/jpeg"
  });
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
  mockedOpenedFileCache.listOfflineFileCacheEntries.mockResolvedValue([]);
});

function dispatchAppBack(path = "") {
  window.dispatchEvent(new PopStateEvent("popstate", { state: { davora: true, path } }));
}

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

  it("preserves backend relevance order for active search results", async () => {
    const account = buildAccount("alpha", { displayName: "Search workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.searchFiles.mockResolvedValueOnce({
      query: "plan",
      path: "",
      items: [
        { path: "Projects/zeta.txt", name: "zeta.txt", isFolder: false, size: 90, mimeType: "text/plain", score: 99 },
        { path: "Projects/Archive", name: "Archive", isFolder: true, score: 80 },
        { path: "Projects/alpha.txt", name: "alpha.txt", isFolder: false, size: 70, mimeType: "text/plain", score: 70 }
      ]
    });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.change(screen.getByLabelText(/Search files/i), { target: { value: "plan" } });

    await screen.findByRole("button", { name: /Open file zeta.txt/i });
    const resultButtons = screen.getAllByRole("button", { name: /Open (file|folder)/i }).map((button) => button.getAttribute("aria-label"));
    expect(resultButtons).toEqual([
      "Open file zeta.txt",
      "Open folder Archive",
      "Open file alpha.txt"
    ]);
  });

  it("maps browser back from a nested folder to the previous app folder", async () => {
    const account = buildAccount("alpha", { displayName: "Back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    expect(await screen.findByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    expect(await screen.findByRole("heading", { name: /Home/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument();
  });

  it("maps browser back to close preview before leaving the folder", async () => {
    const account = buildAccount("alpha", { displayName: "Preview back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));
    expect(await screen.findByRole("dialog", { name: /Preview roadmap.txt/i })).toBeInTheDocument();

    act(() => dispatchAppBack("Projects"));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview roadmap.txt/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();
  });

  it("maps browser back to close settings and mobile search surfaces first", async () => {
    const account = buildAccount("alpha", { displayName: "Surface back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    expect(await screen.findByRole("dialog", { name: /Profile and settings/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument());

    cleanup();
    matchMediaMatches = true;
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    render(<App />);
    await screen.findByRole("button", { name: /Open search/i });
    fireEvent.click(screen.getByRole("button", { name: /Open search/i }));
    expect(screen.getByRole("button", { name: /Close search/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(screen.queryByRole("button", { name: /Close search/i })).not.toBeInTheDocument());
  });

  it("maps browser back to close the mobile selected-file action sheet", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Action sheet back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    expect(await screen.findByRole("region", { name: /Details for Projects/i })).toBeInTheDocument();

    act(() => dispatchAppBack(""));

    await waitFor(() => expect(document.querySelector(".details-panel")).toHaveAttribute("data-mobile-hidden", "true"));
    expect(document.querySelector(".details-panel")).not.toHaveClass("details-panel-sheet-open");
  });

  it("uses a clear mobile actions and details sheet flow", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Action details workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));

    const panel = await screen.findByRole("region", { name: /Details for Projects/i });
    expect(panel).toHaveClass("details-panel-sheet-open");
    expect(panel).not.toHaveClass("details-panel-sheet-details-open");
    expect(screen.getByRole("button", { name: /Dismiss item actions/i })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /View details/i })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /View details/i }));

    expect(panel).toHaveClass("details-panel-sheet-details-open");
    expect(within(panel).getByRole("button", { name: /Back to actions/i })).toBeInTheDocument();
    expect(within(panel).getByText("Location")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /Back to actions/i }));

    expect(panel).not.toHaveClass("details-panel-sheet-details-open");

    fireEvent.click(screen.getByRole("button", { name: /Dismiss item actions/i }));

    await waitFor(() => expect(document.querySelector(".details-panel")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Dismiss item actions/i })).not.toBeInTheDocument();
  });

  it("confirms single-item delete without asking the user to type the target name", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Delete confirmation workspace" });
    const targetName = "Документи-and-a-very-long-delete-target-name-100%.txt";
    const targetPath = `Projects/${targetName}`;
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: targetPath, name: targetName, isFolder: false, size: 70, mimeType: "text/plain" }]
    });
    mockedApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "Projects", path: targetPath } });

    render(<App />);

    await screen.findByRole("button", { name: `Open actions for ${targetName}` });
    fireEvent.click(screen.getByRole("button", { name: `Open actions for ${targetName}` }));
    fireEvent.click(within(await screen.findByRole("region", { name: `Details for ${targetName}` })).getByRole("button", { name: /^Delete$/i }));

    const dialog = await screen.findByRole("dialog", { name: /Delete item/i });
    expect(within(dialog).getByText("This permanently deletes the selected item from the server.")).toBeInTheDocument();
    expect(within(dialog).getByText(targetPath)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Name to confirm/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Cancel", "Delete"]);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));

    await waitFor(() => expect(mockedApi.deleteFile).toHaveBeenCalledWith({ path: targetPath, confirmName: targetName }, "token-alpha"));
  });

  it("syncs current folder path to URL query params", async () => {
    const account = buildAccount("alpha", { displayName: "URL sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open file roadmap.txt/i });

    expect(window.location.search).toContain("path=Projects");
    expect(window.location.search).toContain("account=alpha");
  });

  it("groups folders above files and sorts within each group by the active sort mode", async () => {
    const account = buildAccount("alpha", { displayName: "Folder first workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "z-file.txt", name: "z-file.txt", isFolder: false, size: 2, mimeType: "text/plain" },
        { path: "Archive", name: "Archive", isFolder: true },
        { path: "a-file.txt", name: "a-file.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "Projects", name: "Projects", isFolder: true }
      ]
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Archive/i });
    const rowNames = Array.from(document.querySelectorAll(".item-name")).map((node) => node.textContent);
    // Default sort is name-asc, so folders and files are each sorted alphabetically
    expect(rowNames).toEqual(["Archive", "Projects", "a-file.txt", "z-file.txt"]);
  });

  it("restores nested folder path from URL query params on mount", async () => {
    const account = buildAccount("alpha", { displayName: "URL restore workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    window.history.replaceState(null, "", "?path=Projects&account=alpha");

    render(<App />);

    expect(await screen.findByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open folder Projects/i })).not.toBeInTheDocument();
  });

  it("reloads current folder on pull-to-refresh gesture", async () => {
    const account = buildAccount("alpha", { displayName: "Pull refresh workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const refresh = createDeferred<{ path: string; items: Array<{ path: string; name: string; isFolder: boolean; size?: number; mimeType?: string }> }>();
    let projectsLoadCount = 0;
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        projectsLoadCount += 1;
        if (projectsLoadCount === 2) {
          return refresh.promise;
        }
      }
      return path === "Projects"
        ? { path: "Projects", items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] }
        : { path: "", items: [{ path: "Projects", name: "Projects", isFolder: true }] };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open file roadmap.txt/i });

    const main = document.querySelector(".workspace-layout") as HTMLElement;
    fireEvent.touchStart(main, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(main, { touches: [{ clientY: 150 }] });
    expect(screen.getByRole("status")).toHaveTextContent("Release to refresh");
    fireEvent.touchEnd(main);

    await waitFor(() => expect(mockedApi.listFiles).toHaveBeenLastCalledWith("Projects", "token-alpha"));
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing...");
    refresh.resolve({ path: "Projects", items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }] });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("keeps reconnect local to upload when a transient upload request fails", async () => {
    const account = buildAccount("alpha", { displayName: "Upload workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.uploadFileWithProgress.mockRejectedValueOnce(new TypeError("fetch failed"));

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    const toolbar = document.querySelector(".folder-actions-inline") as HTMLElement;
    const input = within(toolbar).getByLabelText(/^Upload files$/i) as HTMLInputElement;
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
    const toolbar = document.querySelector(".folder-actions-inline") as HTMLElement;
    const input = within(toolbar).getByLabelText(/^Upload files$/i) as HTMLInputElement;
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
    const toolbar = document.querySelector(".folder-actions-inline") as HTMLElement;
    const input = within(toolbar).getByLabelText(/^Upload folder$/i) as HTMLInputElement;
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

  it("copies a file through the folder destination picker without typing a full path", async () => {
    const account = buildAccount("alpha", { displayName: "Picker copy workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/Документи 100%", name: "Документи 100%", isFolder: true },
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
          ]
        };
      }
      if (path === "Projects/Документи 100%") {
        return { path, items: [] };
      }
      return {
        path,
        items: [{ path: "Projects", name: "Projects", isFolder: true }]
      };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: "Open actions for roadmap.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Open actions for roadmap.txt" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));

    const dialog = await screen.findByRole("dialog", { name: /Copy or move item/i });
    const destinationForm = dialog.querySelector("form")!;
    expect(within(dialog).getByText("Projects/roadmap.txt")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Copy destination path/i)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Документи 100%/i }));
    await within(dialog).findByText("/Projects/Документи 100%");
    await waitFor(() => expect(within(dialog).getByLabelText("Destination name")).toHaveValue("roadmap.txt"));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Copy here/i })).not.toBeDisabled());
    fireEvent.submit(destinationForm);

    await waitFor(() => expect(mockedApi.copyFile).toHaveBeenCalledWith({
      path: "Projects/roadmap.txt",
      destinationPath: "Projects/Документи 100%/roadmap.txt"
    }, "token-alpha"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Copy or move item/i })).not.toBeInTheDocument());
  });

  it("moves a file through the folder destination picker with a separate destination name", async () => {
    const account = buildAccount("alpha", { displayName: "Picker move workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/Archive 100%", name: "Archive 100%", isFolder: true },
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" }
          ]
        };
      }
      if (path === "Projects/Archive 100%") {
        return { path, items: [] };
      }
      return {
        path,
        items: [{ path: "Projects", name: "Projects", isFolder: true }]
      };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: "Open actions for roadmap.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Open actions for roadmap.txt" }));
    fireEvent.click(screen.getByRole("button", { name: /Rename or move/i }));

    const dialog = await screen.findByRole("dialog", { name: /Move item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Open destination folder Archive 100%/i }));
    await within(dialog).findByText("/Projects/Archive 100%");
    fireEvent.change(within(dialog).getByLabelText("Destination name"), { target: { value: "roadmap final.txt" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Move here/i })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /Move here/i }));

    await waitFor(() => expect(mockedApi.moveFile).toHaveBeenCalledWith({
      path: "Projects/roadmap.txt",
      destinationPath: "Projects/Archive 100%/roadmap final.txt"
    }, "token-alpha"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Move item/i })).not.toBeInTheDocument());
  });

  it("blocks destination conflicts and folder self-descendant destinations in the picker", async () => {
    const account = buildAccount("alpha", { displayName: "Picker guard workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" },
            { path: "Projects/roadmap.txt-copy", name: "roadmap.txt-copy", isFolder: false, size: 70, mimeType: "text/plain" }
          ]
        };
      }
      return {
        path,
        items: [{ path: "Projects", name: "Projects", isFolder: true }]
      };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: "Open actions for roadmap.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Open actions for roadmap.txt" }));
    fireEvent.click(screen.getByRole("button", { name: /Copy or move/i }));

    const copyDialog = await screen.findByRole("dialog", { name: /Copy or move item/i });
    await waitFor(() => expect(within(copyDialog).getByLabelText("Destination name")).toHaveValue("roadmap (1).txt"));
    expect(within(copyDialog).queryByText(/already contains roadmap\.txt-copy/i)).not.toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).not.toBeDisabled();
    fireEvent.change(within(copyDialog).getByLabelText("Destination name"), { target: { value: "roadmap.txt" } });
    expect(await within(copyDialog).findByText(/Destination already contains roadmap\.txt\. Use roadmap \(1\)\.txt/i)).toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    fireEvent.change(within(copyDialog).getByLabelText("Destination name"), { target: { value: "bad\\name.txt" } });
    expect(await within(copyDialog).findByText(/Enter a valid destination name/i)).toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    fireEvent.change(within(copyDialog).getByLabelText("Destination name"), { target: { value: "folder/name.txt" } });
    expect(await within(copyDialog).findByText(/Destination name cannot contain slashes/i)).toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    fireEvent.click(within(copyDialog).getByRole("button", { name: /Manual path/i }));
    fireEvent.change(within(copyDialog).getByLabelText("Full destination path"), { target: { value: "Projects/foo%2Fbar.txt" } });
    expect(await within(copyDialog).findByText(/Enter a valid destination path/i)).toBeInTheDocument();
    expect(within(copyDialog).getByRole("button", { name: /Copy here/i })).toBeDisabled();
    fireEvent.click(within(copyDialog).getByRole("button", { name: /Manual path/i }));
    fireEvent.change(within(copyDialog).getByLabelText("Destination name"), { target: { value: "roadmap copied.txt" } });
    await waitFor(() => expect(within(copyDialog).queryByText(/already contains|valid destination|cannot contain/i)).not.toBeInTheDocument());
    fireEvent.click(within(copyDialog).getByRole("button", { name: /Cancel/i }));

    fireEvent.click(screen.getByRole("button", { name: /Go to home folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(screen.getByRole("button", { name: /Rename or move/i }));

    const moveDialog = await screen.findByRole("dialog", { name: /Move item/i });
    fireEvent.click(within(moveDialog).getByRole("button", { name: /Open destination folder Projects/i }));
    expect(await within(moveDialog).findByText(/Folders cannot be moved or copied into themselves or their descendants/i)).toBeInTheDocument();
    expect(within(moveDialog).getByRole("button", { name: /Move here/i })).toBeDisabled();
    expect(mockedApi.moveFile).not.toHaveBeenCalled();
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

  it("shows exact failed child paths and partial success in the transfer tray", async () => {
    const account = buildAccount("alpha", { displayName: "Partial batch workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Documents") {
        return {
          path,
          items: [
            { path: "Documents/good.txt", name: "good.txt", isFolder: false, size: 12, mimeType: "text/plain" },
            { path: "Documents/bad%file.txt", name: "bad%file.txt", isFolder: false, size: 8, mimeType: "text/plain" }
          ]
        };
      }

      return {
        path,
        items: [{ path: "Documents", name: "Documents", isFolder: true }]
      };
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => {
      if (path === "Documents/bad%file.txt") {
        throw new Error("Path contains invalid percent-encoding.");
      }

      return { blob: new Blob(["ok"], { type: "text/plain" }) };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByLabelText(/Select Documents folder for batch download/i));
    fireEvent.click(screen.getByRole("button", { name: /^Download selected$/i }));

    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedApi.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "documents.zip"));

    fireEvent.click(screen.getByRole("button", { name: /^Transfers$/i }));
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });

    expect(within(transferStatus).getByText("documents.zip")).toBeInTheDocument();
    expect(within(transferStatus).getByText("Partial")).toBeInTheDocument();
    expect(within(transferStatus).getByText(/Downloaded 1 of 2 files; 1 failed\./i)).toBeInTheDocument();
    expect(within(transferStatus).getByText("Documents/bad%file.txt")).toBeInTheDocument();
    expect(within(transferStatus).getByText("Path contains invalid percent-encoding.")).toBeInTheDocument();
    expect(within(transferStatus).queryByText("1 item selected")).not.toBeInTheDocument();
    expect(await screen.findByText(/Downloaded 1 folder as documents.zip in Partial batch workspace\. Downloaded 1 of 2 files; 1 failed\./i)).toBeInTheDocument();
  });

  it("keeps a single file offline only after storage confirmation", async () => {
    const account = buildAccount("alpha", { displayName: "Offline sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));

    const dialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByText(/Kept-offline files are excluded from normal automatic cache eviction/i)).toBeInTheDocument();
    expect(mockedOpenedFileCache.cacheOpenedFile).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledWith("Projects/roadmap.txt", "token-alpha", expect.any(Object)));
    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Projects/roadmap.txt",
      keepOffline: true,
      keepOfflineRoot: "Projects/roadmap.txt",
      keepOfflineRootKind: "file",
      maxBlobBytes: Number.POSITIVE_INFINITY
    })));
    expect(await screen.findByText(/Kept roadmap.txt offline on this device/i)).toBeInTheDocument();
  });

  it("starts keep-offline sync as a background transfer and closes the confirmation dialog", async () => {
    const account = buildAccount("alpha", { displayName: "Background sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const download = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.fetchDownloadBlob.mockReturnValue(download.promise);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));

    const dialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument());
    expect(await screen.findByText(/Started offline sync for roadmap.txt/i)).toBeInTheDocument();
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    expect(within(transferStatus).getByText("roadmap.txt")).toBeInTheDocument();
    expect(within(transferStatus).getByText(/Offline sync/i)).toBeInTheDocument();
    expect(mockedOpenedFileCache.cacheOpenedFile).not.toHaveBeenCalled();

    download.resolve({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Projects/roadmap.txt",
      keepOffline: true
    })));
  });

  it("maps browser back to close an automatically opened transfer tray without leaving the folder", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Transfer back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const download = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.fetchDownloadBlob.mockReturnValue(download.promise);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    expect(within(transferStatus).getByText("roadmap.txt")).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ davora: true, path: "Projects", surface: "transfers" });

    act(() => dispatchAppBack("Projects"));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Transfer status/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();
    expect(window.location.search).toContain("path=Projects");

    download.resolve({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });
    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Projects/roadmap.txt",
      keepOffline: true
    })));
  });

  it("does not enqueue a duplicate background offline sync for the same root", async () => {
    const account = buildAccount("alpha", { displayName: "Duplicate sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const download = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.fetchDownloadBlob.mockReturnValue(download.promise);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument());
    expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(screen.getByText(/Offline sync is already running for roadmap.txt/i)).toBeInTheDocument());
    expect(mockedApi.fetchDownloadBlob).toHaveBeenCalledTimes(1);

    download.resolve({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });
    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Projects/roadmap.txt",
      keepOffline: true
    })));
  });

  it("keeps a folder recursively offline and records cached folder contents", async () => {
    const account = buildAccount("alpha", { displayName: "Recursive offline workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 16, mimeType: "text/plain" },
            { path: "Projects/Nested", name: "Nested", isFolder: true }
          ]
        };
      }
      if (path === "Projects/Nested") {
        return {
          path,
          items: [{ path: "Projects/Nested/notes.txt", name: "notes.txt", isFolder: false, size: 8, mimeType: "text/plain" }]
        };
      }
      return { path, items: [{ path: "Projects", name: "Projects", isFolder: true }] };
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => ({ blob: new Blob([path], { type: "text/plain" }), filename: path.split("/").pop() }));

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));

    const dialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    expect(within(dialog).getByText(/Synced recursively/i)).toBeInTheDocument();
    expect(within(dialog).getByText("2")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Projects/Nested/notes.txt",
      keepOfflineRoot: "Projects",
      keepOfflineRootKind: "folder"
    })));
    expect(mockedCache.cacheFolder).toHaveBeenCalledWith("ns-alpha", "Projects", expect.any(Array));
    expect(mockedCache.cacheFolder).toHaveBeenCalledWith("ns-alpha", "Projects/Nested", expect.any(Array));
  });

  it("keeps a batch selection offline and removes offline copies from settings without server delete", async () => {
    const account = buildAccount("alpha", { displayName: "Batch offline workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Archive") {
        return {
          path,
          items: [{ path: "Archive/photo.png", name: "photo.png", isFolder: false, size: 4, mimeType: "image/png" }]
        };
      }
      return {
        path,
        items: [
          { path: "Archive", name: "Archive", isFolder: true },
          { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 12, mimeType: "text/plain" }
        ]
      };
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => ({ blob: new Blob([path], { type: path.endsWith(".png") ? "image/png" : "text/plain" }), filename: path.split("/").pop() }));
    mockedOpenedFileCache.listOfflineFileCacheEntries.mockResolvedValue([
      {
        path: "Archive/photo.png",
        preview: { ...textPreview, path: "Archive/photo.png", name: "photo.png" },
        mimeType: "image/png",
        filename: "photo.png",
        blobSize: 4,
        cachedAt: "2026-07-06T10:00:00.000Z",
        lastAccessedAt: "2026-07-06T10:00:00.000Z",
        keepOffline: true,
        keepOfflineRoot: "Archive",
        keepOfflineRootName: "Archive",
        keepOfflineRootKind: "folder",
        keepOfflineAddedAt: "2026-07-06T10:00:00.000Z"
      }
    ]);

    render(<App />);

    await screen.findByLabelText(/Select Archive folder for batch download/i);
    fireEvent.click(screen.getByLabelText(/Select Archive folder for batch download/i));
    fireEvent.click(screen.getByLabelText(/Select roadmap.txt file for batch download/i));
    fireEvent.click(screen.getAllByRole("button", { name: /^Keep offline$/i })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({ keepOfflineRootKind: "batch" })));

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByRole("button", { name: /Remove offline copy for Archive from this device/i })).toBeInTheDocument();
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /Remove offline copy for Archive from this device/i }));

    await waitFor(() => expect(mockedOpenedFileCache.removeOfflineRoot).toHaveBeenCalledWith("ns-alpha", "Archive"));
    expect(mockedCache.clearFolderCacheForPath).toHaveBeenCalledWith("ns-alpha", "Archive");
    expect(mockedApi.deleteFile).not.toHaveBeenCalled();
  });

  it("allows failed offline sync files to be retried from the transfer tray", async () => {
    const account = buildAccount("alpha", { displayName: "Retry offline workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.fetchDownloadBlob
      .mockRejectedValueOnce(new Error("Temporary sync failure."))
      .mockResolvedValueOnce({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByLabelText(/Select roadmap.txt file for batch download/i));
    fireEvent.click(screen.getAllByRole("button", { name: /^Keep offline$/i })[0]!);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    expect(await screen.findByText(/Synced 0 of 1 files for offline use in Retry offline workspace/i)).toBeInTheDocument();
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    fireEvent.click(within(transferStatus).getByRole("button", { name: /Retry failed sync/i }));

    const retryDialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    fireEvent.click(within(retryDialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Projects/roadmap.txt",
      keepOffline: true
    })));
  });

  it("retries failed recursive offline sync from the original folder root", async () => {
    const account = buildAccount("alpha", { displayName: "Retry folder sync workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    let badPathAttempts = 0;
    mockedApi.listFiles.mockImplementation(async (path: string) => {
      if (path === "Projects") {
        return {
          path,
          items: [
            { path: "Projects/bad.pdf", name: "bad.pdf", isFolder: false, size: 10, mimeType: "application/pdf" },
            { path: "Projects/good.txt", name: "good.txt", isFolder: false, size: 10, mimeType: "text/plain" }
          ]
        };
      }
      return {
        path,
        items: [{ path: "Projects", name: "Projects", isFolder: true }]
      };
    });
    mockedApi.fetchDownloadBlob.mockImplementation(async (path: string) => {
      if (path === "Projects/bad.pdf") {
        badPathAttempts += 1;
        if (badPathAttempts === 1) {
          throw new Error("Temporary sync failure.");
        }
      }
      return { blob: new Blob([path], { type: "text/plain" }), filename: path.split("/").pop() };
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    expect(await screen.findByText(/Synced 1 of 2 files for offline use in Retry folder sync workspace/i)).toBeInTheDocument();
    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    expect(within(transferStatus).getByText("Projects/bad.pdf")).toBeInTheDocument();
    fireEvent.click(within(transferStatus).getByRole("button", { name: /Retry failed sync/i }));

    const retryDialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    await waitFor(() => expect(within(retryDialog).getByText("Projects")).toBeInTheDocument());
    expect(within(retryDialog).getByText(/Synced recursively/i)).toBeInTheDocument();
    expect(within(retryDialog).getByText("2")).toBeInTheDocument();
    expect(within(retryDialog).queryByText("bad.pdf")).not.toBeInTheDocument();

    fireEvent.click(within(retryDialog).getByRole("button", { name: /Start sync/i }));

    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Projects/bad.pdf",
      keepOffline: true,
      keepOfflineRoot: "Projects",
      keepOfflineRootKind: "folder"
    })));
  });

  it("clears normal cache without removing explicitly kept-offline copies", async () => {
    const account = buildAccount("alpha", { displayName: "Clear cache workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.fetchDownloadBlob.mockResolvedValue({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    mockedOpenedFileCache.listOfflineFileCacheEntries.mockResolvedValue([
      {
        path: "Projects/roadmap.txt",
        preview: { ...textPreview, path: "Projects/roadmap.txt", name: "roadmap.txt" },
        mimeType: "text/plain",
        filename: "roadmap.txt",
        blobSize: 16,
        cachedAt: "2026-07-06T10:00:00.000Z",
        lastAccessedAt: "2026-07-06T10:00:00.000Z",
        keepOffline: true,
        keepOfflineRoot: "Projects/roadmap.txt",
        keepOfflineRootName: "roadmap.txt",
        keepOfflineRootKind: "file",
        keepOfflineAddedAt: "2026-07-06T10:00:00.000Z"
      }
    ]);
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Projects/roadmap.txt",
      keepOffline: true
    })));
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    await within(settingsDialog).findByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /Clear cache/i }));

    await waitFor(() => expect(mockedOpenedFileCache.clearOpenedFileCache).toHaveBeenCalledWith("ns-alpha"));
    expect(mockedCache.clearFolderAndSearchCache).toHaveBeenCalledWith("ns-alpha", { preserveFolderPaths: ["Projects"] });
    expect(mockedOpenedFileCache.removeOfflineRoot).not.toHaveBeenCalled();
    expect(within(settingsDialog).getByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i })).toBeInTheDocument();
  });

  it("shows kept-offline items separately from the normal cache summary", async () => {
    const account = buildAccount("alpha", { displayName: "Offline accounting workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedOpenedFileCache.getOpenedFileCacheSummary.mockResolvedValue({ itemCount: 0, totalBytes: 0, limitBytes: openedFileCache.DEFAULT_OPENED_FILE_CACHE_LIMIT });
    mockedOpenedFileCache.listOfflineFileCacheEntries.mockResolvedValue([
      {
        path: "Projects/roadmap.txt",
        preview: { ...textPreview, path: "Projects/roadmap.txt", name: "roadmap.txt" },
        mimeType: "text/plain",
        filename: "roadmap.txt",
        blobSize: 16,
        cachedAt: "2026-07-06T10:00:00.000Z",
        lastAccessedAt: "2026-07-06T10:00:00.000Z",
        keepOffline: true,
        keepOfflineRoot: "Projects/roadmap.txt",
        keepOfflineRootName: "roadmap.txt",
        keepOfflineRootKind: "file",
        keepOfflineAddedAt: "2026-07-06T10:00:00.000Z"
      }
    ]);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    await waitFor(() => expect(mockedOpenedFileCache.listOfflineFileCacheEntries).toHaveBeenCalledWith("ns-alpha"));
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });

    expect(within(settingsDialog).getByText((_, element) => element?.textContent === "0 cached files • 0 B used")).toBeInTheDocument();
    expect(await within(settingsDialog).findByText("roadmap.txt")).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i })).toBeInTheDocument();
  });

  it("keeps single-item details download on the existing direct file path", async () => {
    const account = buildAccount("alpha", { displayName: "Single download workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
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
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
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
      expect(screen.getByText("Server unavailable")).toBeInTheDocument();
      expect(screen.queryByLabelText("Workspace details")).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Open navigation menu/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Profile & settings/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const navigationMenu = await screen.findByRole("complementary", { name: /Navigation menu/i });
    expect(navigationMenu).toBeInTheDocument();
    expect(within(navigationMenu).getByLabelText(/Upload files from navigation menu/i)).toBeInTheDocument();
    expect(within(navigationMenu).getByLabelText(/Upload folder from navigation menu/i)).toBeInTheDocument();
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

  it("lets image previews switch between immersive fill and whole-image fit", async () => {
    const account = buildAccount("alpha", { displayName: "Image fit workspace" });
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
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      mimeType: "image/png",
      filename: "photo.png"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.png/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.png/i });
    const image = await within(previewDialog).findByAltText("photo.png");
    expect(image).toHaveClass("media-preview-image-fill");

    const fitButton = within(previewDialog).getByRole("button", { name: /Fit entire image/i });
    expect(fitButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(fitButton);

    expect(image).toHaveClass("media-preview-image-fit");
    expect(within(previewDialog).getByRole("button", { name: /Fill preview area/i })).toHaveAttribute("aria-pressed", "false");
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ imagePreviewFitMode: "fit" });

    const originalSizeButton = within(previewDialog).getByRole("button", { name: /Show image at original size/i });
    fireEvent.click(originalSizeButton);

    expect(image).toHaveClass("media-preview-image-zoomed");
    expect(originalSizeButton).toHaveAttribute("aria-pressed", "true");
    expect(within(previewDialog).getByRole("button", { name: /Fill preview area/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps experimental HEIC preview disabled by default and persists enabling it", async () => {
    const account = buildAccount("alpha", { displayName: "Settings workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));

    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const heicToggle = within(settingsDialog).getByLabelText(/Enable experimental HEIC preview/i);
    expect(heicToggle).not.toBeChecked();

    fireEvent.click(heicToggle);

    expect(heicToggle).toBeChecked();
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ experimentalHeicPreviewEnabled: true });
    expect(screen.getByText(/Experimental HEIC preview is enabled for this browser/i)).toBeInTheDocument();
  });

  it("shows HEIC fallback without downloading or decoding when the experiment is disabled", async () => {
    const account = buildAccount("alpha", { displayName: "HEIC fallback workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.heic", name: "photo.heic", isFolder: false, size: 12, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.heic",
        name: "photo.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.heic/i });
    expect(within(previewDialog).getByText(/HEIC preview is experimental and disabled/i)).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Open original in new tab/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download file/i })).toBeInTheDocument();
    expect(mockedApi.fetchOriginalFile).not.toHaveBeenCalled();
    expect(mockedHeicPreview.decodeHeicPreview).not.toHaveBeenCalled();
    expect(mockedApi.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it("decodes HEIC locally when the experiment is enabled and preserves original-file actions", async () => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ experimentalHeicPreviewEnabled: true }));
    const account = buildAccount("alpha", { displayName: "HEIC preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const heicBlob = new Blob(["heic"], { type: "image/heic" });
    const jpegBlob = new Blob(["jpeg"], { type: "image/jpeg" });
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.heic", name: "photo.heic", isFolder: false, size: 12, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.heic",
        name: "photo.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({ blob: heicBlob, mimeType: "image/heic", filename: "photo.heic" });
    mockedHeicPreview.decodeHeicPreview.mockResolvedValue({
      blob: jpegBlob,
      width: 1200,
      height: 900,
      mimeType: "image/jpeg"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.heic/i });
    const image = await within(previewDialog).findByAltText("photo.heic");
    expect(image).toHaveAttribute("src", "blob:preview");
    expect(mockedApi.fetchOriginalFile).toHaveBeenCalledWith("Archive/photo.heic", "token-alpha");
    expect(mockedHeicPreview.decodeHeicPreview).toHaveBeenCalledWith(heicBlob);
    expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({
      path: "Archive/photo.heic",
      blob: jpegBlob,
      mimeType: "image/jpeg",
      filename: "photo.heic.jpg"
    }));
    expect(within(previewDialog).getByRole("button", { name: /Open original in new tab/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download/i })).toBeInTheDocument();
  });

  it("ignores cached HEIC image previews after the experiment is disabled", async () => {
    const account = buildAccount("alpha", { displayName: "HEIC cache workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const cachedJpeg = new Blob(["cached-jpeg"], { type: "image/jpeg" });
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/photo.heic", name: "photo.heic", isFolder: false, size: 12, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/photo.heic",
        name: "photo.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        size: 12,
        requiresOriginalBlob: true
      }
    });
    mockedOpenedFileCache.getCachedOpenedFile.mockResolvedValue({
      blob: cachedJpeg,
      entry: {
        path: "Archive/photo.heic",
        preview: {
          ...textPreview,
          path: "Archive/photo.heic",
          name: "photo.heic",
          mimeType: "image/heic",
          viewer: "image",
          content: "",
          encoding: "none",
          bytesRead: 0,
          size: 12,
          requiresOriginalBlob: true
        },
        mimeType: "image/jpeg",
        filename: "photo.heic.jpg",
        blobSize: cachedJpeg.size,
        cachedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString()
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file photo.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview photo.heic/i });
    expect(await within(previewDialog).findByText(/HEIC preview is experimental and disabled/i)).toBeInTheDocument();
    expect(within(previewDialog).queryByAltText("photo.heic")).not.toBeInTheDocument();
    expect(mockedApi.fetchOriginalFile).not.toHaveBeenCalled();
    expect(mockedHeicPreview.decodeHeicPreview).not.toHaveBeenCalled();
  });

  it("falls back cleanly when experimental HEIC decode fails a guard or decoder error", async () => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ experimentalHeicPreviewEnabled: true }));
    const account = buildAccount("alpha", { displayName: "HEIC failure workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/huge.heic", name: "huge.heic", isFolder: false, size: 64 * 1024 * 1024, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/huge.heic",
        name: "huge.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        size: 64 * 1024 * 1024,
        requiresOriginalBlob: true
      }
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file huge.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview huge.heic/i });
    expect(await within(previewDialog).findByText(/HEIC preview is limited to files up to 25 MB/i)).toBeInTheDocument();
    expect(within(previewDialog).queryByAltText("huge.heic")).not.toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Open original in new tab/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download file/i })).toBeInTheDocument();
    expect(mockedApi.fetchOriginalFile).not.toHaveBeenCalled();
    expect(mockedHeicPreview.decodeHeicPreview).not.toHaveBeenCalled();
    expect(mockedOpenedFileCache.cacheOpenedFile).not.toHaveBeenCalledWith("ns-alpha", expect.objectContaining({ path: "Archive/huge.heic" }));
  });

  it("falls back cleanly when experimental HEIC decoding fails after fetching the original", async () => {
    localStorage.setItem("davora-ui-settings", JSON.stringify({ experimentalHeicPreviewEnabled: true }));
    const account = buildAccount("alpha", { displayName: "HEIC decode error workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const heicBlob = new Blob(["bad-heic"], { type: "image/heic" });
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Archive/bad.heic", name: "bad.heic", isFolder: false, size: 12, mimeType: "image/heic" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Archive/bad.heic",
        name: "bad.heic",
        mimeType: "image/heic",
        viewer: "image",
        content: "",
        encoding: "none",
        bytesRead: 0,
        size: 12,
        requiresOriginalBlob: true
      }
    });
    mockedApi.fetchOriginalFile.mockResolvedValue({ blob: heicBlob, mimeType: "image/heic", filename: "bad.heic" });
    mockedHeicPreview.decodeHeicPreview.mockRejectedValue(new Error("Decoder rejected this image."));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file bad.heic/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview bad.heic/i });
    expect(await within(previewDialog).findByText(/HEIC preview could not be decoded locally: Decoder rejected this image/i)).toBeInTheDocument();
    expect(within(previewDialog).queryByAltText("bad.heic")).not.toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Open original in new tab/i })).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Download file/i })).toBeInTheDocument();
    expect(mockedApi.fetchOriginalFile).toHaveBeenCalledWith("Archive/bad.heic", "token-alpha");
    expect(mockedHeicPreview.decodeHeicPreview).toHaveBeenCalledWith(heicBlob);
    expect(mockedOpenedFileCache.cacheOpenedFile).not.toHaveBeenCalledWith("ns-alpha", expect.objectContaining({ path: "Archive/bad.heic" }));
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

    const freshnessValue = screen.getByLabelText(/Cached preview update check interval value/i);
    fireEvent.change(freshnessValue, { target: { value: "5" } });
    fireEvent.keyDown(freshnessValue, { key: "Enter", code: "Enter" });
    const freshnessUnit = screen.getByLabelText(/Cached preview update check interval unit/i);
    fireEvent.change(freshnessUnit, { target: { value: "minutes" } });
    await waitFor(() => expect(screen.getByText(/Cached previews will be checked after 300 seconds/i)).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("davora-ui-settings") ?? "{}")).toMatchObject({ previewFreshnessIntervalSeconds: 300 });
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

  it("opens audio with a streaming URL before the full file is retained in the background", async () => {
    const account = buildAccount("alpha", { displayName: "Streaming workspace" });
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
    let releaseOriginalFetch!: () => void;
    const originalFetchStarted = vi.fn();
    mockedApi.fetchOriginalFile.mockImplementation(async () => {
      originalFetchStarted();
      await new Promise<void>((resolve) => {
        releaseOriginalFetch = resolve;
      });
      return {
        blob: new Blob([new Uint8Array([0, 1, 2, 3])], { type: "audio/mpeg" }),
        mimeType: "audio/mpeg",
        filename: "song.mp3"
      };
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file song.mp3/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
    const audio = previewDialog.querySelector("audio");
    expect(audio).toHaveAttribute("src", "/api/file/stream?path=Projects%2Fsong.mp3&streamToken=stream-token-alpha");
    expect(within(previewDialog).getByText(/Streaming now\. An offline cache copy continues saving/i)).toBeInTheDocument();
    expect(originalFetchStarted).toHaveBeenCalledTimes(1);
    expect(mockedOpenedFileCache.cacheOpenedFile).not.toHaveBeenCalledWith("ns-alpha", expect.objectContaining({ path: "Projects/song.mp3" }));

    releaseOriginalFetch();
    await waitFor(() => expect(mockedOpenedFileCache.cacheOpenedFile).toHaveBeenCalledWith("ns-alpha", expect.objectContaining({ path: "Projects/song.mp3", blob: expect.any(Blob) })));
  });

  it("autoplays audio and video previews and pauses the previous media when switching", async () => {
    const account = buildAccount("alpha", { displayName: "Autoplay workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" },
        { path: "Projects/clip.mp4", name: "clip.mp4", isFolder: false, size: 16, mimeType: "video/mp4" }
      ]
    });
    mockedApi.getFile.mockImplementation(async (path: string) => ({
      file: {
        ...textPreview,
        path,
        name: path.split("/").pop() ?? path,
        mimeType: path.endsWith(".m4a") ? "audio/mp4" : "video/mp4",
        viewer: path.endsWith(".m4a") ? "audio" : "video",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: path.endsWith(".m4a") ? 18 : 16
      }
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file chapter.m4a/i }));
    const audioPreview = await screen.findByRole("dialog", { name: /Preview chapter.m4a/i });
    const audio = audioPreview.querySelector("audio") as HTMLAudioElement;
    expect(audio.autoplay).toBe(true);
    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalledTimes(1));

    fireEvent.click(within(audioPreview).getByRole("button", { name: /Next media item/i }));
    const videoPreview = await screen.findByRole("dialog", { name: /Preview clip.mp4/i });
    const video = within(videoPreview).getByLabelText(/Video preview clip.mp4/i) as HTMLVideoElement;
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    await waitFor(() => expect(mediaPauseMock).toHaveBeenCalled());
    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalledTimes(2));

    mediaPauseMock.mockClear();
    fireEvent.click(within(videoPreview).getByRole("button", { name: /Back to files/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Preview clip.mp4/i })).not.toBeInTheDocument());
    await waitFor(() => expect(mediaPauseMock).toHaveBeenCalledTimes(1));
  });

  it("shows a clear play action when browser autoplay blocks media", async () => {
    const account = buildAccount("alpha", { displayName: "Blocked autoplay workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: "Projects/chapter.m4a", name: "chapter.m4a", isFolder: false, size: 18, mimeType: "audio/mp4" }]
    });
    mockedApi.getFile.mockResolvedValue({
      file: {
        ...textPreview,
        path: "Projects/chapter.m4a",
        name: "chapter.m4a",
        mimeType: "audio/mp4",
        viewer: "audio",
        content: "",
        encoding: "none",
        bytesRead: 0,
        requiresOriginalBlob: true,
        size: 18
      }
    });
    mediaPlayMock.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file chapter.m4a/i }));
    const previewDialog = await screen.findByRole("dialog", { name: /Preview chapter.m4a/i });
    expect(await within(previewDialog).findByText(/Autoplay was blocked by the browser/i)).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Play media/i })).toBeInTheDocument();

    mediaPlayMock.mockResolvedValueOnce(undefined);
    fireEvent.click(within(previewDialog).getByRole("button", { name: /Play media/i }));

    await waitFor(() => expect(mediaPlayMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(previewDialog).queryByText(/Autoplay was blocked by the browser/i)).not.toBeInTheDocument());
  });

  it("retries interrupted media streams with bounded backoff and then offers manual retry", async () => {
    let fakeTimersEnabled = false;
    try {
      const account = buildAccount("alpha", { displayName: "Retry streaming workspace" });
      seedAccounts([{ account, session: buildSession(account) }], account.id);
      mockedApi.listFiles.mockResolvedValue({
        path: "",
        items: [{ path: "Projects/song.mp3", name: "song.mp3", isFolder: false, size: 20 * 1024 * 1024, mimeType: "audio/mpeg" }]
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
          size: 20 * 1024 * 1024
        }
      });

      render(<App />);

      fireEvent.click(await screen.findByRole("button", { name: /Open file song.mp3/i }));
      const previewDialog = await screen.findByRole("dialog", { name: /Preview song.mp3/i });
      vi.useFakeTimers();
      fakeTimersEnabled = true;
      let audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", "/api/file/stream?path=Projects%2Fsong.mp3&streamToken=stream-token-alpha");

      fireEvent.error(audio);
      expect(within(previewDialog).getByText(/Stream interrupted\. Retrying playback shortly \(1\/3\)/i)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", expect.stringContaining("streamRetry=1"));

      fireEvent.error(audio);
      expect(within(previewDialog).getByText(/Stream interrupted\. Retrying playback shortly \(2\/3\)/i)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", expect.stringContaining("streamRetry=2"));

      fireEvent.error(audio);
      expect(within(previewDialog).getByText(/Stream interrupted\. Retrying playback shortly \(3\/3\)/i)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", expect.stringContaining("streamRetry=3"));

      fireEvent.error(audio);
      expect(within(previewDialog).getByText(/Media playback could not continue after several retries/i)).toBeInTheDocument();
      fireEvent.click(within(previewDialog).getByRole("button", { name: /Retry playback/i }));
      audio = previewDialog.querySelector("audio") as HTMLAudioElement;
      expect(audio).toHaveAttribute("src", expect.stringContaining("streamRetry=4"));
      expect(within(previewDialog).queryByText(/Media playback could not continue after several retries/i)).not.toBeInTheDocument();
    } finally {
      if (fakeTimersEnabled) {
        vi.useRealTimers();
      }
    }
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

  it("shows a fresh cached preview without a noisy cached-preview notice or remote check", async () => {
    vi.setSystemTime(new Date("2026-05-21T10:00:30.000Z"));
    const account = buildAccount("alpha", { displayName: "Fresh preview workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    mockedOpenedFileCache.getCachedOpenedFile.mockResolvedValue({
      entry: {
        path: textPreview.path,
        preview: { ...textPreview, content: "fresh cached preview" },
        mimeType: "text/plain",
        filename: "roadmap.txt",
        blobSize: 22,
        cachedAt: "2026-05-21T10:00:00.000Z",
        lastAccessedAt: "2026-05-21T10:00:00.000Z"
      },
      blob: new Blob(["fresh cached preview"], { type: "text/plain" })
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Open file roadmap.txt/i }));

    const previewDialog = await screen.findByRole("dialog", { name: /Preview roadmap.txt/i });
    await waitFor(() => expect(within(previewDialog).getByText("fresh cached preview")).toBeInTheDocument());
    expect(within(previewDialog).queryByText(/Showing cached preview/i)).not.toBeInTheDocument();
    expect(mockedApi.getFile).not.toHaveBeenCalledWith("Projects/roadmap.txt", "token-alpha");
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

  it("shows loading state for a never-cached folder instead of empty", async () => {
    const account = buildAccount("alpha", { displayName: "Unknown folder workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedCache.readFolderCacheEnvelope.mockReturnValue(undefined);

    const deferred = createDeferred<{ path: string; items: Array<{ path: string; name: string; isFolder: boolean; size?: number; mimeType?: string }> }>();
    mockedApi.listFiles.mockImplementation(() => deferred.promise);

    render(<App />);

    const emptyState = await waitFor(() => document.querySelector(".empty-state") as HTMLElement);
    expect(within(emptyState).getByText(/Loading folder/i)).toBeInTheDocument();
    expect(screen.queryByText(/This folder is empty/i)).not.toBeInTheDocument();

    deferred.resolve({ path: "", items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    expect(await screen.findByRole("button", { name: /Open folder Projects/i })).toBeInTheDocument();
  });

  it("shows unknown state when first load of a never-cached folder fails", async () => {
    const account = buildAccount("alpha", { displayName: "Unknown folder workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedCache.readFolderCacheEnvelope.mockReturnValue(undefined);
    mockedApi.listFiles.mockRejectedValueOnce(new Error("Network error"));

    render(<App />);

    expect(await screen.findByText(/Couldn't load this folder. Its contents are unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/This folder is empty/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry folder/i })).toBeInTheDocument();
  });

  it("shows normal empty state for a confirmed empty folder after successful load", async () => {
    const account = buildAccount("alpha", { displayName: "Empty folder workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValueOnce({ path: "", items: [] });

    render(<App />);

    const emptyState = await waitFor(() => document.querySelector(".empty-state") as HTMLElement);
    expect(within(emptyState).getByText(/This folder is empty/i)).toBeInTheDocument();
    expect(within(emptyState).queryByText(/Loading folder/i)).not.toBeInTheDocument();
    expect(within(emptyState).queryByText(/Couldn't load this folder/i)).not.toBeInTheDocument();
  });

  it("shows cached empty folder as empty while refreshing in the background", async () => {
    const account = buildAccount("alpha", { displayName: "Cached empty workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedCache.readFolderCacheEnvelope.mockReturnValue({
      cachedAt: "2026-06-07T10:00:00.000Z",
      value: []
    });

    const deferred = createDeferred<{ path: string; items: Array<{ path: string; name: string; isFolder: boolean; size?: number; mimeType?: string }> }>();
    mockedApi.listFiles.mockImplementation(() => deferred.promise);

    render(<App />);

    const emptyState = await waitFor(() => document.querySelector(".empty-state") as HTMLElement);
    expect(within(emptyState).getByText(/This folder is empty/i)).toBeInTheDocument();
    expect(within(emptyState).queryByText(/Loading folder/i)).not.toBeInTheDocument();
    expect(document.querySelector(".folder-cache-toast")).toBeNull();
    expect(screen.getByText("Refreshing")).toBeInTheDocument();
    expect(screen.queryByText(/Showing cached data while checking for changes in the background/i)).not.toBeInTheDocument();

    deferred.resolve({ path: "", items: [] });
    await waitFor(() => expect(screen.queryByText(/Showing cached data while checking for changes in the background/i)).not.toBeInTheDocument());
  });

  it("hides dot-prefixed files and folders by default", async () => {
    const account = buildAccount("alpha", { displayName: "Hidden files workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "visible.txt", name: "visible.txt", isFolder: false, size: 10, mimeType: "text/plain" },
        { path: ".hidden", name: ".hidden", isFolder: false, size: 5, mimeType: "text/plain" },
        { path: "._.DS_Store", name: "._.DS_Store", isFolder: false, size: 3, mimeType: "application/octet-stream" }
      ]
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Open file visible.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open file .hidden/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open file ._\.DS_Store/i })).not.toBeInTheDocument();
  });

  it("reveals hidden files when the settings toggle is enabled", async () => {
    const account = buildAccount("alpha", { displayName: "Hidden files workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "visible.txt", name: "visible.txt", isFolder: false, size: 10, mimeType: "text/plain" },
        { path: ".hidden", name: ".hidden", isFolder: false, size: 5, mimeType: "text/plain" }
      ]
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open file visible.txt/i });
    expect(screen.queryByRole("button", { name: /Open file .hidden/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const checkbox = within(settingsDialog).getByLabelText(/Show hidden files and folders/i);
    fireEvent.click(checkbox);

    expect(await screen.findByRole("button", { name: /Open file .hidden/i })).toBeInTheDocument();
  });

  it("sorts files by name descending when the sort mode is changed", async () => {
    const account = buildAccount("alpha", { displayName: "Sort workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "alpha.txt", name: "alpha.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "omega.txt", name: "omega.txt", isFolder: false, size: 2, mimeType: "text/plain" },
        { path: "beta.txt", name: "beta.txt", isFolder: false, size: 3, mimeType: "text/plain" }
      ]
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open file alpha.txt/i });
    let rowNames = Array.from(document.querySelectorAll(".item-name")).map((node) => node.textContent);
    expect(rowNames).toEqual(["alpha.txt", "beta.txt", "omega.txt"]);

    const sortSelect = screen.getByLabelText(/Sort files and folders/i);
    fireEvent.change(sortSelect, { target: { value: "name-desc" } });

    await waitFor(() => {
      rowNames = Array.from(document.querySelectorAll(".item-name")).map((node) => node.textContent);
      expect(rowNames).toEqual(["omega.txt", "beta.txt", "alpha.txt"]);
    });
  });

  it("sorts files by size when the sort mode is changed", async () => {
    const account = buildAccount("alpha", { displayName: "Sort workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "small.txt", name: "small.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "large.txt", name: "large.txt", isFolder: false, size: 100, mimeType: "text/plain" },
        { path: "medium.txt", name: "medium.txt", isFolder: false, size: 50, mimeType: "text/plain" }
      ]
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open file small.txt/i });
    const sortSelect = screen.getByLabelText(/Sort files and folders/i);
    fireEvent.change(sortSelect, { target: { value: "size-desc" } });

    await waitFor(() => {
      const rowNames = Array.from(document.querySelectorAll(".item-name")).map((node) => node.textContent);
      expect(rowNames).toEqual(["large.txt", "medium.txt", "small.txt"]);
    });
  });

  it("shows the active sort direction in the mobile toolbar", async () => {
    matchMediaMatches = true;
    const account = buildAccount("alpha", { displayName: "Mobile sort workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [
        { path: "alpha.txt", name: "alpha.txt", isFolder: false, size: 1, mimeType: "text/plain" },
        { path: "omega.txt", name: "omega.txt", isFolder: false, size: 2, mimeType: "text/plain" }
      ]
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open file alpha.txt/i });
    const sortButton = screen.getByRole("button", { name: /Open sort options\. Current sort: Name A-Z/i });
    expect(sortButton).toHaveTextContent("A-Z");

    fireEvent.click(sortButton);
    fireEvent.click(screen.getByRole("button", { name: "Name Z-A" }));

    expect(screen.getByRole("button", { name: /Open sort options\. Current sort: Name Z-A/i })).toHaveTextContent("Z-A");
  });
});
