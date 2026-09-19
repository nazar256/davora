// @vitest-environment jsdom

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import { createBrowserAppServices } from "../../../app/createBrowserAppServices";
import { buildAccount } from "../../../test/accounts";
import { buildFileEntry } from "../../../test/files";
import { createDeferred } from "../../../test/primitives";
import { createBrowsingCacheRepository } from "../cache";
import { FavouritesStage } from "../favourites/FavouritesStage";
import { createFavouriteActionsPorts } from "../favourites/createFavouriteActionsPorts";
import { createFavouriteEntry, type FavouriteEntry } from "../favourites/model";
import { createFavouritesService } from "../favourites/service";
import { createFakeFavouritesStorage } from "../favourites/testing/fakeStorage";
import { useFavouriteActions } from "../favourites/useFavouriteActions";
import { createBrowserFavouriteResolveRuntime } from "../../../platform/api/browserFavouriteResolveRuntime";
import type { FavouritesPointerEnvironment } from "../favourites/ports";
import { NavDrawerStage } from "./NavDrawerStage";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const presentationSource = readFileSync(resolve(process.cwd(), "src/app/useAppWorkspacePresentation.ts"), "utf8");
const factorySource = readFileSync(resolve(process.cwd(), "src/app/createBrowserAppServices.ts"), "utf8");
const servicesSource = readFileSync(resolve(process.cwd(), "src/app/AppServices.ts"), "utf8");
const workspacePath = resolve(process.cwd(), "src/features/browsing/navDrawer/workspace");
const navDrawerIndexSource = readFileSync(resolve(process.cwd(), "src/features/browsing/navDrawer/index.ts"), "utf8");
const browsingIndexSource = readFileSync(resolve(process.cwd(), "src/features/browsing/index.ts"), "utf8");

const NOW = "2026-08-05T00:00:00.000Z";

function createPorts() {
  const listFiles = vi.fn(async (_path: string, _token: string) => ({ items: [] as readonly FileEntry[] }));
  const cacheFolder = vi.fn();
  const closeNavigationChrome = vi.fn();
  const navigateToPath = vi.fn();
  const openFile = vi.fn(async (_entry: FileEntry, _options: { readonly preferFolderAudioPlayer: boolean }) => undefined);
  const setStatus = vi.fn();
  const reportListError = vi.fn();
  const ports = createFavouriteActionsPorts({
    listFiles,
    cacheFolder,
    toDisplayPath: (path) => (path ? `/${path}` : "/"),
    closeNavigationChrome,
    navigateToPath,
    openFile,
    setStatus,
    reportListError
  });
  return { ports, listFiles, cacheFolder, closeNavigationChrome, navigateToPath, openFile, setStatus, reportListError };
}

function pointerEnvironment() {
  const listeners: Array<{ type: "pointermove" | "pointerup" | "pointercancel"; removed: boolean; listener: (event: PointerEvent) => void }> = [];
  const environment: FavouritesPointerEnvironment & { readonly listeners: typeof listeners } = {
    elementFromPoint: () => null,
    addWindowListener(type, listener) {
      const record = { type, listener, removed: false };
      listeners.push(record);
      return () => { record.removed = true; };
    },
    listeners
  };
  return environment;
}

function favourite(accountId: string, path: string, isFolder = false): FavouriteEntry {
  const account = buildAccount(accountId);
  return createFavouriteEntry({ path, name: path.split("/").at(-1) ?? path, isFolder }, account, NOW);
}

