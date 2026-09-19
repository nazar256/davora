import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSession, ConnectedAccount, SearchResult } from "@davora/shared";
import { buildAccount, buildSession } from "../../../../test/accounts";
import { buildHealthResponse } from "../../../../test/api";
import { buildFileEntry } from "../../../../test/files";
import { createDeferred } from "../../../../test/primitives";
import App from "../../../../App";
import type { AppServices } from "../../../../app/AppServices";
import type { AppShellProps } from "../../../../app/AppShell";
import { createBrowserAppServices } from "../../../../app/createBrowserAppServices";
import { createAccountRemovalRuntime } from "../../../../app/createAccountRemovalRuntime";
import type { AccountTransport } from "../../transport";
import type { BrowsingCacheRepository, FolderPorts, SearchPorts } from "../../../browsing";
import type { OperationRuntimePort } from "../../../operations/workspace";
import type { RetainedFile, RetainedSnapshot, RetentionAccount, RetentionRepository, RetentionResult } from "../../../offline/retention";
import { setBackendNetworkBlocked } from "../../../../lib/networkPolicy";

const appShellCapture = {
  latest: undefined as AppShellProps | undefined,
  history: [] as AppShellProps[]
};

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(async () => undefined)
  })
}));

vi.mock("../../../../app/AppShell", async () => {
  const actual = await vi.importActual<typeof import("../../../../app/AppShell")>("../../../../app/AppShell");
  return {
    ...actual,
    AppShell: (props: AppShellProps) => {
      appShellCapture.latest = props;
      appShellCapture.history.push(props);
      return <actual.AppShell {...props} />;
    }
  };
});

const healthResponse = buildHealthResponse();

type RetentionStore = {
  account: RetentionAccount;
  snapshot: Omit<RetainedSnapshot, "account">;
};

const retentionStores = new Map<string, RetentionStore>();

const emptySnapshot = (account: RetentionAccount): RetainedSnapshot => ({
  account: { ...account },
  normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
  roots: [],
  files: [],
  memberships: []
});

const retentionSnapshotFor = (account: RetentionAccount): RetainedSnapshot => {
  const store = retentionStores.get(account.cacheNamespace);
  return store ? { account: { ...store.account }, ...store.snapshot } : emptySnapshot(account);
};

const retentionSuccess = <T,>(value: T): RetentionResult<T> => ({ kind: "success", value });

const mockedRetentionRepository = {
  readSnapshot: vi.fn<RetentionRepository["readSnapshot"]>(async (account) => retentionSuccess(retentionSnapshotFor(account))),
  readPreview: vi.fn<RetentionRepository["readPreview"]>(async () => retentionSuccess(undefined)),
  writePreview: vi.fn<RetentionRepository["writePreview"]>(async (account) => retentionSuccess(retentionSnapshotFor(account))),
  beginRoot: vi.fn<RetentionRepository["beginRoot"]>(async (account) => retentionSuccess(retentionSnapshotFor(account))),
  persistRetainedFile: vi.fn<RetentionRepository["persistRetainedFile"]>(async (account) => retentionSuccess(retentionSnapshotFor(account))),
  completeRoot: vi.fn<RetentionRepository["completeRoot"]>(async (account) => retentionSuccess(retentionSnapshotFor(account))),
  removeRoot: vi.fn<RetentionRepository["removeRoot"]>(async (account) => retentionSuccess(retentionSnapshotFor(account))),
  clearNormalCache: vi.fn<RetentionRepository["clearNormalCache"]>(async (account) => retentionSuccess(retentionSnapshotFor(account))),
  purgeAccountNamespace: vi.fn<RetentionRepository["purgeAccountNamespace"]>(async (account) => {
    retentionStores.delete(account.cacheNamespace);
    return retentionSuccess(emptySnapshot(account));
  }),
  configureNormalCacheLimit: vi.fn<RetentionRepository["configureNormalCacheLimit"]>(async (account) => retentionSuccess(retentionSnapshotFor(account)))
} satisfies RetentionRepository;

function retentionAccountFor(account: ConnectedAccount): RetentionAccount {
  return { accountId: account.id, cacheNamespace: account.cacheNamespace };
}

function retainedFileFixture(path: string, options: Partial<RetainedFile> = {}): RetainedFile {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    mimeType: "text/plain",
    size: 0,
    blobSize: 0,
    readable: true,
    normalCacheOwnership: "none",
    ...options
  };
}

