// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildAccount } from "../../../../test/accounts";
import { buildFileEntry } from "../../../../test/files";
import { createFavouriteEntry, createFavouritesService, type FavouritesPointerEnvironment } from "../../favourites";
import { createFakeFavouritesStorage } from "../../favourites/testing/fakeStorage";
import type { NavigationDrawerWorkspaceInput } from "./ports";
import { useNavigationDrawerWorkspace } from "./useNavigationDrawerWorkspace";

const NOW = "2026-08-05T00:00:00.000Z";

function pointerEnvironment(): FavouritesPointerEnvironment {
  return {
    elementFromPoint: () => null,
    addWindowListener: () => () => undefined
  };
}

function buildInput(overrides: Partial<NavigationDrawerWorkspaceInput["owners"]> = {}): NavigationDrawerWorkspaceInput {
  const account = buildAccount("alpha");
  const folder = createFavouriteEntry(buildFileEntry("Projects"), account, NOW);
  const service = createFavouritesService(createFakeFavouritesStorage(), { nowIso: () => NOW });
  service.save(account, [folder]);
  return {
    owners: {
      account: { operationalActiveAccount: account, activeAccountName: "Alpha", activeCacheNamespace: account.cacheNamespace, totalAccountCount: 1 },
      session: { token: "token" },
      bootstrap: { cacheOnlyMode: false, workerUnavailable: false },
      connectivity: { offline: false },
      browsing: { presentation: { breadcrumbs: [], locationLabel: "Alpha" }, commands: { reportExternalListError: vi.fn(), clearExternalListError: vi.fn() } },
      navigation: { currentPath: "", navigationDrawerOpen: true, closeChrome: vi.fn(), navigateToPath: vi.fn() },
      offline: { explicitOfflineMode: false, setExplicitOfflineMode: vi.fn(), projectVisibleFavourites: <T extends { path: string; isFolder: boolean }>(entries: readonly T[]) => entries },
      operation: { capabilities: { canCreateFolder: true, canUploadFiles: true, canUploadFolders: true }, mutation: { state: { busy: false } }, commands: { openCreateFolder: vi.fn() }, upload: { uploadFiles: vi.fn(async () => undefined) } },
      status: { commands: { announce: vi.fn() } },
      services: { favourites: service, favouritesPointerEnvironment: pointerEnvironment(), favouriteResolveRuntime: { listFiles: vi.fn(async () => ({ completeness: "complete" as const, items: [buildFileEntry("Projects")] })), cacheFolder: vi.fn() } },
      ...overrides
    },
    ports: { openPreview: vi.fn(async () => undefined), openSettings: vi.fn(), toDisplayPath: (path) => path ? `/${path}` : "/", directoryUploadInputRef: vi.fn() }
  };
}

describe("useNavigationDrawerWorkspace", () => {
  it("omits the drawer binding when no account is available", () => {
    const input = buildInput({ account: { operationalActiveAccount: undefined, activeAccountName: "", activeCacheNamespace: undefined, totalAccountCount: 0 } });
    const { result } = renderHook(() => useNavigationDrawerWorkspace(input));
    expect(result.current.binding).toBeUndefined();
  });

  it.each(["settings", "file-upload", "folder-upload"] as const)("closes exactly once before the %s command", async (action) => {
    const input = buildInput();
    const fileFiles = [new File(["file"], "file.txt")];
    const folderFiles = [new File(["folder"], "folder.txt")];
    const events: string[] = [];
    vi.mocked(input.owners.navigation.closeChrome).mockImplementation(() => events.push("close"));
    vi.mocked(input.ports.openSettings).mockImplementation(() => events.push("settings"));
    vi.mocked(input.owners.operation.upload.uploadFiles).mockImplementation(async (files) => {
      events.push(files === fileFiles ? "upload-files" : "upload-folder");
    });
    const { result } = renderHook(() => useNavigationDrawerWorkspace(input));
    await waitFor(() => expect(result.current.binding?.props.entries).toHaveLength(1));
    const binding = result.current.binding;
    if (!binding) throw new Error("expected drawer binding");
    await act(async () => {
      if (action === "settings") binding.props.onOpenSettings();
      else if (action === "file-upload") await binding.props.onUploadFiles(fileFiles);
      else await binding.props.onUploadFolder(folderFiles);
    });
    const close = vi.mocked(input.owners.navigation.closeChrome);
    const uploadFiles = vi.mocked(input.owners.operation.upload.uploadFiles);
    const expected = action === "settings" ? ["close", "settings"] : ["close", action === "file-upload" ? "upload-files" : "upload-folder"];
    expect(events).toEqual(expected);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("navigation");
    expect(uploadFiles).toHaveBeenCalledTimes(action === "settings" ? 0 : 1);
    if (action === "file-upload") expect(uploadFiles).toHaveBeenCalledWith(fileFiles);
    if (action === "folder-upload") expect(uploadFiles).toHaveBeenCalledWith(folderFiles);
    expect(input.ports.openSettings).toHaveBeenCalledTimes(action === "settings" ? 1 : 0);
  });
});