describe("Phase 4C navigation-drawer/favourites characterization", () => {
  it("loads account-scoped entries and replaces them on Alpha/Beta/Alpha context changes", async () => {
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const storage = createFakeFavouritesStorage({
      "davora-favourites:alpha": JSON.stringify([favourite("alpha", "Alpha.txt")]),
      "davora-favourites:beta": JSON.stringify([favourite("beta", "Beta.txt")])
    });
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const { result, rerender } = renderHook(({ account }) => useFavouriteActions({
      account,
      service,
      token: `token-${account?.id}`,
      cacheOnlyMode: false,
      cacheNamespace: account?.cacheNamespace,
      ports: createPorts().ports
    }), { initialProps: { account: alpha } });

    await waitFor(() => expect(result.current.entries.map((entry) => entry.path)).toEqual(["Alpha.txt"]));
    rerender({ account: beta });
    await waitFor(() => expect(result.current.entries.map((entry) => entry.path)).toEqual(["Beta.txt"]));
    rerender({ account: alpha });
    await waitFor(() => expect(result.current.entries.map((entry) => entry.path)).toEqual(["Alpha.txt"]));
    expect(storage.readKeys).toEqual(["davora-favourites:alpha", "davora-favourites:beta", "davora-favourites:alpha"]);
  });

  it.each(["success", "failure"] as const)("keeps stale Alpha %s completion inert after Alpha/Beta/Alpha replacement and StrictMode replay", async (outcome) => {
    const pending = createDeferred<{ readonly items: readonly FileEntry[] }>();
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const storage = createFakeFavouritesStorage({ "davora-favourites:alpha": JSON.stringify([favourite("alpha", "Projects", true)]) });
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const ports = createPorts();
    ports.listFiles.mockImplementation(() => pending.promise);
    const { result, rerender, unmount } = renderHook(({ account }) => useFavouriteActions({
      account,
      service,
      token: `token-${account.id}`,
      cacheOnlyMode: false,
      cacheNamespace: account.cacheNamespace,
      ports: ports.ports
    }), { initialProps: { account: alpha }, wrapper: StrictMode });

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const openPromise = result.current.openFavourite(result.current.entries[0]);
    rerender({ account: beta });
    rerender({ account: alpha });
    if (outcome === "success") {
      pending.resolve({ items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    } else {
      pending.reject(new Error("alpha-late-failure"));
    }
    await act(async () => { await openPromise; });
    expect(ports.closeNavigationChrome).not.toHaveBeenCalled();
    expect(ports.navigateToPath).not.toHaveBeenCalled();
    expect(ports.cacheFolder).not.toHaveBeenCalled();
    expect(ports.reportListError).not.toHaveBeenCalled();

    const second = createDeferred<{ readonly items: readonly FileEntry[] }>();
    ports.listFiles.mockImplementation(() => second.promise);
    const lateOpen = result.current.openFavourite(result.current.entries[0]);
    unmount();
    second.resolve({ items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    await act(async () => { await lateOpen; });
    expect(ports.closeNavigationChrome).not.toHaveBeenCalled();
  });

  it("keeps stale work inert when the same account receives a replacement token/session", async () => {
    const pending = createDeferred<{ readonly items: readonly FileEntry[] }>();
    const account = buildAccount("alpha");
    const service = createFavouritesService(
      createFakeFavouritesStorage({ "davora-favourites:alpha": JSON.stringify([favourite("alpha", "Projects", true)]) }),
      { nowIso: () => NOW }
    );
    const ports = createPorts();
    ports.listFiles.mockImplementation(() => pending.promise);
    const { result, rerender } = renderHook(({ token }) => useFavouriteActions({
      account,
      service,
      token,
      cacheOnlyMode: false,
      cacheNamespace: account.cacheNamespace,
      ports: ports.ports
    }), { initialProps: { token: "session-alpha-1" }, wrapper: StrictMode });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const openPromise = result.current.openFavourite(result.current.entries[0]);
    rerender({ token: "session-alpha-2" });
    pending.resolve({ items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    await act(async () => { await openPromise; });
    expect(ports.listFiles).toHaveBeenCalledWith("", "session-alpha-1");
    expect(ports.closeNavigationChrome).not.toHaveBeenCalled();
    expect(ports.navigateToPath).not.toHaveBeenCalled();
    expect(ports.cacheFolder).not.toHaveBeenCalled();
  });

  it("resolves folders through the captured token/cache namespace and files through preview", async () => {
    const account = buildAccount("alpha");
    const storage = createFakeFavouritesStorage();
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const ports = createPorts();
    const { result } = renderHook(() => useFavouriteActions({
      account,
      service,
      token: "sentinel-token",
      cacheOnlyMode: false,
      cacheNamespace: "ns-alpha",
      ports: ports.ports
    }));
    act(() => { result.current.toggleFavourite({ path: "Projects", name: "Projects", isFolder: true }); });
    act(() => { result.current.toggleFavourite({ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, mimeType: "text/plain" }); });
    const folder = result.current.entries.find((entry) => entry.isFolder)!;
    const file = result.current.entries.find((entry) => !entry.isFolder)!;
    ports.listFiles
      .mockResolvedValueOnce({ items: [{ path: "Projects", name: "Projects", isFolder: true }] })
      .mockResolvedValueOnce({ items: [{ path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, mimeType: "text/plain" }] });
    await act(async () => { await result.current.openFavourite(folder); });
    expect(ports.listFiles).toHaveBeenCalledWith("", "sentinel-token");
    expect(ports.cacheFolder).toHaveBeenCalledWith("ns-alpha", "", expect.any(Array));
    expect(ports.closeNavigationChrome).toHaveBeenCalledTimes(1);
    expect(ports.navigateToPath).toHaveBeenCalledWith("Projects");

    await act(async () => { await result.current.openFavourite(file); });
    expect(ports.listFiles).toHaveBeenCalledWith("Projects", "sentinel-token");
    expect(ports.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "Projects/roadmap.txt" }), { preferFolderAudioPlayer: true });
    expect(ports.closeNavigationChrome).toHaveBeenCalledTimes(2);
  });

  it("uses cached-shell/offline resolution without a backend request and marks unavailable entries", async () => {
    const account = buildAccount("alpha");
    const storage = createFakeFavouritesStorage();
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const offlinePorts = createPorts();
    const { result } = renderHook(() => useFavouriteActions({
      account,
      service,
      token: "token-alpha",
      cacheOnlyMode: true,
      cacheNamespace: "ns-alpha",
      ports: offlinePorts.ports
    }));
    act(() => { result.current.toggleFavourite({ path: "Cached.txt", name: "Cached.txt", isFolder: false }); });
    await act(async () => { await result.current.openFavourite(result.current.entries[0]); });
    expect(offlinePorts.listFiles).not.toHaveBeenCalled();
    expect(offlinePorts.cacheFolder).not.toHaveBeenCalled();
    expect(offlinePorts.openFile).toHaveBeenCalledTimes(1);

    const onlinePorts = createPorts();
    onlinePorts.listFiles.mockResolvedValue({ items: [] });
    const onlineService = createFavouritesService(
      createFakeFavouritesStorage({ "davora-favourites:alpha": JSON.stringify([favourite("alpha", "Missing.txt")]) }),
      { nowIso: () => NOW }
    );
    const online = renderHook(() => useFavouriteActions({
      account,
      service: onlineService,
      token: "token-alpha",
      cacheOnlyMode: false,
      cacheNamespace: "ns-alpha",
      ports: onlinePorts.ports
    }));
    await waitFor(() => expect(online.result.current.entries).toHaveLength(1));
    await act(async () => { await online.result.current.openFavourite(online.result.current.entries[0]); });
    expect(onlinePorts.closeNavigationChrome).not.toHaveBeenCalled();
    expect(online.result.current.entries[0]?.unavailableReason).toMatch(/no longer available/);
    expect(onlinePorts.setStatus).toHaveBeenCalledWith(expect.stringContaining("Favourite unavailable"));
  });

  it("preserves toggle/remove/reorder persistence, duplicate identity, and storage failure semantics", async () => {
    const account = buildAccount("alpha");
    const storage = createFakeFavouritesStorage();
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const ports = createPorts();
    const { result } = renderHook(() => useFavouriteActions({ account, service, cacheOnlyMode: false, ports: ports.ports }));
    const file = { path: "Docs/readme.txt", name: "readme.txt", isFolder: false } satisfies FileEntry;
    act(() => { result.current.toggleFavourite(file); });
    act(() => { result.current.toggleFavourite(file); });
    expect(result.current.entries).toHaveLength(0);
    act(() => { result.current.toggleFavourite({ path: "A", name: "A", isFolder: true }); });
    act(() => { result.current.toggleFavourite({ path: "B", name: "B", isFolder: true }); });
    act(() => { result.current.reorderFavourites("folder:B", "folder:A"); });
    expect(result.current.entries.map((entry) => entry.path)).toEqual(["B", "A"]);
    const removable = result.current.entries[0];
    act(() => { result.current.removeFavourite(removable); });
    expect(result.current.entries.map((entry) => entry.path)).toEqual(["A"]);
    storage.failWrite = true;
    act(() => { result.current.toggleFavourite({ path: "Cannot-save", name: "Cannot-save", isFolder: false }); });
    expect(result.current.entries.map((entry) => entry.path)).toEqual(["A"]);
    expect(ports.reportListError).toHaveBeenCalledWith(expect.objectContaining({ message: "Unable to save Favourites: write failed" }));
    expect(ports.setStatus).toHaveBeenCalledWith("Unable to save Favourites in this browser.");
    expect(storage.deletedKeys).not.toContain("davora-favourites:beta");
  });

  it("keeps the pointer interaction owned by FavouritesStage and cleans listeners on close/reopen/unmount", () => {
    const environment = pointerEnvironment();
    const entry = favourite("alpha", "Projects", true);
    const props = {
      entries: [entry],
      offlineMode: false,
      pointerEnvironment: environment,
      onOpen: vi.fn(),
      onRemove: vi.fn(),
      onReorder: vi.fn()
    };
    const { rerender, unmount } = render(<FavouritesStage {...props} />);
    const handle = screen.getByRole("button", { name: /Drag Projects favourite/i });
    Object.defineProperty(handle, "setPointerCapture", { configurable: true, value: vi.fn() });
    const pointerDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });
    fireEvent(handle, pointerDown);
    expect(environment.listeners).toHaveLength(3);
    rerender(<FavouritesStage {...props} pointerEnvironment={pointerEnvironment()} />);
    expect(environment.listeners.every(({ removed }) => removed)).toBe(true);
    unmount();
  });

  it("binds drawer status, breadcrumbs, favourite projection, and capabilities without leaking sentinel secrets", () => {
    const token = "drawer-secret-token";
    const error = "raw drawer error secret";
    const folder = favourite("alpha", "Projects", true);
    const onClose = vi.fn();
    const onOpenSettings = vi.fn();
    const onUploadFiles = vi.fn();
    const onUploadFolder = vi.fn();
    const onNavigateToPath = vi.fn();
    const inputRef = vi.fn();
    render(<NavDrawerStage
      open
      onClose={onClose}
      accountName="Alpha workspace"
      locationLabel="/Projects"
      offline={false}
      workerUnavailable={false}
      explicitOfflineMode={false}
      cacheOnlyMode={false}
      onToggleOffline={vi.fn()}
      entries={[folder]}
      offlineMode={false}
      pointerEnvironment={pointerEnvironment()}
      onOpen={vi.fn()}
      onRemove={vi.fn()}
      onReorder={vi.fn()}
      breadcrumbs={[{ label: "Home", ariaLabel: "Go home", value: "" }, { label: "Projects", ariaLabel: "Go Projects", value: "Projects" }]}
      currentPath="Projects"
      onNavigateToPath={onNavigateToPath}
      canCreateFolder={false}
      canUploadFiles={true}
      canUploadFolders={true}
      mutationBusy={false}
      onCreateFolder={vi.fn()}
      onUploadFiles={onUploadFiles}
      onUploadFolder={onUploadFolder}
      onOpenSettings={onOpenSettings}
      directoryUploadInputRef={inputRef}
    />);
    const drawer = screen.getByRole("complementary", { name: /Navigation menu/i });
    expect(drawer).toHaveTextContent("Alpha workspace");
    expect(drawer).toHaveTextContent("Online");
    const folderNavigation = within(drawer).getByRole("navigation", { name: /Folder navigation/i });
    expect(within(folderNavigation).getByRole("button", { name: /^Projects$/i })).toHaveAttribute("aria-current", "page");
    expect(within(drawer).getByRole("button", { name: /Create folder/i })).toBeDisabled();
    expect(drawer.textContent).not.toContain(token);
    expect(drawer.textContent).not.toContain(error);
    expect(window.location.href).not.toContain(token);
    fireEvent.click(within(drawer).getByRole("button", { name: /Profile & settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(within(folderNavigation).getByRole("button", { name: /^Projects$/i }));
    expect(onNavigateToPath).toHaveBeenCalledWith("Projects");
  });

  it("uses one browser cache repository identity for folder/search consumers and no second storage owner", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }))
    });
    const services = createBrowserAppServices();
    const folder = buildFileEntry("Projects/readme.txt");
    services.folder.writeCachedFolder("ns-alpha", "Projects", [folder]);
    expect(services.browsingCache.readFolder("ns-alpha", "Projects")).toMatchObject({ kind: "hit", items: [folder] });
    expect(services.folder).not.toBe(services.search);
    expect(factorySource.match(/createBrowsingCacheRepository\(/g) ?? []).toHaveLength(1);
    expect(factorySource).toContain("browsingCache");
    expect(servicesSource).toContain("browsingCache: BrowsingCacheRepository");
  });

  it("requires one injected FavouriteResolveRuntimePort with exact request/cache semantics", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, media: "(max-width: 900px)", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }))
    });
    const services = createBrowserAppServices();
    expect(servicesSource).toMatch(/FavouriteResolveRuntimePort/);
    expect(factorySource).toMatch(/favouriteResolveRuntime/);
    const runtime = services.favouriteResolveRuntime;
    const responseItems = [buildFileEntry("Projects/readme.txt")];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { path: "Projects", items: responseItems } }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(runtime.listFiles("Projects", "runtime-token")).resolves.toEqual({ items: responseItems });
    expect(fetchMock).toHaveBeenCalled();
    const writeFolder = vi.spyOn(services.browsingCache, "writeFolder");
    runtime.cacheFolder("ns-alpha", "Projects", responseItems);
    expect(writeFolder).toHaveBeenCalledWith("ns-alpha", "Projects", responseItems);
    expect(services.browsingCache.readFolder("ns-alpha", "Projects")).toMatchObject({ kind: "hit", items: responseItems });
    fetchMock.mockRestore();
  });

  it("redacts token and raw resolve errors across current sinks while preserving authorized request token", async () => {
    const token = "drawer-token-sentinel";
    const rawError = "drawer-raw-error-sentinel";
    const account = buildAccount("alpha");
    const storage = createFakeFavouritesStorage();
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const ports = createPorts();
    ports.listFiles.mockImplementation(async (_path, receivedToken) => {
      expect(receivedToken).toBe(token);
      throw new Error(rawError);
    });
    const runtime = createBrowserFavouriteResolveRuntime(createBrowsingCacheRepository({
      readItem: () => ({ ok: true, value: null }),
      writeItem: () => ({ ok: true, value: undefined }),
      listKeys: () => ({ ok: true, value: [] }),
      deleteItem: () => ({ ok: true, value: undefined })
    }, { nowIso: () => NOW }), {
      listFiles: (path, receivedToken) => ports.listFiles(path, receivedToken)
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const actionsRef = { current: null as ReturnType<typeof useFavouriteActions> | null };
    function RedactionHarness() {
      const [status, setStatus] = useState("");
      const [reported, setReported] = useState("");
      const harnessPorts = useMemo(() => {
        const next = createPorts();
        next.setStatus.mockImplementation((message: string) => setStatus(message));
        next.reportListError.mockImplementation((reportedError: Error) => {
          setReported(reportedError.message);
          console.error("favourites", reportedError);
        });
        next.listFiles.mockImplementation(runtime.listFiles);
        next.cacheFolder.mockImplementation((namespace, path, items) => {
          ports.cacheFolder(namespace, path, items);
        });
        return next;
      }, []);
      const actions = useFavouriteActions({ account, service, token, cacheOnlyMode: false, cacheNamespace: account.cacheNamespace, ports: harnessPorts.ports });
      actionsRef.current = actions;
      return <div><output data-testid="redaction-status">{status}</output><output data-testid="redaction-report">{reported}</output></div>;
    }
    render(<RedactionHarness />);
    await waitFor(() => expect(actionsRef.current?.entries).toHaveLength(0));
    act(() => { actionsRef.current?.toggleFavourite({ path: "Missing.txt", name: "Missing.txt", isFolder: false }); });
    await waitFor(() => expect(actionsRef.current?.entries).toHaveLength(1));
    await act(async () => { await actionsRef.current?.openFavourite(actionsRef.current.entries[0]); });
    expect(ports.listFiles).toHaveBeenCalledWith("", token);
    expect(screen.getByTestId("redaction-status")).not.toHaveTextContent(rawError);
    expect(screen.getByTestId("redaction-report")).not.toHaveTextContent(rawError);
    expect(ports.cacheFolder).not.toHaveBeenCalled();
    expect(JSON.stringify(ports.cacheFolder.mock.calls)).not.toContain(token);
    expect(JSON.stringify(ports.cacheFolder.mock.calls)).not.toContain(rawError);
    expect(JSON.stringify(storage.values)).not.toContain(rawError);
    expect(JSON.stringify(storage.values)).not.toContain(token);
    const consoleArguments = consoleError.mock.calls.flat().map((value) => typeof value === "string" ? value : JSON.stringify(value));
    expect(consoleArguments.join(" ")).not.toContain(rawError);
    expect(consoleError.mock.calls.flat().some((value) => value instanceof Error && value.message.includes(rawError))).toBe(false);
    expect(window.location.href).not.toContain(token);
    consoleError.mockRestore();
  });
});