function seedRetentionSnapshot(account: ConnectedAccount, input: Omit<RetainedSnapshot, "account">): void {
  retentionStores.set(account.cacheNamespace, { account: retentionAccountFor(account), snapshot: structuredClone(input) });
}

const mockedCache = {
  readFolder: vi.fn<BrowsingCacheRepository["readFolder"]>(() => ({ kind: "miss" })),
  writeFolder: vi.fn<BrowsingCacheRepository["writeFolder"]>(() => ({ kind: "written" })),
  readSearch: vi.fn<BrowsingCacheRepository["readSearch"]>(() => ({ kind: "miss" })),
  writeSearch: vi.fn<BrowsingCacheRepository["writeSearch"]>(() => ({ kind: "written" })),
  clearNamespace: vi.fn<BrowsingCacheRepository["clearNamespace"]>(() => ({ kind: "cleared" })),
  clearFolderPath: vi.fn<BrowsingCacheRepository["clearFolderPath"]>(() => ({ kind: "cleared" })),
  clearNamespaceOrThrow: vi.fn<BrowsingCacheRepository["clearNamespaceOrThrow"]>(() => undefined),
  clearFolderPathOrThrow: vi.fn<BrowsingCacheRepository["clearFolderPathOrThrow"]>(() => undefined)
} satisfies BrowsingCacheRepository;

const mockedApi = {
  getHealth: vi.fn<AccountTransport["getHealth"]>(),
  connectAccount: vi.fn<AccountTransport["connectAccount"]>(),
  createSession: vi.fn<AccountTransport["createSession"]>(),
  deleteConnectedAccount: vi.fn<AccountTransport["deleteConnectedAccount"]>(),
  deleteFile: vi.fn<OperationRuntimePort["mutation"]["deleteFile"]>(async () => ({ action: "delete", parentPath: "", path: "" }))
};

const folderPorts: FolderPorts = {
  createAbortHandle: () => {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  },
  loadFolder: vi.fn<FolderPorts["loadFolder"]>(async ({ path }) => ({
    kind: "success",
    items: path
      ? [{ ...buildFileEntry("Projects/roadmap.txt", { name: "roadmap.txt" }) }]
      : [{ ...buildFileEntry("Projects", { isFolder: true, name: "Projects" }) }]
  })),
  readCachedFolder: vi.fn(() => undefined),
  writeCachedFolder: vi.fn(() => undefined)
};

const searchPorts: SearchPorts = {
  createAbortHandle: () => {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  },
  loadSearch: vi.fn<SearchPorts["loadSearch"]>(async () => ({ kind: "success", items: [] as SearchResult[] })),
  readCachedSearch: vi.fn(() => undefined),
  writeCachedSearch: vi.fn(() => undefined)
};

const accountTransport: AccountTransport = {
  getHealth: mockedApi.getHealth,
  connectAccount: mockedApi.connectAccount,
  createSession: mockedApi.createSession,
  deleteConnectedAccount: mockedApi.deleteConnectedAccount
};

function seedAccounts(records: Array<{ account: ConnectedAccount; session?: { token: string; expiresAt: string; rootPath: string; capabilities: AppSession["capabilities"] }; pendingRemoval?: { phase: "revoke" | "purge" }; pendingReconnect?: { baseUrl: string; username: string; label?: string } }>, activeAccountId?: string): void {
  localStorage.setItem("davora-account-state", JSON.stringify({
    activeAccountId: activeAccountId ?? records[0]?.account.id,
    accounts: records
  }));
}

function createServices(): AppServices {
  const base = createBrowserAppServices();
  mockedApi.getHealth.mockResolvedValue(healthResponse);
  mockedApi.createSession.mockImplementation(async ({ accountId }) => {
    const account = base.accountRegistry.getSnapshot().accounts.find((record) => record.account.id === accountId)?.account
      ?? buildAccount(accountId, { displayName: `Account ${accountId}` });
    return buildSession(account);
  });
  return {
    ...base,
    accountTransport,
    accountSession: {
      ...base.accountSession,
      getHealth: mockedApi.getHealth,
      createSession: mockedApi.createSession
    },
    browsingCache: mockedCache,
    folder: folderPorts,
    search: searchPorts,
    operationRuntime: {
      ...base.operationRuntime,
      mutation: {
        ...base.operationRuntime.mutation,
        deleteFile: mockedApi.deleteFile
      }
    },
    retentionRepository: mockedRetentionRepository,
    accountRemovalRuntime: createAccountRemovalRuntime({
      accountTransport,
      retentionRepository: mockedRetentionRepository,
      browsingCache: mockedCache,
      favourites: base.favourites,
      folderSorts: base.folderSorts
    })
  };
}

