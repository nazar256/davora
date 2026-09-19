import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AppShellCompositionInput } from "./projectAppShellComposition";
import type { AppBarWorkspaceInput, BrowsingSurfaceInput, NavigationDrawerWorkspaceInput, QuickActionsWorkspaceInput } from "../features/browsing";
import type { SelectionFileListBindingsInput, SelectionWorkspacePresentationInput } from "../features/operations";

const mocks = vi.hoisted(() => ({
  projectAppShellComposition: vi.fn<(input: AppShellCompositionInput) => unknown>(),
  projectBrowsingSurfaceBindings: vi.fn<(input: BrowsingSurfaceInput) => unknown>(),
  projectFileListSelectionBindings: vi.fn<(input: SelectionFileListBindingsInput) => unknown>(),
  projectSelectionWorkspacePresentation: vi.fn<(input: SelectionWorkspacePresentationInput) => unknown>(),
  useAppBarWorkspace: vi.fn<(input: AppBarWorkspaceInput) => unknown>(),
  useNavigationDrawerWorkspace: vi.fn<(input: NavigationDrawerWorkspaceInput) => unknown>(),
  useQuickActionsWorkspace: vi.fn<(input: QuickActionsWorkspaceInput) => unknown>()
}));

vi.mock("./projectAppShellComposition", () => ({ projectAppShellComposition: mocks.projectAppShellComposition }));
vi.mock("../features/browsing", () => ({
  projectBrowsingSurfaceBindings: mocks.projectBrowsingSurfaceBindings,
  useAppBarWorkspace: mocks.useAppBarWorkspace,
  useNavigationDrawerWorkspace: mocks.useNavigationDrawerWorkspace,
  useQuickActionsWorkspace: mocks.useQuickActionsWorkspace
}));
vi.mock("../features/operations", () => ({
  projectFileListSelectionBindings: mocks.projectFileListSelectionBindings,
  projectSelectionWorkspacePresentation: mocks.projectSelectionWorkspacePresentation
}));

import { useAppWorkspacePresentation, type AppWorkspacePresentationInput } from "./useAppWorkspacePresentation";

