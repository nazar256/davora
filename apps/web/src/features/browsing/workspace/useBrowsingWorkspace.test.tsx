import type { FileEntry, SearchResult } from "@davora/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createDeferred } from "../../../test/primitives";
import type { FolderPorts } from "../folder/ports";
import { createMemoryFolderSortService } from "../folderSort/testing/fakeStorage";
import type { SearchPorts } from "../search/ports";
import { useBrowsingWorkspace, type BrowsingWorkspaceInput } from "./index";

const folderItems: FileEntry[] = [
  { path: "Docs/visible.txt", name: "visible.txt", isFolder: false },
  { path: "Docs/.hidden.txt", name: ".hidden.txt", isFolder: false },
  { path: "Docs/Archive", name: "Archive", isFolder: true }
];

const searchItems: SearchResult[] = [
  { path: "Docs/visible.txt", name: "visible.txt", isFolder: false, score: 2 },
  { path: "Docs/Archive", name: "Archive", isFolder: true, score: 1 }
];

const createPorts = (overrides: {
  folderLoad?: FolderPorts["loadFolder"];
  searchLoad?: SearchPorts["loadSearch"];
} = {}) => {
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
  return { folder, search };
};

const input = (ports = createPorts(), overrides: Partial<BrowsingWorkspaceInput> = {}): BrowsingWorkspaceInput => ({
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
    searchItemsFor: () => []
  },
  ports: {
    folder: ports.folder,
    search: ports.search,
    session: { terminate: vi.fn() },
    availability: { setWorkerUnavailable: vi.fn() },
    presentation: { setStatus: vi.fn() },
    folderSort: { service: createMemoryFolderSortService(), persistBaseline: vi.fn() }
  },
  ...overrides
});

