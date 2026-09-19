// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FileEntry, SearchResult } from "@davora/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FolderPorts } from "../folder/ports";
import { createMemoryFolderSortService } from "../folderSort/testing/fakeStorage";
import type { SearchPorts } from "../search/ports";
import { useBrowsingWorkspace, type BrowsingWorkspaceInput } from "./index";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const appCompositionPath = resolve(sourceDir, "../../../app/useBrowserWorkspaceComposition.tsx");
const browsingWorkspacePath = resolve(sourceDir, "./useBrowsingWorkspace.ts");
const navigationDrawerPath = resolve(sourceDir, "../navDrawer/workspace/useNavigationDrawerWorkspace.ts");
const offlineSyncWorkspacePath = resolve(sourceDir, "../../offline/sync/workspace/useOfflineSyncWorkspace.ts");
const previewWorkspacePath = resolve(sourceDir, "../../preview/workspace/usePreviewWorkspace.ts");
const accountResetPath = resolve(sourceDir, "../../accounts/reset/controller.ts");
const operationsWorkspacePath = resolve(sourceDir, "../../operations/workspace/index.ts");


const appSource = readFileSync(appCompositionPath, "utf8");
const browsingWorkspaceSource = readFileSync(browsingWorkspacePath, "utf8");
const navigationDrawerSource = readFileSync(navigationDrawerPath, "utf8");
const offlineSyncWorkspaceSource = readFileSync(offlineSyncWorkspacePath, "utf8");
const previewWorkspaceSource = readFileSync(previewWorkspacePath, "utf8");
const accountResetSource = readFileSync(accountResetPath, "utf8");
const operationsWorkspaceSource = readFileSync(operationsWorkspacePath, "utf8");

const folderItems: FileEntry[] = [
  { path: "Docs/visible.txt", name: "visible.txt", isFolder: false },
  { path: "Docs/Archive", name: "Archive", isFolder: true }
];
const searchItems: SearchResult[] = [
  { path: "Docs/visible.txt", name: "visible.txt", isFolder: false, score: 1 }
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
  return { folder, search, searchItemsFor: overrides.searchItemsFor ?? (() => searchItems) };
}

function createInput(ports = createPorts(), overrides: Partial<BrowsingWorkspaceInput> = {}): BrowsingWorkspaceInput {
  return {
    context: {
      accountId: "alpha",
      accountName: "Alpha",
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
      presentation: { setStatus: vi.fn() },
      folderSort: { service: createMemoryFolderSortService(), persistBaseline: vi.fn() }
    },
    ...overrides
  };
}

const count = (source: string, needle: string): number => source.split(needle).length - 1;