let restoreRemoveItemSpy: (() => void) | undefined;
let restoreConsoleErrorSpy: (() => void) | undefined;

function renderApp(): ReturnType<typeof render> {
  const services = createServices();
  return render(<App services={services} />);
}

function dispatchAppBack(path = ""): void {
  window.dispatchEvent(new PopStateEvent("popstate", { state: { davora: true, path } }));
}

beforeEach(() => {
  cleanup();
  appShellCapture.latest = undefined;
  appShellCapture.history.length = 0;
  setBackendNetworkBlocked(false);
  localStorage.clear();
  retentionStores.clear();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
  mockedCache.readFolder.mockReturnValue({ kind: "miss" });
  mockedCache.writeFolder.mockReturnValue({ kind: "written" });
  mockedCache.readSearch.mockReturnValue({ kind: "miss" });
  mockedCache.writeSearch.mockReturnValue({ kind: "written" });
  mockedCache.clearNamespace.mockReturnValue({ kind: "cleared" });
  mockedCache.clearFolderPath.mockReturnValue({ kind: "cleared" });
  mockedCache.clearNamespaceOrThrow.mockImplementation(() => undefined);
  mockedCache.clearFolderPathOrThrow.mockImplementation(() => undefined);
  mockedRetentionRepository.readSnapshot.mockImplementation(async (account) => retentionSuccess(retentionSnapshotFor(account)));
  mockedRetentionRepository.purgeAccountNamespace.mockImplementation(async (account) => {
    retentionStores.delete(account.cacheNamespace);
    return retentionSuccess(emptySnapshot(account));
  });
  mockedApi.deleteConnectedAccount.mockReset();
  mockedApi.createSession.mockReset();
  mockedApi.getHealth.mockReset();
});

afterEach(() => {
  restoreRemoveItemSpy?.();
  restoreRemoveItemSpy = undefined;
  restoreConsoleErrorSpy?.();
  restoreConsoleErrorSpy = undefined;
  cleanup();
  appShellCapture.latest = undefined;
  appShellCapture.history.length = 0;
});