describe("useBrowsingWorkspace contract", () => {
  it("keeps the raw query for transport while exposing trimmed, case-preserving active semantics", async () => {
    const ports = createPorts();
    const searchLoad = vi.mocked(ports.search.loadSearch);
    const { result } = renderHook(() => useBrowsingWorkspace(input(ports)));

    act(() => result.current.query.set("  Plan  Q3  "));
    await waitFor(() => expect(searchLoad).toHaveBeenCalledWith(expect.objectContaining({ query: "  Plan  Q3  " })));
    expect(result.current.query).toMatchObject({ raw: "  Plan  Q3  ", active: true });
    expect(result.current.presentation.browseStatusLabel).toContain("Plan  Q3");
  });

  it("keeps whitespace-only queries inactive and leaves the folder projection active", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useBrowsingWorkspace(input(ports)));

    act(() => result.current.query.set("   "));
    await waitFor(() => expect(result.current.list.items).toEqual([folderItems[2], folderItems[0]]));
    expect(result.current.query).toMatchObject({ raw: "   ", active: false });
    expect(ports.search.loadSearch).not.toHaveBeenCalled();
  });

  it("masks old folder and search results while a replacement context is pending", async () => {
    let resolveOldFolder: ((value: Awaited<ReturnType<FolderPorts["loadFolder"]>>) => void) | undefined;
    let resolveOldSearch: ((value: Awaited<ReturnType<SearchPorts["loadSearch"]>>) => void) | undefined;
    const oldFolder = new Promise<Awaited<ReturnType<FolderPorts["loadFolder"]>>>((resolve) => { resolveOldFolder = resolve; });
    const oldSearch = new Promise<Awaited<ReturnType<SearchPorts["loadSearch"]>>>((resolve) => { resolveOldSearch = resolve; });
    const terminate = vi.fn();
    const setWorkerUnavailable = vi.fn();
    const setStatus = vi.fn();
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(({ path }) => path === "Docs" ? oldFolder : Promise.resolve({ kind: "success", items: [folderItems[2]] })),
      searchLoad: vi.fn<SearchPorts["loadSearch"]>(({ path, query }) => path === "Docs" && query === "old"
        ? oldSearch
        : Promise.resolve({ kind: "success", items: [searchItems[0]] }))
    });
    const initialInput = input(ports, {
      ports: {
        ...input(ports).ports,
        session: { terminate },
        availability: { setWorkerUnavailable },
        presentation: { setStatus }
      }
    });
    const { result, rerender } = renderHook(({ workspaceInput }) => useBrowsingWorkspace(workspaceInput), {
      initialProps: { workspaceInput: initialInput }
    });

    act(() => result.current.query.set("old"));
    rerender({ workspaceInput: { ...initialInput, context: { ...initialInput.context, path: "New" } } });
    await waitFor(() => expect(result.current.list.items).toEqual([searchItems[0]]));
    const replacementItems = result.current.list.items;
    const availabilityCallsAfterReplacement = setWorkerUnavailable.mock.calls.length;
    const statusCallsAfterReplacement = setStatus.mock.calls.length;
    resolveOldFolder?.({ kind: "transient", error: new Error("old server") });
    resolveOldSearch?.({ kind: "unauthorized", error: new Error("old session") });
    await act(async () => { await oldFolder; await oldSearch; });
    expect(result.current.list.items).toEqual(replacementItems);
    expect(terminate).not.toHaveBeenCalled();
    expect(setWorkerUnavailable).toHaveBeenCalledTimes(availabilityCallsAfterReplacement);
    expect(setStatus).toHaveBeenCalledTimes(statusCallsAfterReplacement);
  });

  it.each(["accountId", "token", "path", "cacheNamespace", "mode"] as const)(
    "invalidates old reads when %s is replaced",
    async (dimension) => {
      const oldFolder = createDeferred<Awaited<ReturnType<FolderPorts["loadFolder"]>>>();
      let firstFolderLoad = true;
      const ports = createPorts({
        folderLoad: vi.fn<FolderPorts["loadFolder"]>(() => {
          if (firstFolderLoad) {
            firstFolderLoad = false;
            return oldFolder.promise;
          }
          return Promise.resolve({ kind: "success", items: [folderItems[2]] });
        })
      });
      const base = input(ports);
      const { result, rerender } = renderHook(({ workspaceInput }) => useBrowsingWorkspace(workspaceInput), {
        initialProps: { workspaceInput: base }
      });
      const replacement: BrowsingWorkspaceInput = {
        ...base,
        context: {
          ...base.context,
          ...(dimension === "accountId" ? { accountId: "beta" } : {}),
          ...(dimension === "token" ? { token: "token-beta" } : {}),
          ...(dimension === "path" ? { path: "Other" } : {}),
          ...(dimension === "cacheNamespace" ? { cacheNamespace: "ns-beta" } : {})
        },
        mode: dimension === "mode"
          ? { folder: "explicit-offline", search: "explicit-offline", cacheOnly: true, explicitOffline: true, browserOffline: true }
          : base.mode,
        offlineSource: { folderItems: [folderItems[2]], searchItemsFor: () => [] }
      };
      rerender({ workspaceInput: replacement });
      await waitFor(() => expect(result.current.list.items).toEqual([folderItems[2]]));
      oldFolder.resolve({ kind: "success", items: [folderItems[0]] });
      await act(async () => { await oldFolder.promise; });
      expect(result.current.list.items).not.toContainEqual(folderItems[0]);
    }
  );

  it("preserves cache-first folder semantics and forwards reload options", async () => {
    const cached = { items: [folderItems[2]], cachedAt: "2026-07-01T00:00:00.000Z" };
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(async () => ({ kind: "failure", error: new Error("refresh failed") }))
    });
    vi.mocked(ports.folder.readCachedFolder).mockReturnValue(cached);
    const { result } = renderHook(() => useBrowsingWorkspace(input(ports)));
    await waitFor(() => expect(result.current.list.items).toEqual([folderItems[2]]));
    expect(result.current.list.stale).toBe(true);
    await act(async () => { await result.current.commands.reload({ preferCache: false, announceStatus: false }); });
    expect(ports.folder.readCachedFolder).toHaveBeenCalledTimes(1);
    expect(ports.folder.loadFolder).toHaveBeenCalledTimes(2);
  });

  it("does not republish folder status on an unrelated rerender", async () => {
    const ports = createPorts();
    const workspaceInput = input(ports);
    const { result, rerender } = renderHook(({ value }) => useBrowsingWorkspace(value), {
      initialProps: { value: workspaceInput }
    });
    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    const statusCalls = vi.mocked(workspaceInput.ports.presentation.setStatus).mock.calls.length;
    rerender({ value: workspaceInput });
    expect(workspaceInput.ports.presentation.setStatus).toHaveBeenCalledTimes(statusCalls);
  });

  it("projects folder sorting/filtering, search relevance, breadcrumbs, and list banner", async () => {
    const ports = createPorts();
    const workspaceInput = input(ports, {
      settings: { showHiddenFiles: false, sortMode: "name-asc" },
      context: { ...input(ports).context, path: "Docs/Plans" }
    });
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));

    await waitFor(() => expect(result.current.list.items).toEqual([folderItems[2], folderItems[0]]));
    expect(result.current.presentation.breadcrumbs.map((item) => item.value)).toEqual(["", "Docs", "Docs/Plans"]);
    expect(result.current.presentation.inlineBanner).toEqual({ kind: "idle", message: "" });

    act(() => result.current.query.set("plan"));
    await waitFor(() => expect(result.current.list.items).toEqual(searchItems));
    expect(result.current.presentation.browseStatusLabel).toBe("2 results for “plan” in /Docs/Plans");
  });

  it("uses injected explicit-offline sources without backend or cache I/O", async () => {
    const ports = createPorts();
    const offlineFolder = [folderItems[0]];
    const offlineSearch = [searchItems[1]];
    const workspaceInput = input(ports, {
      mode: { folder: "explicit-offline", search: "explicit-offline", cacheOnly: true, explicitOffline: true, browserOffline: true },
      context: { ...input(ports).context, token: undefined },
      offlineSource: { folderItems: offlineFolder, searchItemsFor: () => offlineSearch }
    });
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));
    await waitFor(() => expect(result.current.list.items).toEqual(offlineFolder));
    act(() => result.current.query.set("archive"));
    await waitFor(() => expect(result.current.list.items).toEqual(offlineSearch));
    expect(ports.folder.loadFolder).not.toHaveBeenCalled();
    expect(ports.folder.readCachedFolder).not.toHaveBeenCalled();
    expect(ports.search.loadSearch).not.toHaveBeenCalled();
    expect(ports.search.readCachedSearch).not.toHaveBeenCalled();
  });

  it.each(["unauthorized", "reconnect-required"] as const)("routes current search %s to the session bridge exactly once", async (kind) => {
    const terminate = vi.fn();
    const ports = createPorts({
      searchLoad: vi.fn<SearchPorts["loadSearch"]>(async () => ({ kind, error: new Error(kind) }))
    });
    const workspaceInput = input(ports, {
      ports: {
        ...input(ports).ports,
        session: { terminate }
      }
    });
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput), { wrapper: StrictMode });

    act(() => result.current.query.set("roadmap"));
    await waitFor(() => expect(terminate).toHaveBeenCalledWith("search", kind));
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(ports.search.readCachedSearch).not.toHaveBeenCalled();
  });

  it("isolates external list errors and exposes current-context session/availability ports", async () => {
    const terminate = vi.fn();
    const setWorkerUnavailable = vi.fn();
    const folderLoad = vi.fn<FolderPorts["loadFolder"]>(async () => ({ kind: "unauthorized", error: new Error("expired") }));
    const ports = createPorts({ folderLoad });
    const workspaceInput = input(ports, {
      ports: {
        ...input(ports).ports,
        session: { terminate },
        availability: { setWorkerUnavailable },
        presentation: { setStatus: vi.fn() }
      }
    });
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));
    act(() => result.current.commands.reportExternalListError(new Error("operation listing failed")));
    await waitFor(() => expect(terminate).toHaveBeenCalledWith("folder", "unauthorized"));
    expect(result.current.list.visibleError?.message).toBe("operation listing failed");
    expect(result.current.presentation.empty.emptyStatus).toBe("operation listing failed");
    expect(setWorkerUnavailable).not.toHaveBeenCalledWith(false);
  });

  it("does not overwrite an external list error with normal folder status", async () => {
    const setStatus = vi.fn();
    const ports = createPorts();
    const workspaceInput = input(ports, { ports: { ...input(ports).ports, presentation: { setStatus } } });
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));
    act(() => result.current.commands.reportExternalListError(new Error("operation listing failed")));
    const statusCallsAfterReport = setStatus.mock.calls.length;
    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    expect(setStatus.mock.calls.length).toBe(statusCallsAfterReport);
  });

  it("keeps a folder error visible ahead of an external error while retaining the external value", async () => {
    const folderError = new Error("folder cache miss");
    const externalError = new Error("operation failed");
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(async () => ({ kind: "failure", error: folderError }))
    });
    const workspaceInput = input(ports);
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));
    act(() => result.current.commands.reportExternalListError(externalError));

    await waitFor(() => expect(result.current.folder.error).toBe(folderError));
    expect(result.current.list.visibleError).toBe(folderError);
    expect(result.current.presentation.empty.emptyStatus).toBe(folderError.message);
  });

  it("uses the external error for active search even when the folder has its own error", async () => {
    const folderError = new Error("folder failed");
    const externalError = new Error("search operation failed");
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(async () => ({ kind: "failure", error: folderError }))
    });
    const workspaceInput = input(ports);
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));
    act(() => result.current.commands.reportExternalListError(externalError));

    await waitFor(() => expect(result.current.folder.error).toBe(folderError));
    act(() => result.current.query.set("plan"));
    await waitFor(() => expect(result.current.query.active).toBe(true));

    expect(result.current.list.visibleError).toBe(externalError);
    expect(result.current.presentation.empty.emptyStatus).toBe(externalError.message);
  });

  it("does not clear or overwrite an external error during routine folder transitions, then resumes normal status after clearing", async () => {
    const setStatus = vi.fn();
    const externalError = new Error("operation failed");
    const ports = createPorts();
    const workspaceInput = input(ports, {
      ports: { ...input(ports).ports, presentation: { setStatus } }
    });
    const { result } = renderHook(({ value }) => useBrowsingWorkspace(value), {
      initialProps: { value: workspaceInput }
    });
    act(() => result.current.commands.reportExternalListError(externalError));

    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    const statusCallsBeforeClear = setStatus.mock.calls.length;
    expect(result.current.list.visibleError).toBe(externalError);

    act(() => result.current.commands.clearExternalListError());
    expect(setStatus).toHaveBeenCalledWith("Viewing /Docs in Work");
    expect(setStatus.mock.calls.length).toBeGreaterThan(statusCallsBeforeClear);
  });

  it("retains an external error through path and account replacement until an explicit clear", async () => {
    const externalError = new Error("operation failed");
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(async ({ path }) => ({
        kind: "success",
        items: [{ path: `${path}/replacement.txt`, name: "replacement.txt", isFolder: false }]
      }))
    });
    const initial = input(ports);
    const { result, rerender } = renderHook(({ value }) => useBrowsingWorkspace(value), {
      initialProps: { value: initial }
    });
    act(() => result.current.commands.reportExternalListError(externalError));

    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    const replacement = {
      ...initial,
      context: { ...initial.context, accountId: "beta", cacheNamespace: "ns-beta", path: "Other" }
    };
    rerender({ value: replacement });
    await waitFor(() => expect(result.current.list.items).toEqual([
      { path: "Other/replacement.txt", name: "replacement.txt", isFolder: false }
    ]));
    expect(result.current.list.visibleError).toBe(externalError);
  });

  it("keeps superseded late folder outcomes inert and exposes stable commands under StrictMode", async () => {
    const deferred = createDeferred<Awaited<ReturnType<FolderPorts["loadFolder"]>>>();
    const ports = createPorts({ folderLoad: vi.fn(() => deferred.promise) });
    const workspaceInput = input(ports);
    const setStatus = vi.mocked(workspaceInput.ports.presentation.setStatus);
    const { result, rerender, unmount } = renderHook(({ value }) => useBrowsingWorkspace(value), {
      initialProps: { value: workspaceInput },
      wrapper: StrictMode
    });
    act(() => result.current.commands.reportExternalListError(new Error("operation failed")));
    const statusCallsAfterReport = setStatus.mock.calls.length;
    const reload = result.current.commands.reload;
    const replacement = { ...workspaceInput, context: { ...workspaceInput.context, path: "Other" } };
    rerender({ value: replacement });
    expect(result.current.commands.reload).toBe(reload);
    deferred.resolve({ kind: "success", items: folderItems });
    await act(async () => { await deferred.promise; });
    expect(setStatus.mock.calls.length).toBe(statusCallsAfterReport);
    unmount();
  });

  it("keeps external-error commands stable and makes clear idempotent", async () => {
    const ports = createPorts();
    const workspaceInput = input(ports);
    const { result, rerender } = renderHook(({ value }) => useBrowsingWorkspace(value), {
      initialProps: { value: workspaceInput }
    });
    const report = result.current.commands.reportExternalListError;
    const clear = result.current.commands.clearExternalListError;

    act(() => report(new Error("operation failed")));
    expect(result.current.list.visibleError?.message).toBe("operation failed");
    act(() => {
      clear();
      clear();
    });
    expect(result.current.list.visibleError).toBeUndefined();

    rerender({ value: workspaceInput });
    expect(result.current.commands.reportExternalListError).toBe(report);
    expect(result.current.commands.clearExternalListError).toBe(clear);
  });

  it("characterizes the cross-producer precedence and ordering matrix", async () => {
    const externalError = new Error("external transfer failed");
    const folderError = new Error("folder failed");
    const setStatus = vi.fn();
    const deferred = createDeferred<Awaited<ReturnType<FolderPorts["loadFolder"]>>>();
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(async ({ path }) => path === "Docs" ? { kind: "failure", error: folderError } : deferred.promise)
    });
    const base = input(ports, {
      ports: { ...input(ports).ports, presentation: { setStatus } }
    });
    const { result, rerender } = renderHook(({ value }) => useBrowsingWorkspace(value), {
      initialProps: { value: base }
    });
    act(() => result.current.commands.reportExternalListError(externalError));
    const statusCallsAfterReport = setStatus.mock.calls.length;

    await waitFor(() => expect(result.current.list.visibleError).toBe(folderError));
    act(() => result.current.query.set("plan"));
    await waitFor(() => expect(result.current.list.visibleError).toBe(externalError));

    rerender({ value: {
      ...base,
      context: { ...base.context, path: "Other" },
      mode: { ...base.mode, folder: "explicit-offline", search: "explicit-offline", cacheOnly: true, explicitOffline: true, browserOffline: true },
      offlineSource: { folderItems: [], searchItemsFor: () => [] }
    }});
    await waitFor(() => expect(result.current.presentation.inlineBanner.kind).toBe("offline"));

    rerender({ value: {
      ...base,
      context: { ...base.context, path: "Later" },
      mode: { ...base.mode, folder: "online", search: "online" },
    }});
    await waitFor(() => expect(result.current.presentation.inlineBanner.kind).toBe("loading"));
    deferred.resolve({ kind: "success", items: folderItems });
    await act(async () => { await deferred.promise; });
    expect(setStatus.mock.calls.length).toBe(statusCallsAfterReport);
  });
});
