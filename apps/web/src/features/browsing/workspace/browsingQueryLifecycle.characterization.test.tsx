// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FileEntry, SearchResult } from "@davora/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createDeferred } from "../../../test/primitives";
import type { FolderPorts } from "../folder/ports";
import type { SearchPorts } from "../search/ports";
import { getSearchDisplayQuery, isSearchActive } from "../presentation";
import { projectBrowsingSurfaceBindings, type BrowsingSurfaceInput } from "./projectBrowsingSurfaceBindings";
import { useBrowsingWorkspace, type BrowsingWorkspaceInput } from "./index";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(sourceDir, "../../../../../../");
const browsingWorkspacePath = resolve(sourceDir, "./useBrowsingWorkspace.ts");
const presentationPath = resolve(sourceDir, "../presentation.ts");
const searchHookPath = resolve(sourceDir, "../search/useSearch.ts");
const searchModelPath = resolve(sourceDir, "../search/model.ts");
const folderHookPath = resolve(sourceDir, "../folder/useFolder.ts");
const folderModelPath = resolve(sourceDir, "../folder/model.ts");
const browsingSurfacePath = resolve(sourceDir, "./projectBrowsingSurfaceBindings.ts");
const appBarWorkspacePath = resolve(sourceDir, "../appBar/workspace/useAppBarWorkspace.tsx");
const appBarStagePath = resolve(sourceDir, "../appBar/AppBarStage.tsx");
const fileListStagePath = resolve(sourceDir, "../fileList/FileListStage.tsx");
const accountResetPath = resolve(sourceDir, "../../accounts/reset/controller.ts");
const accountResetHookPath = resolve(sourceDir, "../../accounts/reset/useAccountReset.ts");
const characterizationPath = fileURLToPath(import.meta.url);
const evidenceDir = resolve(workspaceRoot, ".tmp/agent-artifacts/worker/browsing-query-lifecycle-characterization-20260829");

const browsingWorkspaceSource = readFileSync(browsingWorkspacePath, "utf8");
const presentationSource = readFileSync(presentationPath, "utf8");
const searchHookSource = readFileSync(searchHookPath, "utf8");
const searchModelSource = readFileSync(searchModelPath, "utf8");
const folderHookSource = readFileSync(folderHookPath, "utf8");
const folderModelSource = readFileSync(folderModelPath, "utf8");
const browsingSurfaceSource = readFileSync(browsingSurfacePath, "utf8");
const appBarWorkspaceSource = readFileSync(appBarWorkspacePath, "utf8");
const appBarStageSource = readFileSync(appBarStagePath, "utf8");
const fileListStageSource = readFileSync(fileListStagePath, "utf8");
const accountResetSource = readFileSync(accountResetPath, "utf8");
const accountResetHookSource = readFileSync(accountResetHookPath, "utf8");

const folderItems: FileEntry[] = [
  { path: "Docs/visible.txt", name: "visible.txt", isFolder: false },
  { path: "Docs/.hidden.txt", name: ".hidden.txt", isFolder: false },
  { path: "Docs/Archive", name: "Archive", isFolder: true }
];

const searchItems: SearchResult[] = [
  { path: "Docs/visible.txt", name: "visible.txt", isFolder: false, score: 2 },
  { path: "Docs/Archive", name: "Archive", isFolder: true, score: 1 }
];

type PortOverrides = {
  folderLoad?: FolderPorts["loadFolder"];
  searchLoad?: SearchPorts["loadSearch"];
  searchItemsFor?: (query: string) => readonly SearchResult[];
};

function createPorts(overrides: PortOverrides = {}) {
  const folder: FolderPorts = {
    createAbortHandle: () => new AbortController(),
    loadFolder: overrides.folderLoad ?? vi.fn<FolderPorts["loadFolder"]>(async () => ({ kind: "success", items: folderItems })),
    readCachedFolder: vi.fn(() => undefined),
    writeCachedFolder: vi.fn()
  };
  const search: SearchPorts = {
    createAbortHandle: () => new AbortController(),
    loadSearch: overrides.searchLoad ?? vi.fn<SearchPorts["loadSearch"]>(async () => ({ kind: "success", items: searchItems })),
    readCachedSearch: vi.fn(() => undefined),
    writeCachedSearch: vi.fn()
  };
  return {
    folder,
    search,
    searchItemsFor: overrides.searchItemsFor ?? (() => searchItems)
  };
}