describe("Browsing external list-error arbitration characterization", () => {
  it("retains the original Error identity for inactive folder presentation", async () => {
    const ports = createPorts();
    const workspaceInput = createInput(ports);
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));
    const externalError = new Error("favourites listing failed");

    act(() => result.current.commands.reportExternalListError(externalError));
    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    expect(result.current.query.active).toBe(false);
    expect(result.current.list.visibleError).toBe(externalError);
    expect(result.current.presentation.empty.emptyStatus).toBe(externalError.message);
  });

  it("keeps folderError ahead of externalError while active search exposes only externalError", async () => {
    const folderError = new Error("folder refresh failed");
    const externalError = new Error("operation listing failed");
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(async () => ({ kind: "failure", error: folderError }))
    });
    const { result } = renderHook(() => useBrowsingWorkspace(createInput(ports)));

    act(() => result.current.commands.reportExternalListError(externalError));
    await waitFor(() => expect(result.current.folder.error).toBe(folderError));
    expect(result.current.list.visibleError).toBe(folderError);

    act(() => result.current.query.set("roadmap"));
    await waitFor(() => expect(result.current.query.active).toBe(true));
    expect(result.current.list.visibleError).toBe(externalError);
    expect(result.current.presentation.empty.emptyStatus).toBe(externalError.message);
  });

  it("suppresses routine folder status and clear work while external error exists, then restores status after clear", async () => {
    const setStatus = vi.fn();
    const ports = createPorts();
    const workspaceInput = createInput(ports, { ports: { ...createInput(ports).ports, presentation: { setStatus } } });
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));
    const externalError = new Error("operation failed");

    act(() => result.current.commands.reportExternalListError(externalError));
    const statusCallsAfterReport = setStatus.mock.calls.length;
    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    expect(setStatus.mock.calls.length).toBe(statusCallsAfterReport);
    expect(result.current.list.visibleError).toBe(externalError);

    act(() => result.current.commands.clearExternalListError());
    expect(setStatus).toHaveBeenCalledWith("Viewing /Docs in Alpha");
    expect(setStatus.mock.calls.length).toBeGreaterThan(statusCallsAfterReport);
  });

  it("retains the external error through account and path replacement until explicit clear", async () => {
    const externalError = new Error("operation failed");
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(async ({ path }) => ({
        kind: "success",
        items: [{ path: `${path}/replacement.txt`, name: "replacement.txt", isFolder: false }]
      }))
    });
    const initial = createInput(ports);
    const { result, rerender } = renderHook(({ value }) => useBrowsingWorkspace(value), { initialProps: { value: initial } });

    act(() => result.current.commands.reportExternalListError(externalError));
    await waitFor(() => expect(result.current.folder.state.kind).toBe("ready"));
    rerender({ value: {
      ...initial,
      context: { ...initial.context, accountId: "beta", cacheNamespace: "ns-beta", path: "Other", token: "token-beta" }
    } });
    await waitFor(() => expect(result.current.list.items).toEqual([{ path: "Other/replacement.txt", name: "replacement.txt", isFolder: false }]));
    expect(result.current.list.visibleError).toBe(externalError);

    act(() => result.current.commands.clearExternalListError());
    expect(result.current.list.visibleError).toBeUndefined();
  });

  it("keeps report and clear command identities stable and makes clear idempotent", async () => {
    const ports = createPorts();
    const workspaceInput = createInput(ports);
    const { result, rerender } = renderHook(({ value }) => useBrowsingWorkspace(value), { initialProps: { value: workspaceInput }, wrapper: StrictMode });
    const report = result.current.commands.reportExternalListError;
    const clear = result.current.commands.clearExternalListError;

    act(() => report(new Error("operation failed")));
    act(() => {
      clear();
      clear();
    });
    expect(result.current.list.visibleError).toBeUndefined();
    rerender({ value: workspaceInput });
    expect(result.current.commands.reportExternalListError).toBe(report);
    expect(result.current.commands.clearExternalListError).toBe(clear);
  });

  it("performs no folder, search, cache, network, or persistence I/O from report/clear commands", async () => {
    const searchItemsFor = vi.fn(() => [] as readonly SearchResult[]);
    const ports = createPorts({ searchItemsFor });
    const workspaceInput = createInput(ports, {
      context: { accountId: "alpha", accountName: "Offline", cacheNamespace: "ns-alpha", path: "Docs" },
      mode: { folder: "explicit-offline", search: "explicit-offline", cacheOnly: true, explicitOffline: true, browserOffline: true },
      offlineSource: { folderItems: folderItems, searchItemsFor }
    });
    const { result } = renderHook(() => useBrowsingWorkspace(workspaceInput));
    await waitFor(() => expect(result.current.folder.state.kind).toBe("offline"));
    const before = {
      folderLoad: vi.mocked(ports.folder.loadFolder).mock.calls.length,
      folderRead: vi.mocked(ports.folder.readCachedFolder).mock.calls.length,
      folderWrite: vi.mocked(ports.folder.writeCachedFolder).mock.calls.length,
      searchLoad: vi.mocked(ports.search.loadSearch).mock.calls.length,
      searchRead: vi.mocked(ports.search.readCachedSearch).mock.calls.length,
      searchWrite: vi.mocked(ports.search.writeCachedSearch).mock.calls.length,
      offlineSearch: searchItemsFor.mock.calls.length
    };

    act(() => result.current.commands.reportExternalListError(new Error("external")));
    act(() => result.current.commands.clearExternalListError());
    expect({
      folderLoad: vi.mocked(ports.folder.loadFolder).mock.calls.length,
      folderRead: vi.mocked(ports.folder.readCachedFolder).mock.calls.length,
      folderWrite: vi.mocked(ports.folder.writeCachedFolder).mock.calls.length,
      searchLoad: vi.mocked(ports.search.loadSearch).mock.calls.length,
      searchRead: vi.mocked(ports.search.readCachedSearch).mock.calls.length,
      searchWrite: vi.mocked(ports.search.writeCachedSearch).mock.calls.length,
      offlineSearch: searchItemsFor.mock.calls.length
    }).toEqual(before);
  });

  it("preserves report-versus-clear semantics across Operations, Offline Sync, Preview, Account Reset, and Navigation Drawer consumers", () => {
    expect(appSource).toContain("presentation: { clearListError: browsingCommands.clearExternalListError, reportListError: browsingCommands.reportExternalListError");
    expect(appSource).toContain("reportListError: browsingCommands.reportExternalListError");
    expect(appSource).toContain("clearListError: browsingCommands.clearExternalListError");
    expect(operationsWorkspaceSource).toContain("reportListError: input.coordination.presentation.reportListError");
    expect(offlineSyncWorkspaceSource).toContain("reportListError: input.coordination.reportListError");
    expect(previewWorkspaceSource).toContain("reportListError: (error: Error | undefined) => error");
    expect(previewWorkspaceSource).toContain("application.presentation.clearListError()");
    expect(accountResetSource).toContain("ports.browsing.clearListError();");
    expect(navigationDrawerSource).toContain("reportListError: (error) => error ? browsing.commands.reportExternalListError(error) : browsing.commands.clearExternalListError()");

    const report = vi.fn<(error: Error) => void>();
    const clear = vi.fn<() => void>();
    const consumerBinding = (error?: Error) => error ? report(error) : clear();
    const error = new Error("consumer error");
    consumerBinding(error);
    consumerBinding();
    expect(report).toHaveBeenCalledWith(error);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("rejects causal precedence, normalization, capture, bypass, and topology adversaries", () => {
    const folderError = new Error("folder");
    const externalError = new Error("external");
    const correct = (active: boolean, folder: Error | undefined, external: Error | undefined) => active ? external : folder ?? external;
    const swappedInactive = (_active: boolean, folder: Error | undefined, external: Error | undefined) => external ?? folder;
    const folderWinsActive = (active: boolean, folder: Error | undefined, external: Error | undefined) => active ? folder : folder ?? external;
    const normalized = (active: boolean, folder: Error | undefined, external: Error | undefined) => {
      const value = active ? external : folder ?? external;
      return value ? new Error(value.message) : undefined;
    };
    expect(correct(false, folderError, externalError)).toBe(folderError);
    expect(correct(true, folderError, externalError)).toBe(externalError);
    expect(swappedInactive(false, folderError, externalError)).not.toBe(correct(false, folderError, externalError));
    expect(folderWinsActive(true, folderError, externalError)).not.toBe(correct(true, folderError, externalError));
    expect(normalized(false, undefined, externalError)).not.toBe(externalError);

    expect(count(browsingWorkspaceSource, "setExternalListError(")).toBe(2);
    expect(browsingWorkspaceSource).not.toMatch(/setExternalListError\(new Error\(/);
    expect(browsingWorkspaceSource).not.toMatch(/reportExternalListError\s*=\s*async/);
    expect(browsingWorkspaceSource).not.toMatch(/setExternalListError\(error\.message\)/);
    expect(browsingWorkspaceSource).not.toMatch(/from\s+["'][^"']*(?:operations|preview|offline|accounts|navDrawer)[^"']*["']/);
    expect(navigationDrawerSource).not.toMatch(/reportListError:\s*\(error\)\s*=>\s*new Error/);
    expect(accountResetSource).not.toMatch(/ports\.browsing\.clearListError\s*=|clearListError\(\s*new/);
  });

  it("keeps stale folder outcomes inert after replacement and unmount under StrictMode", async () => {
    let resolveOld: ((outcome: Awaited<ReturnType<FolderPorts["loadFolder"]>>) => void) | undefined;
    const oldOutcome = new Promise<Awaited<ReturnType<FolderPorts["loadFolder"]>>>((resolve) => { resolveOld = resolve; });
    let first = true;
    const setStatus = vi.fn();
    const ports = createPorts({
      folderLoad: vi.fn<FolderPorts["loadFolder"]>(({ path }) => {
        if (first) {
          first = false;
          return oldOutcome;
        }
        return Promise.resolve({ kind: "success", items: [{ path: `${path}/new.txt`, name: "new.txt", isFolder: false }] });
      })
    });
    const initial = createInput(ports, { ports: { ...createInput(ports).ports, presentation: { setStatus } } });
    const externalError = new Error("operation failed");
    const { result, rerender, unmount } = renderHook(({ value }) => useBrowsingWorkspace(value), { initialProps: { value: initial }, wrapper: StrictMode });
    act(() => result.current.commands.reportExternalListError(externalError));
    const statusCallsAfterReport = setStatus.mock.calls.length;
    rerender({ value: { ...initial, context: { ...initial.context, path: "Other" } } });
    await waitFor(() => expect(result.current.list.items).toEqual([{ path: "Other/new.txt", name: "new.txt", isFolder: false }]));
    resolveOld?.({ kind: "success", items: folderItems });
    await act(async () => { await oldOutcome; });
    expect(result.current.list.items).not.toContainEqual(folderItems[0]);
    expect(result.current.list.visibleError).toBe(externalError);
    expect(setStatus.mock.calls.length).toBe(statusCallsAfterReport);
    unmount();
  });
});