describe("App account-removal integration", () => {

  it("clears account-scoped favourites when the account is removed", async () => {
    const account = buildAccount("alpha", { displayName: "Favourite removal workspace", label: "Favourite removal workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    localStorage.setItem("davora-favourites:alpha", JSON.stringify([
      { accountId: "alpha", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-alpha", path: "Projects", name: "Projects", isFolder: true, addedAt: "2026-07-10T00:00:00.000Z" }
    ]));
    mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);

    renderApp();

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Remove$/i }));

    const removeDialog = await screen.findByRole("dialog", { name: /Remove Favourite removal workspace/i });
    fireEvent.change(within(removeDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Favourite removal workspace" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledWith("alpha"));
    expect(localStorage.getItem("davora-favourites:alpha")).toBeNull();
  });

  it("purges only the removed account namespace while retaining another account cache", async () => {
    const alpha = buildAccount("alpha", { displayName: "Purge Alpha", label: "Purge Alpha" });
    const beta = buildAccount("beta", { displayName: "Purge Beta", label: "Purge Beta", cacheNamespace: "ns-beta" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    seedRetentionSnapshot(alpha, {
      normalCache: { itemCount: 1, totalBytes: 4, limitBytes: 24 * 1024 * 1024 },
      roots: [],
      files: [retainedFileFixture("alpha-secret.txt", { normalCacheOwnership: "owned" })],
      memberships: []
    });
    seedRetentionSnapshot(beta, {
      normalCache: { itemCount: 1, totalBytes: 3, limitBytes: 24 * 1024 * 1024 },
      roots: [],
      files: [retainedFileFixture("beta-safe.txt", { normalCacheOwnership: "owned" })],
      memberships: []
    });
    localStorage.setItem("davora-favourites:beta", JSON.stringify([
      { accountId: "beta", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-beta", path: "Beta-safe", name: "Beta-safe", isFolder: true, addedAt: "2026-07-10T00:00:00.000Z" }
    ]));
    mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);

    renderApp();
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Remove$/i }));
    const removeDialog = await screen.findByRole("dialog", { name: /Remove Purge Alpha/i });
    fireEvent.change(within(removeDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Purge Alpha" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(screen.getByText(/No connected accounts yet|Purge Beta/i)).toBeInTheDocument());
    expect(mockedRetentionRepository.purgeAccountNamespace).toHaveBeenCalledExactlyOnceWith(retentionAccountFor(alpha), [retentionAccountFor(alpha), retentionAccountFor(beta)]);
    const alphaSnapshot = await mockedRetentionRepository.readSnapshot(retentionAccountFor(alpha));
    const betaSnapshot = await mockedRetentionRepository.readSnapshot(retentionAccountFor(beta));
    expect(alphaSnapshot).toMatchObject({ kind: "success", value: { files: [] } });
    expect(betaSnapshot).toMatchObject({ kind: "success", value: { files: [{ path: "beta-safe.txt" }] } });
    expect(mockedCache.clearNamespaceOrThrow).toHaveBeenCalledWith(alpha.cacheNamespace);
    expect(mockedCache.clearNamespaceOrThrow).not.toHaveBeenCalledWith(beta.cacheNamespace);
    expect(localStorage.getItem("davora-favourites:beta")).toContain("Beta-safe");
    expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledExactlyOnceWith(alpha.id);
    expect(mockedApi.deleteFile).not.toHaveBeenCalled();
  });

  it("keeps Beta active and preserves Beta browser state while Alpha removal is pending", async () => {
    const alpha = buildAccount("alpha", { displayName: "Pending Alpha", label: "Pending Alpha" });
    const beta = buildAccount("beta", { displayName: "Active Beta", label: "Active Beta", cacheNamespace: "ns-beta" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    seedRetentionSnapshot(beta, {
      normalCache: { itemCount: 1, totalBytes: 3, limitBytes: 24 * 1024 * 1024 },
      roots: [],
      files: [retainedFileFixture("beta-safe.txt", { normalCacheOwnership: "owned" })],
      memberships: []
    });
    localStorage.setItem("davora-favourites:beta", JSON.stringify([
      { accountId: "beta", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-beta", path: "Beta-safe", name: "Beta-safe", isFolder: true, addedAt: "2026-07-10T00:00:00.000Z" }
    ]));
    const revoke = createDeferred<void>();
    mockedApi.deleteConnectedAccount.mockImplementation(() => revoke.promise);

    renderApp();
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Remove$/i }));
    const removeDialog = await screen.findByRole("dialog", { name: /Remove Pending Alpha/i });
    fireEvent.change(within(removeDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Pending Alpha" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledExactlyOnceWith(alpha.id));
    const pendingWorkspace = [...appShellCapture.history].reverse().find((props) => props.kind === "workspace");
    expect(pendingWorkspace?.kind).toBe("workspace");
    if (pendingWorkspace?.kind === "workspace") {
      const navigationDrawer = pendingWorkspace.common.navigationDrawer;
      expect(navigationDrawer).toBeDefined();
      if (navigationDrawer) {
        expect(navigationDrawer.props.accountName).toBe("Active Beta");
        expect(navigationDrawer.props.entries).toEqual(expect.arrayContaining([
          expect.objectContaining({ accountId: beta.id, path: "Beta-safe" })
        ]));
      }
    }
    expect((await mockedRetentionRepository.readSnapshot(retentionAccountFor(beta)))).toMatchObject({ kind: "success", value: { files: [{ path: "beta-safe.txt" }] } });
    expect(localStorage.getItem("davora-favourites:beta")).toContain("Beta-safe");
    revoke.resolve();
    await act(async () => { await revoke.promise; });
  });

  it("keeps remote revoke failure visible and retryable in the removal dialog", async () => {
    const account = buildAccount("alpha", { displayName: "Retry revoke workspace", label: "Retry revoke workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.deleteConnectedAccount
      .mockRejectedValueOnce(new Error("remote revoke unavailable"))
      .mockResolvedValueOnce(undefined);

    renderApp();
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Remove$/i }));
    const removeDialog = await screen.findByRole("dialog", { name: /Remove Retry revoke workspace/i });
    fireEvent.change(within(removeDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Retry revoke workspace" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);
    expect(await screen.findByText(/could not revoke remote access/i)).toBeInTheDocument();

    const retryDialog = screen.getByRole("dialog", { name: /Remove Retry revoke workspace/i });
    expect(within(retryDialog).getByRole("button", { name: /^Remove account$/i })).not.toBeDisabled();
    fireEvent.change(within(retryDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Retry revoke workspace" } });
    fireEvent.submit(within(retryDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);
    await waitFor(() => expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/could not revoke remote access/i)).not.toBeInTheDocument();
  });

  it("closes a reloaded remove dialog after the retry completes remote revoke", async () => {
    const account = buildAccount("alpha", { displayName: "Reloaded retry workspace", label: "Reloaded retry workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.deleteConnectedAccount
      .mockRejectedValueOnce(new Error("remote revoke unavailable"))
      .mockResolvedValueOnce(undefined);

    const firstApp = renderApp();
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const firstSettingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(firstSettingsDialog).getByRole("button", { name: /^Remove$/i }));
    const firstRemoveDialog = await screen.findByRole("dialog", { name: /Remove Reloaded retry workspace/i });
    fireEvent.change(within(firstRemoveDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Reloaded retry workspace" } });
    fireEvent.submit(within(firstRemoveDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);
    await screen.findByText(/could not revoke remote access/i);

    firstApp.unmount();
    renderApp();
    await screen.findByRole("button", { name: /Connect account/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const retrySettingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(retrySettingsDialog).getByRole("button", { name: /Retry removal/i }));
    const retryDialog = await screen.findByRole("dialog", { name: /Remove Reloaded retry workspace/i });
    fireEvent.change(within(retryDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Reloaded retry workspace" } });
    fireEvent.submit(within(retryDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Remove Reloaded retry workspace/i })).not.toBeInTheDocument());
    expect(localStorage.getItem("davora-account-state")).toContain('"accounts":[]');
  });

  it("keeps a reloaded revoke-pending account out of session restore and exposes retry removal", async () => {
    const account = buildAccount("alpha", { displayName: "Reload pending workspace", label: "Reload pending workspace" });
    const beta = buildAccount("beta", { displayName: "Retained operational workspace", label: "Retained operational workspace" });
    seedAccounts([{ account, pendingRemoval: { phase: "revoke" } }, { account: beta, session: buildSession(beta) }], account.id);
    mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);

    renderApp();
    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    expect(mockedApi.createSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(settingsDialog).toHaveTextContent(/Removal pending for Reload pending workspace/i);
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /Retry removal/i }));
    const removeDialog = await screen.findByRole("dialog", { name: /Remove Reload pending workspace/i });
    fireEvent.change(within(removeDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Reload pending workspace" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledWith(account.id));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Remove Reload pending workspace/i })).not.toBeInTheDocument());
    expect(localStorage.getItem("davora-account-state")).not.toContain('"id":"alpha"');
    expect(localStorage.getItem("davora-account-state")).toContain('"id":"beta"');
  });

  it("exposes a reloaded purge-pending account as browser-cleanup retry", async () => {
    const account = buildAccount("alpha", { displayName: "Reload purge workspace", label: "Reload purge workspace" });
    seedAccounts([{ account, pendingRemoval: { phase: "purge" } }], account.id);

    renderApp();
    await screen.findByRole("button", { name: /Connect account/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByText(/browser cleanup/i)).toBeInTheDocument();
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /Retry removal/i }));
    const removeDialog = await screen.findByRole("dialog", { name: /Remove Reload purge workspace/i });
    fireEvent.change(within(removeDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Reload purge workspace" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(mockedRetentionRepository.purgeAccountNamespace).toHaveBeenCalledWith(retentionAccountFor(account), expect.any(Array)));
    expect(mockedApi.deleteConnectedAccount).not.toHaveBeenCalled();
    expect(localStorage.getItem("davora-account-state")).toContain('"accounts":[]');
  });

  it("closes settings before opening remove and Back dismisses only the remove surface", async () => {
    const account = buildAccount("alpha", { displayName: "Settings remove bridge", label: "Settings remove bridge" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    renderApp();

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Remove$/i }));

    expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: /Remove Settings remove bridge/i })).toBeInTheDocument();
    expect(mockedApi.deleteConnectedAccount).not.toHaveBeenCalled();

    act(() => dispatchAppBack(""));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Remove Settings remove bridge/i })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument();
    expect(mockedApi.deleteConnectedAccount).not.toHaveBeenCalled();
  });

  it("retains pending removal when favourite storage cleanup fails and retries the exact key", async () => {
    const account = buildAccount("alpha", { displayName: "Broken favourite storage", label: "Broken favourite storage" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    localStorage.setItem("davora-favourites:alpha", "[]");
    const originalRemoveItem = Storage.prototype.removeItem;
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation((key) => {
      if (key === "davora-favourites:alpha") {
        throw new Error("Storage blocked");
      }
      return originalRemoveItem.call(localStorage, key);
    });
    restoreRemoveItemSpy = () => removeItemSpy.mockRestore();
    mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);

    renderApp();

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Remove$/i }));
    const removeDialog = await screen.findByRole("dialog", { name: /Remove Broken favourite storage/i });
    fireEvent.change(within(removeDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Broken favourite storage" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    expect(await screen.findByText(/browser cleanup did not complete/i)).toBeInTheDocument();
    expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledTimes(1);
    const stateAfterFailure = localStorage.getItem("davora-account-state") ?? "";
    expect(stateAfterFailure).toContain('"id":"alpha"');
    expect(stateAfterFailure).toContain('"pendingRemoval":{"phase":"purge"}');
    expect(localStorage.getItem("davora-favourites:alpha")).not.toBeNull();

    removeItemSpy.mockRestore();
    restoreRemoveItemSpy = undefined;
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const retrySettingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(retrySettingsDialog).getByText(/Removal pending for/i)).toBeInTheDocument();
    const retryButton = within(retrySettingsDialog).getByRole("button", { name: /Retry removal/i });
    fireEvent.click(retryButton);
    const retryDialog = await screen.findByRole("dialog", { name: /Remove Broken favourite storage/i });
    fireEvent.change(within(retryDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Broken favourite storage" } });
    fireEvent.submit(within(retryDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(localStorage.getItem("davora-account-state")).toContain('"accounts":[]'));
    expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("davora-favourites:alpha")).toBeNull();
  });

  it("retries local-only removal cleanup without repeating remote deletion", async () => {
    const account = buildAccount("alpha", { displayName: "Local retry workspace", label: "Local retry workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.deleteConnectedAccount.mockResolvedValue(undefined);
    mockedRetentionRepository.purgeAccountNamespace
      .mockResolvedValueOnce({ kind: "failure", message: "quota while purging account namespace" })
      .mockResolvedValue({ kind: "success", value: {
        account: retentionAccountFor(account),
        normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
        roots: [], files: [], memberships: []
      } });

    renderApp();
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Remove$/i }));
    const removeDialog = await screen.findByRole("dialog", { name: /Remove Local retry workspace/i });
    const confirmation = within(removeDialog).getByLabelText(/Account label to confirm/i);
    fireEvent.change(confirmation, { target: { value: "Local retry workspace" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    expect(await screen.findByText(/browser cleanup did not complete/i)).toBeInTheDocument();
    expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledTimes(1);

    const retryDialog = screen.getByRole("dialog", { name: /Remove Local retry workspace/i });
    fireEvent.change(within(retryDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Local retry workspace" } });
    fireEvent.submit(within(retryDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(localStorage.getItem("davora-account-state")).toContain('"accounts":[]'));
    expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledTimes(1);
  });

  it("redacts token-shaped remote removal failures from UI and browser state", async () => {
    const account = buildAccount("alpha", { displayName: "Redacted removal workspace", label: "Redacted removal workspace" });
    const tokenSentinel = "token-alpha-secret-sentinel";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    restoreConsoleErrorSpy = () => consoleError.mockRestore();
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.deleteConnectedAccount.mockRejectedValue(new Error(`remote Authorization=${tokenSentinel}`));

    renderApp();
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: /^Remove$/i }));
    const removeDialog = await screen.findByRole("dialog", { name: /Remove Redacted removal workspace/i });
    fireEvent.change(within(removeDialog).getByLabelText(/Account label to confirm/i), { target: { value: "Redacted removal workspace" } });
    fireEvent.submit(within(removeDialog).getByRole("button", { name: /^Remove account$/i }).closest("form")!);

    await waitFor(() => expect(mockedApi.deleteConnectedAccount).toHaveBeenCalledWith(account.id));
    expect(await screen.findByText(/could not revoke remote access/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(tokenSentinel);
    expect(localStorage.getItem("davora-account-state") ?? "").not.toContain(tokenSentinel);
    expect(consoleError.mock.calls.flat()).not.toContain(tokenSentinel);
    expect(window.location.href).not.toContain(tokenSentinel);
    consoleError.mockRestore();
    restoreConsoleErrorSpy = undefined;
  });
});