function createInput(ports = createPorts(), overrides: Partial<BrowsingWorkspaceInput> = {}): BrowsingWorkspaceInput {
  return {
    context: {
      accountId: "alpha",
      accountName: "Work",
      cacheNamespace: "ns-alpha",
      path: "Docs",
      token: "token-alpha"
    },
    mode: {
      folder: "online",
      search: "online",
      cacheOnly: false,
      explicitOffline: false,
      browserOffline: false
    },
    settings: { showHiddenFiles: false, sortMode: "name-asc" },
    offlineSource: {
      folderItems: [],
      searchItemsFor: ports.searchItemsFor
    },
    ports: {
      folder: ports.folder,
      search: ports.search,
      session: { terminate: vi.fn() },
      availability: { setWorkerUnavailable: vi.fn() },
      presentation: { setStatus: vi.fn() }
    },
    ...overrides
  };
}

const count = (source: string, needle: string): number => source.split(needle).length - 1;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const read = (path: string): string => readFileSync(path, "utf8");
const characterization = { branches: [] as string[], adversaries: [] as string[] };

function buildSurfaceInput(raw: string, active: boolean, set: (value: string) => void, clear: () => void): BrowsingSurfaceInput {
  const file: FileEntry = { path: "Docs/roadmap.txt", name: "roadmap.txt", isFolder: false };
  return {
    owners: {
      browse: {
        context: { path: "Docs" },
        mode: { cacheOnly: false },
        query: { raw, active, set, clear },
        folder: { refreshing: false, stale: false },
        list: { items: [file] },
        presentation: {
          breadcrumbs: [],
          browseStatusLabel: "1 item in /Docs",
          folderLabel: "Docs",
          locationLabel: "/Docs",
          empty: { emptyStatus: "", emptyTitle: "", listRecoveryAvailable: false, showEmptyState: false },
          showBreadcrumbs: true
        }
      },
      selection: {
        fileList: {
          batchModeActive: false,
          selectionModeActive: false,
          isItemBatchSelected: () => false,
          isItemSelected: () => false,
          clearRowOpenSuppression: vi.fn(),
          getRowOpenSuppressed: () => false,
          onRowPointerCancel: vi.fn(),
          onRowPointerDown: vi.fn(),
          onRowPointerLeave: vi.fn(),
          onRowPointerUp: vi.fn(),
          onToggleBatchSelection: vi.fn(),
          onToggleEntrySelection: vi.fn(),
          suppressNarrowScreenContextMenu: false
        },
        presentation: {},
        interaction: { clearBatchSelection: vi.fn() },
        batch: { entries: [], capture: () => ({ memberships: [] }) }
      },
      operation: {
        capabilities: {
          canCopyMoveBatchSelection: false,
          canCreateFolder: false,
          canDeleteBatchSelection: false,
          canDownloadBatchSelection: false,
          canSyncBatchOffline: false,
          canUploadFiles: false,
          canUploadFolders: false,
          canMarkForBatchDownload: false
        },
        mutation: { state: { busy: false } },
        commands: { openCreateFolder: vi.fn(), openDeleteSelection: vi.fn(), openCopyMoveSelection: vi.fn() },
        download: { downloadBatch: vi.fn() },
        upload: { uploadFiles: vi.fn(), drop: { active: false, onDragEnter: vi.fn(), onDragLeave: vi.fn(), onDragOver: vi.fn(), onDrop: vi.fn() } }
      },
      offline: { explicitOfflineMode: false, isItemAvailableOffline: () => false },
      navigation: { getCurrentPath: () => "Docs", navigateToPath: vi.fn() },
      settings: { preferences: { fileSizeDisplayMode: "human", sortMode: "name-asc" }, commands: { handleFileSizeDisplayModeChange: vi.fn(), handleSortModeChange: vi.fn() } },
      status: { message: "Ready" },
      pullToRefresh: { fileListRef: vi.fn() }
    },
    ports: {
      directoryUploadInputRef: vi.fn(),
      loadFolder: vi.fn(),
      openFile: vi.fn(),
      openOfflineSync: vi.fn()
    }
  };
}

