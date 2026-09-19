import { act, renderHook, waitFor } from "@testing-library/react";
import { forwardRef, startTransition, useImperativeHandle, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import { buildAccount } from "../../../test/accounts";
import { createDeferred } from "../../../test/primitives";
import { createFavouriteActionsPorts, type CreateFavouriteActionsPortsInput } from "./createFavouriteActionsPorts";
import { createFavouritesService } from "./service";
import { createFakeFavouritesStorage } from "./testing/fakeStorage";
import { useFavouriteActions } from "./useFavouriteActions";

const NOW = "2026-07-16T20:00:00.000Z";

function createPorts() {
  const listFiles = vi.fn<CreateFavouriteActionsPortsInput["listFiles"]>(async () => ({ items: [] }));
  const cacheFolder = vi.fn();
  const toDisplayPath = vi.fn((path: string) => (path ? `/${path}` : "/"));
  const closeNavigationChrome = vi.fn();
  const navigateToPath = vi.fn();
  const openFile = vi.fn(async () => undefined);
  const setStatus = vi.fn();
  const reportListError = vi.fn();
  const ports = createFavouriteActionsPorts({
    listFiles,
    cacheFolder,
    toDisplayPath,
    closeNavigationChrome,
    navigateToPath,
    openFile,
    setStatus,
    reportListError
  });
  return {
    ports,
    listFiles,
    cacheFolder,
    closeNavigationChrome,
    navigateToPath,
    openFile,
    setStatus,
    reportListError
  };
}

describe("useFavouriteActions", () => {
  it("surfaces load failures through list error and browser status", async () => {
    const { ports, reportListError, setStatus } = createPorts();
    const service = createFavouritesService(createFakeFavouritesStorage({}, { failRead: true }), { nowIso: () => NOW });

    renderHook(() => useFavouriteActions({
      account: buildAccount("alpha"),
      service,
      cacheOnlyMode: false,
      ports
    }));

    await waitFor(() => {
      expect(reportListError).toHaveBeenCalledWith(new Error("Unable to load Favourites: read failed"));
      expect(setStatus).toHaveBeenCalledWith("Unable to load Favourites in this browser.");
    });
  });

  it("exposes toggle, remove, reorder, and open through the favourites controller", async () => {
    const { ports, listFiles, closeNavigationChrome, navigateToPath, setStatus } = createPorts();
    const service = createFavouritesService(createFakeFavouritesStorage(), { nowIso: () => NOW });
    const { result } = renderHook(() => useFavouriteActions({
      account: buildAccount("alpha"),
      service,
      token: "session",
      cacheOnlyMode: false,
      cacheNamespace: "alpha-cache",
      ports
    }));

    act(() => {
      result.current.toggleFavourite({ path: "Projects", name: "Projects", isFolder: true });
    });
    expect(setStatus).toHaveBeenCalledWith("Added Projects to Favourites.");

    const favourite = result.current.entries[0];
    if (!favourite) {
      throw new Error("Expected a favourite entry.");
    }

    listFiles.mockResolvedValue({
      items: [{ path: "Projects", name: "Projects", isFolder: true } satisfies FileEntry]
    });
    await act(async () => {
      await result.current.openFavourite(favourite);
    });
    expect(closeNavigationChrome).toHaveBeenCalled();
    expect(navigateToPath).toHaveBeenCalledWith("Projects");

    act(() => {
      result.current.removeFavourite(favourite);
    });
    expect(setStatus).toHaveBeenCalledWith("Removed Projects from Favourites. The original item was not deleted.");

    act(() => {
      result.current.toggleFavourite({ path: "Docs", name: "Docs", isFolder: true });
      result.current.reorderFavourites("folder:Docs", "folder:Projects");
    });
    expect(result.current.entries.map((entry) => entry.path)).toEqual(["Docs"]);
  });

  it.each(["success", "failure"] as const)("ignores a stale Alpha open after replacing the current owner with Beta (%s)", async (outcome) => {
    const pending = createDeferred<{ readonly items: readonly FileEntry[] }>();
    const storage = createFakeFavouritesStorage({
      "davora-favourites:alpha": JSON.stringify([{ path: "Projects", name: "Projects", isFolder: true }])
    });
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const alphaPorts = createPorts();
    alphaPorts.listFiles.mockImplementation(() => pending.promise);
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    const { result, rerender } = renderHook(({ account }) => useFavouriteActions({
      account,
      service,
      token: `token-${account.id}`,
      cacheOnlyMode: false,
      cacheNamespace: account.cacheNamespace,
      ports: alphaPorts.ports
    }), { initialProps: { account: alpha } });

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const entry = result.current.entries[0];
    if (!entry) {
      throw new Error("Expected Alpha favourite entry.");
    }
    const openPromise = result.current.openFavourite(entry);
    const valuesBeforeSettlement = [...storage.values.entries()];
    rerender({ account: beta });

    if (outcome === "success") {
      pending.resolve({ items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    } else {
      pending.reject(new Error("Alpha list failed"));
    }
    await act(async () => { await openPromise; });

    expect(alphaPorts.reportListError).not.toHaveBeenCalled();
    expect(alphaPorts.setStatus).not.toHaveBeenCalledWith(expect.stringContaining("Favourite unavailable"));
    expect(alphaPorts.closeNavigationChrome).not.toHaveBeenCalled();
    expect(alphaPorts.navigateToPath).not.toHaveBeenCalled();
    expect(alphaPorts.cacheFolder).not.toHaveBeenCalled();
    expect(alphaPorts.openFile).not.toHaveBeenCalled();
    expect(storage.values).toEqual(new Map(valuesBeforeSettlement));
  });

  it("ignores an Alpha open that settles after the favourites owner unmounts", async () => {
    const pending = createDeferred<{ readonly items: readonly FileEntry[] }>();
    const storage = createFakeFavouritesStorage({
      "davora-favourites:alpha": JSON.stringify([{ path: "Projects", name: "Projects", isFolder: true }])
    });
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const alphaPorts = createPorts();
    alphaPorts.listFiles.mockImplementation(() => pending.promise);
    const { result, unmount } = renderHook(() => useFavouriteActions({
      account: buildAccount("alpha"),
      service,
      token: "token-alpha",
      cacheOnlyMode: false,
      cacheNamespace: "ns-alpha",
      ports: alphaPorts.ports
    }));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const entry = result.current.entries[0];
    if (!entry) {
      throw new Error("Expected Alpha favourite entry.");
    }
    const openPromise = result.current.openFavourite(entry);
    const valuesBeforeSettlement = [...storage.values.entries()];
    unmount();
    pending.resolve({ items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    await act(async () => { await openPromise; });

    expect(alphaPorts.reportListError).not.toHaveBeenCalled();
    expect(alphaPorts.setStatus).not.toHaveBeenCalledWith(expect.stringContaining("Favourite unavailable"));
    expect(alphaPorts.closeNavigationChrome).not.toHaveBeenCalled();
    expect(alphaPorts.navigateToPath).not.toHaveBeenCalled();
    expect(alphaPorts.cacheFolder).not.toHaveBeenCalled();
    expect(alphaPorts.openFile).not.toHaveBeenCalled();
    expect(storage.values).toEqual(new Map(valuesBeforeSettlement));
  });

  it("keeps committed Alpha open current when an abandoned Beta render suspends", async () => {
    const pending = createDeferred<{ readonly items: readonly FileEntry[] }>();
    const betaGate = createDeferred<void>();
    const storage = createFakeFavouritesStorage({
      "davora-favourites:alpha": JSON.stringify([{ path: "Projects", name: "Projects", isFolder: true }])
    });
    const service = createFavouritesService(storage, { nowIso: () => NOW });
    const alphaPorts = createPorts();
    alphaPorts.listFiles.mockImplementation(() => pending.promise);
    const alpha = buildAccount("alpha");
    const beta = buildAccount("beta");
    type Actions = ReturnType<typeof useFavouriteActions>;
    type HarnessProps = { account: typeof alpha; suspend?: boolean };
    const actionsRef = { current: null } as MutableRefObject<Actions | null>;
    const Harness = forwardRef<Actions, HarnessProps>(({ account, suspend = false }, ref) => {
      const actions = useFavouriteActions({
        account,
        service,
        token: `token-${account.id}`,
        cacheOnlyMode: false,
        cacheNamespace: account.cacheNamespace,
        ports: alphaPorts.ports
      });
      useImperativeHandle(ref, () => actions, [actions]);
      if (suspend) {
        throw betaGate.promise;
      }
      return null;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<Harness account={alpha} ref={actionsRef} />); });
    await waitFor(() => expect(actionsRef.current?.entries).toHaveLength(1));
    const entry = actionsRef.current?.entries[0];
    if (!entry || !actionsRef.current) {
      throw new Error("Expected committed Alpha favourite entry.");
    }
    const openPromise = actionsRef.current.openFavourite(entry);

    act(() => {
      startTransition(() => root.render(<Harness account={beta} suspend ref={actionsRef} />));
    });
    pending.resolve({ items: [{ path: "Projects", name: "Projects", isFolder: true }] });
    await act(async () => { await openPromise; });

    expect(alphaPorts.cacheFolder).toHaveBeenCalledWith("ns-alpha", "", expect.any(Array));
    expect(alphaPorts.navigateToPath).toHaveBeenCalledWith("Projects");
    expect(alphaPorts.reportListError).not.toHaveBeenCalled();
    expect(alphaPorts.setStatus).not.toHaveBeenCalledWith(expect.stringContaining("Favourite unavailable"));
    betaGate.resolve();
    await act(async () => { root.unmount(); });
    container.remove();
  });
});