describe("useAppWorkspacePresentation", () => {
  it("projects drawer, selection, browsing, app-bar, settings, and shell branches from public owners", () => {
    const navigationDrawerBinding = { key: "account-1", props: { marker: "drawer" } };
    const appBarBinding = { marker: "app-bar" };
    const fileListSelection = { marker: "file-list-selection" };
    const selectionDetails = { marker: "selection-details" };
    const selectionPresentation = { detailsStage: selectionDetails, showDetailsRail: true, marker: "selection", selectionModeActive: false };
    const browseHeader = { marker: "browse-header" };
    const browsingFileList = { marker: "browsing-file-list" };
    const shell = { marker: "app-shell" };
    const quickActions = { marker: "quick-actions" };
    const openChrome = vi.fn();
    const closeChrome = vi.fn();
    const openPreview = vi.fn(async () => undefined);
    const openFolderShortcut = vi.fn();
    const favouriteToggle = vi.fn();
    const selectedEntry = { path: "/photo.jpg", name: "photo.jpg", isFolder: false };

    mocks.useNavigationDrawerWorkspace.mockReturnValue({
      binding: navigationDrawerBinding,
      favourites: { entries: [], isFavourite: () => true, toggle: favouriteToggle }
    });
    mocks.useQuickActionsWorkspace.mockReturnValue({ binding: { props: quickActions } });
    mocks.projectFileListSelectionBindings.mockReturnValue(fileListSelection);
    mocks.projectSelectionWorkspacePresentation.mockReturnValue(selectionPresentation);
    mocks.projectBrowsingSurfaceBindings.mockReturnValue({ browseHeader, fileList: browsingFileList });
    mocks.useAppBarWorkspace.mockReturnValue({ binding: appBarBinding });
    mocks.projectAppShellComposition.mockReturnValue(shell);

    const inputFixture = {
      account: {
        context: {
          registryNotice: "registry notice",
          operationalAccounts: [],
          operationalActiveAccount: { id: "account-1", name: "Cloud", baseUrl: "https://cloud.example.test", username: "user" },
          managementActiveAccount: undefined,
          pendingRemovalAccounts: [],
          totalAccountCount: 1
        },
        session: { token: "opaque" },
        bootstrap: {
          gate: { kind: "continue" },
          gateError: "bootstrap error",
          restoreStage: { marker: "restore" },
          unlockStage: { marker: "unlock" },
          workerUnavailable: false
        },
        actions: {
          commands: { marker: "account-commands" },
          snapshot: { surface: "none" },
          stages: {
            bootstrapConnect: { marker: "bootstrap-connect" },
            connectDialog: { marker: "connect-dialog" },
            removeDialog: { marker: "remove-dialog" }
          }
        }
      },
      browsing: {
        workspace: {
          list: { items: [selectedEntry] },
          presentation: { folderLabel: "Photos", locationLabel: "Cloud / Photos", folderCachedAt: "today", inlineBanner: { marker: "banner" } },
          query: { active: false, raw: "" }
        },
        load: { loadFolder: vi.fn() }
      },
      navigation: {
        workspace: { closeChrome, navigateToPath: vi.fn(), openChrome, mobileDetailsOpen: false, showSettingsDialog: true, navigationDrawerOpen: false, mobileSearchOpen: false, transferOpen: false, quickActionsOpen: false },
        surface: { pullToRefresh: { shell: { marker: "pull-shell" } } },
        viewport: { isNarrowScreen: false }
      },
      offline: {
        application: { explicitOfflineMode: false, settingsCache: { marker: "settings-cache" }, shellToggle: vi.fn() },
        sync: { commands: { open: vi.fn() }, snapshot: { busy: false, dialog: undefined }, stage: { marker: "offline-sync" } }
      },
      operation: {
        workspace: {
          capabilities: { canDownloadSelected: true },
          commands: { openCopyMove: vi.fn(), openCopyMoveSelection: vi.fn(), openDelete: vi.fn(), openDeleteSelection: vi.fn(), openMove: vi.fn() },
          download: { downloadBatch: vi.fn(), downloadFocused: vi.fn() },
          mutation: { stage: { marker: "mutation" }, state: { busy: false, surface: { kind: "none" } } }
        },
        selection: {
          focused: { selectedEntry, mobileSubview: "actions", clear: vi.fn(), showMobileActions: vi.fn(), showMobileDetails: vi.fn() },
          batch: { archiveInput: { marker: "archive" }, capture: vi.fn(), clear: vi.fn(), entries: [], isSelected: vi.fn(() => false), summary: { count: 0 } }
        },
        interaction: { marker: "selection-interaction" }
      },
      folderShortcut: {
        commands: { open: openFolderShortcut },
        stage: { marker: "folder-shortcut" }
      },
      preview: {
        bridge: { openFile: openPreview, snapshot: () => ({ modal: { selected: undefined } }) },
        folderAudio: { hasPlayer: true, interaction: { marker: "folder-audio" } },
        modal: { previewOpen: false },
        stage: { marker: "preview" }
      },
      settings: { preferences: { fileSizeDisplayMode: "binary" }, commands: { marker: "settings-commands" } },
      diagnostics: {
        settingsSection: { marker: "diagnostics-settings" },
        reportStage: { marker: "report-stage" }
      },
      runtime: {
        connectivity: { offline: false },
        pwa: { reloadPrompt: { marker: "reload" } },
        wakeLock: { state: "inactive" },
        transfers: { marker: "transfers" },
        status: { snapshot: { marker: "status" } }
      },
      services: {
        favourites: { marker: "favourites" },
        favouritesPointerEnvironment: { marker: "pointer" },
        favouriteResolveRuntime: { marker: "resolve" }
      },
      ports: {
        appBuildLabel: "test-build",
        directoryUploadInputRef: vi.fn(),
        folderAudioBrowsePanelClassName: () => "browse-panel-with-audio",
        toDisplayPath: (path: string) => path
      }
    };
    // The fixture is intentionally capability-minimal; downstream owners are mocked and their exact inputs are asserted below.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const input = inputFixture as unknown as AppWorkspacePresentationInput;

    const { result } = renderHook(() => useAppWorkspacePresentation(input));

    expect(result.current).toBe(shell);
    const navigationDrawerInput = mocks.useNavigationDrawerWorkspace.mock.calls[0][0];
    navigationDrawerInput.ports.openSettings();
    expect(openChrome).toHaveBeenCalledWith("settings");
    expect(navigationDrawerInput.owners.services).toBe(input.services);

    expect(mocks.projectFileListSelectionBindings).toHaveBeenCalledWith(expect.objectContaining({
      focusedEntry: selectedEntry,
      batchCount: 0,
      interaction: input.operation.interaction
    }));
    const selectionInput = mocks.projectSelectionWorkspacePresentation.mock.calls[0][0];
    expect(selectionInput.commands.openFolderShortcut).toBe(openFolderShortcut);
    expect(selectionInput.favourite.selected).toBe(true);
    selectionInput.favourite.toggle(selectionInput.selection.focusedEntry!);
    expect(favouriteToggle).toHaveBeenCalledWith(selectedEntry);

    const browsingInput = mocks.projectBrowsingSurfaceBindings.mock.calls[0][0];
    expect(browsingInput.owners.selection).toEqual(expect.objectContaining({
      fileList: fileListSelection,
      presentation: selectionPresentation,
      interaction: input.operation.interaction
    }));

    const shellInput = mocks.projectAppShellComposition.mock.calls[0][0];
    expect(shellInput.common).toEqual(expect.objectContaining({ appBar: appBarBinding, navigationDrawer: navigationDrawerBinding }));
    expect(shellInput.workspace).toEqual(expect.objectContaining({
      browseHeader,
      fileList: browsingFileList,
      selectionDetails,
      quickActions,
      browsePanelClassName: "browse-panel-with-audio"
    }));
    const quickActionsInput = mocks.useQuickActionsWorkspace.mock.calls[0][0];
    expect(quickActionsInput.owners.navigation).toBe(input.navigation.workspace);
    expect(quickActionsInput.owners.operation).toBe(input.operation.workspace);
    expect(quickActionsInput.owners.viewport).toBe(input.navigation.viewport);
    expect(quickActionsInput.owners.surfaces).toEqual(expect.objectContaining({
      settingsOpen: true,
      mutationSurfaceOpen: false,
      previewOpen: false,
      accountSurfaceOpen: false,
      offlineSyncOpen: false,
      selectionModeActive: false
    }));
    expect(quickActionsInput.ports.directoryUploadInputRef).toBe(input.ports.directoryUploadInputRef);
    expect(shellInput.settings).toEqual(expect.objectContaining({ open: true, closeChrome }));
    shellInput.settings.closeChrome("settings");
    expect(closeChrome).toHaveBeenCalledWith("settings");
  });
});