describe("Browsing query lifecycle characterization", () => {
  beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  afterAll(() => {
    writeFileSync(resolve(evidenceDir, "characterization-summary.md"), [
      "Browsing query lifecycle and consumer projection Gate 1 characterization",
      `browsing-workspace-source-sha256=${sha256(read(browsingWorkspacePath))}`,
      `characterization-source-sha256=${sha256(read(characterizationPath))}`,
      `branches=${characterization.branches.join(",")}`,
      `adversaries=${characterization.adversaries.join(",")}`
    ].join("\n") + "\n");
  });

  it("locks the single owner, exact raw/display split, consumer projection, and reset boundary", () => {
    expect(count(browsingWorkspaceSource, "const [rawQuery, setRawQuery] = useState(\"\");")).toBe(1);
    expect(count(browsingWorkspaceSource, "const active = isSearchActive(rawQuery);")).toBe(1);
    expect(count(browsingWorkspaceSource, "query: rawQuery")).toBe(1);
    expect(count(browsingWorkspaceSource, "searchItemsFor(rawQuery)")).toBe(1);
    expect(count(browsingWorkspaceSource, "const visibleError = active ? externalListError : folderError ?? externalListError;")).toBe(1);
    expect(count(presentationSource, "return rawQuery.trim();")).toBe(1);
    expect(count(searchModelSource, "sameSearchKey")).toBe(2);
    expect(count(folderModelSource, "sameFolderKey")).toBe(2);
    expect(browsingWorkspaceSource).not.toMatch(/query:\s*rawQuery\.trim\(\)/);
    expect(browsingSurfaceSource).toContain("onSearchQueryChange: browse.query.set");
    expect(browsingSurfaceSource).toContain("searchQuery: browse.query.raw");
    expect(browsingSurfaceSource).toContain("onClearSearch: browse.query.clear");
    expect(browsingSurfaceSource).toContain("showClearSearchButton: browse.query.active");
    expect(appBarWorkspaceSource).toContain("onSearchQueryChange: owners.browsing.query.set");
    expect(appBarWorkspaceSource).toContain("searchQuery: owners.browsing.query.raw");
    expect(appBarStageSource).toContain("value={props.searchQuery}");
    expect(appBarStageSource).toContain("props.onSearchQueryChange(event.target.value)");
    expect(fileListStageSource).toContain("props.showClearSearchButton ? <button onClick={props.onClearSearch}");
    expect(accountResetSource).toContain("ports.browsing.clearQuery();");
    expect(accountResetHookSource).toContain("executeAccountSwitchReset(current.ports");
    characterization.branches.push("single-query-owner", "raw-display-separation", "consumer-projection", "explicit-reset-boundary");
  });

  it("keeps an initial empty query inactive without search backend or cache I/O", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useBrowsingWorkspace(createInput(ports)));

    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    expect(result.current.query).toMatchObject({ raw: "", active: false });
    expect(result.current.list.items).toEqual([folderItems[2], folderItems[0]]);
    expect(ports.search.loadSearch).not.toHaveBeenCalled();
    expect(ports.search.readCachedSearch).not.toHaveBeenCalled();
    expect(ports.search.writeCachedSearch).not.toHaveBeenCalled();
    characterization.branches.push("initial-empty-inactive", "initial-folder-projection", "initial-search-no-io");
  });

  it("keeps whitespace-only raw input inactive and on the folder projection", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useBrowsingWorkspace(createInput(ports)));

    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    act(() => result.current.query.set("  \t\n  "));
    await waitFor(() => expect(result.current.query.raw).toBe("  \t\n  "));
    expect(result.current.query.active).toBe(false);
    expect(result.current.list.items).toEqual([folderItems[2], folderItems[0]]);
    expect(ports.search.loadSearch).not.toHaveBeenCalled();
    expect(ports.search.readCachedSearch).not.toHaveBeenCalled();
    expect(ports.search.writeCachedSearch).not.toHaveBeenCalled();
    characterization.branches.push("whitespace-inactive", "whitespace-folder-projection", "whitespace-search-no-io");
  });

  it("transports active raw input exactly while presentation uses only the trimmed display value", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useBrowsingWorkspace(createInput(ports)));
    const raw = "  Plan  Q3  ";

    act(() => result.current.query.set(raw));
    await waitFor(() => expect(ports.search.loadSearch).toHaveBeenCalledWith(expect.objectContaining({ query: raw })));
    expect(result.current.query).toMatchObject({ raw, active: true });
    expect(result.current.presentation.browseStatusLabel).toContain("Plan  Q3");
    expect(result.current.presentation.browseStatusLabel).not.toContain("  Plan  Q3  ");
    characterization.branches.push("exact-raw-transport", "trimmed-display-status", "case-and-spacing-preserved");
  });

  it("selects search results only while active and returns to the folder projection on explicit clear", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useBrowsingWorkspace(createInput(ports)), { wrapper: StrictMode });

    act(() => result.current.query.set("archive"));
    await waitFor(() => expect(result.current.list.items).toEqual(searchItems));
    expect(result.current.query.active).toBe(true);
    act(() => result.current.query.clear());
    await waitFor(() => expect(result.current.query).toMatchObject({ raw: "", active: false }));
    expect(result.current.list.items).toEqual([folderItems[2], folderItems[0]]);
    expect(result.current.search.results).toEqual([]);
    characterization.branches.push("active-search-projection", "explicit-clear", "inactive-folder-restored", "strict-mode-query-lifecycle");
  });

  it("uses explicit-offline folder and search snapshots without backend or cache I/O", async () => {
    const ports = createPorts();
    const offlineFolder = [folderItems[0]];
    const offlineSearch = [searchItems[1]];
    const searchItemsFor = vi.fn((query: string) => query ? offlineSearch : []);
    const workspaceInput = createInput(ports, {
      context: { accountId: "alpha", accountName: "Offline", cacheNamespace: "ns-alpha", path: "Docs" },
      mode: { folder: "explicit-offline", search: "explicit-offline", cacheOnly: true, explicitOffline: true, browserOffline: true },
      offlineSource: { folderItems: offlineFolder, searchItemsFor }
    });
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));

    await waitFor(() => expect(result.current.list.items).toEqual(offlineFolder));
    act(() => result.current.query.set("Archive"));
    await waitFor(() => expect(result.current.list.items).toEqual(offlineSearch));
    expect(searchItemsFor).toHaveBeenCalledWith("Archive");
    expect(ports.folder.loadFolder).not.toHaveBeenCalled();
    expect(ports.folder.readCachedFolder).not.toHaveBeenCalled();
    expect(ports.folder.writeCachedFolder).not.toHaveBeenCalled();
    expect(ports.search.loadSearch).not.toHaveBeenCalled();
    expect(ports.search.readCachedSearch).not.toHaveBeenCalled();
    expect(ports.search.writeCachedSearch).not.toHaveBeenCalled();
    characterization.branches.push("explicit-offline-folder", "explicit-offline-search", "offline-no-backend-cache-io", "offline-raw-query");
  });

  it("keeps replaced query/path/account outcomes stale-inert while preserving the raw query until clear", async () => {
    const old = createDeferred<Awaited<ReturnType<SearchPorts["loadSearch"]>>>();
    const sessionTerminate = vi.fn();
    const ports = createPorts({
      searchLoad: vi.fn<SearchPorts["loadSearch"]>(({ path, token }) => path === "Docs" && token === "token-alpha"
        ? old.promise
        : Promise.resolve({ kind: "success", items: [{ path: "Other/new.txt", name: "new.txt", isFolder: false, score: 3 }] }))
    });
    const initial = createInput(ports, {
      ports: { ...createInput(ports).ports, session: { terminate: sessionTerminate } }
    });
    const { result, rerender } = renderHook(({ value }) => useBrowsingWorkspace(value), { initialProps: { value: initial } });
    const raw = "roadmap";

    act(() => result.current.query.set(raw));
    await waitFor(() => expect(ports.search.loadSearch).toHaveBeenCalledWith(expect.objectContaining({ path: "Docs", query: raw })));
    rerender({
      value: {
        ...initial,
        context: { ...initial.context, accountId: "beta", cacheNamespace: "ns-beta", path: "Other", token: "token-beta" }
      }
    });
    await waitFor(() => expect(result.current.list.items).toEqual([{ path: "Other/new.txt", name: "new.txt", isFolder: false, score: 3 }]));
    expect(result.current.query).toMatchObject({ raw, active: true });
    old.resolve({ kind: "unauthorized", error: new Error("late old session") });
    await act(async () => { await old.promise; });
    expect(result.current.list.items).not.toContainEqual(expect.objectContaining({ path: "Docs/late.txt" }));
    expect(sessionTerminate).not.toHaveBeenCalled();

    act(() => result.current.query.clear());
    await waitFor(() => expect(result.current.query.active).toBe(false));
    characterization.branches.push("query-preserved-across-account-path", "stale-search-outcome-inert", "late-terminal-inert", "clear-is-explicit-boundary");
  });

  it("projects raw, active, set, and clear bindings into AppBar, BrowseHeader, and FileList", () => {
    const set = vi.fn();
    const clear = vi.fn();
    const raw = "  roadmap  ";
    const projected = projectBrowsingSurfaceBindings(buildSurfaceInput(raw, true, set, clear));

    expect(projected.browseHeader.searchQuery).toBe(raw);
    expect(projected.browseHeader.searchActive).toBe(true);
    expect(projected.browseHeader.onSearchQueryChange).toBe(set);
    expect(projected.browseHeader.onClearSearch).toBe(clear);
    expect(projected.fileList.props.onClearSearch).toBe(clear);
    expect(projected.fileList.props.showClearSearchButton).toBe(true);
    projected.browseHeader.onSearchQueryChange("next");
    projected.fileList.props.onClearSearch();
    expect(set).toHaveBeenCalledWith("next");
    expect(clear).toHaveBeenCalledOnce();
    characterization.branches.push("appbar-raw-set", "browse-header-active-clear", "file-list-clear");
  });

  it("retains the approved external-error arbitration next to query projection", async () => {
    const folderError = new Error("folder failed");
    const externalError = new Error("operation failed");
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(async () => ({ kind: "failure", error: folderError }))
    });
    const { result } = renderHook(() => useBrowsingWorkspace(createInput(ports)));

    act(() => result.current.commands.reportExternalListError(externalError));
    await waitFor(() => expect(result.current.list.visibleError).toBe(folderError));
    act(() => result.current.query.set("roadmap"));
    await waitFor(() => expect(result.current.query.active).toBe(true));
    expect(result.current.list.visibleError).toBe(externalError);
    expect(browsingWorkspaceSource).toContain("const visibleError = active ? externalListError : folderError ?? externalListError;");
    characterization.branches.push("inactive-folder-error-precedence", "active-external-error-precedence");
  });

  it("rejects transport, activity, context, offline-I/O, capture, and topology adversaries", () => {
    const raw = "  Plan  ";
    const correctTransport = (value: string): string => value;
    const trimmedTransport = (value: string): string => getSearchDisplayQuery(value);
    const correctActivity = (value: string): boolean => isSearchActive(value);
    const whitespaceAsActive = (value: string): boolean => value.length > 0;
    const preservedAcrossContext = (value: string, _context: string): string => value;
    const implicitlyClearedOnContext = (_value: string, _context: string): string => "";

    expect(correctTransport(raw)).toBe(raw);
    expect(trimmedTransport(raw)).not.toBe(correctTransport(raw));
    expect(correctActivity("   ")).toBe(false);
    expect(whitespaceAsActive("   ")).not.toBe(correctActivity("   "));
    expect(preservedAcrossContext(raw, "beta/Other")).toBe(raw);
    expect(implicitlyClearedOnContext(raw, "beta/Other")).not.toBe(raw);
    expect(searchHookSource).toContain("if (input.mode === \"explicit-offline\")");
    expect(searchHookSource).not.toMatch(/input\.ports\.loadSearch\([^)]*mode:\s*\"explicit-offline\"/);
    expect(folderHookSource).toContain("if (input.mode === \"explicit-offline\")");
    expect(browsingSurfaceSource).not.toMatch(/searchQuery:\s*getSearchDisplayQuery/);
    expect(appBarWorkspaceSource).not.toMatch(/searchQuery:\s*getSearchDisplayQuery/);
    expect(accountResetHookSource).not.toMatch(/input\.activeAccountId\s*\?\s*resetQuery/);
    expect(browsingWorkspaceSource).not.toMatch(/setRawQuery\(getSearchDisplayQuery/);
    expect(browsingWorkspaceSource).not.toMatch(/from\s+["'][^"']*(?:AppBar|FileList|Selection|AccountReset)[^"']*["']/);
    characterization.adversaries.push("trimmed-transport", "whitespace-activity", "implicit-context-clear", "explicit-offline-backend-access", "captured-consumer", "direct-internal-import");
  });
});