describe("Phase 4C navigation-drawer application retirement tripwires", () => {
  it("records close-before-action ordering and no-account drawer omission", () => {
    const parentSource = readFileSync(resolve(workspacePath, "useNavigationDrawerWorkspace.ts"), "utf8");
    expect(parentSource).toMatch(/account\.totalAccountCount\s*>\s*0\s*&&\s*account\.operationalActiveAccount/);
    expect(parentSource).toContain('navigation.closeChrome("navigation")');
    expect(parentSource).toContain("operation.upload.uploadFiles(files)");
  });

  it("routes selection favourite parity through the drawer workspace API", () => {
    expect(presentationSource).toContain("navigationDrawerWorkspace.favourites.isFavourite");
    expect(presentationSource).toContain("navigationDrawerWorkspace.favourites.toggle");
  });

  it("requires one public drawer/favourites workspace parent and grouped App wiring", () => {
    expect(existsSync(workspacePath)).toBe(true);
    expect(presentationSource).toContain("useNavigationDrawerWorkspace");
    const callSource = presentationSource.match(/const navigationDrawerWorkspace = useNavigationDrawerWorkspace\([\s\S]*?\n\s*\}\);/)?.[0] ?? "";
    expect(callSource).toMatch(/account:\s*accountContext/);
    expect(callSource).toMatch(/session(?:\s*[:,])/);
    expect(callSource).toMatch(/bootstrap(?:\s*[:,])/);
    expect(callSource).toMatch(/connectivity(?:\s*[:,])/);
    expect(callSource).toMatch(/browsing:\s*browsingWorkspace/);
    expect(callSource).toMatch(/navigation:\s*workspaceNavigation/);
    expect(callSource).toMatch(/offline:\s*offlineApplication/);
    expect(callSource).toMatch(/operation:\s*operationWorkspace/);
    expect(callSource).toMatch(/status(?:\s*[:,])/);
    expect(callSource).toMatch(/services/);
    expect(callSource).toMatch(/openPreview:[\s\S]*openSettings:[\s\S]*toDisplayPath(?:\s*[:,])[\s\S]*directoryUploadInputRef/);
    expect(callSource).not.toMatch(/(?:activeAccount:|breadcrumbs:|canUploadFiles:|reportListError:|setStatus:|favourites:|resolveRuntime:)/);
    expect((presentationSource.match(/useNavigationDrawerWorkspace\s*\(/g) ?? []).length).toBe(1);
  });

  it("retires App's raw favourite resolve/cache graph and leaf-level drawer assembly", () => {
    expect(appSource).not.toContain("createFavouriteActionsPorts");
    expect(appSource).not.toContain("useFavouriteActions");
    expect(appSource).not.toContain("const projectedFavourites");
    expect(appSource).not.toContain("const navigationDrawerBindings");
    expect(appSource).not.toContain("from \"./lib/api\";");
    expect(appSource).not.toContain("entries: projectedFavourites");
    expect(appSource).not.toContain("onOpen: (entry) => void favouriteActions.openFavourite(entry)");
  });

  it("keeps the parent public and free of sibling internals, providers, global stores, and WebDAV deletion", () => {
    expect(existsSync(workspacePath)).toBe(true);
    const workspaceFiles = readdirSync(workspacePath);
    const parentFile = workspaceFiles.find((file) => /workspace/i.test(file) && !file.includes(".test.") && /\.(ts|tsx)$/.test(file));
    expect(parentFile).toBeDefined();
    const parentSource = parentFile ? readFileSync(resolve(workspacePath, parentFile), "utf8") : "";
    expect(navDrawerIndexSource).toMatch(/workspace/);
    expect(browsingIndexSource).toMatch(/navDrawer/);
    expect(parentSource).not.toMatch(/from\s+["'](?:\.\.\/)+(?:operations|offline|preview|settings|accounts)(?:\/|["'])/);
    expect(parentSource).not.toMatch(/(?:createContext|useContext|zustand|redux|deleteFile|webdav|nextcloud)/i);
    expect(parentSource).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|indexedDB|Worker|setInterval)\b/);
    expect(parentSource).not.toMatch(/from\s+["']\.\.\/\.\.\/favourites\/(?:createFavouriteActionsPorts|model|ports|useFavouriteActions)["']/);
  });
});

// Keep the cache factory imported in this characterization so a future runtime test can
// replace the local construction without accidentally introducing a second cache owner.
void createBrowsingCacheRepository;
