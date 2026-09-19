import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_UI_SETTINGS } from "../model";
import { SettingsDialogStage } from "./SettingsDialogStage";
import { buildAccount } from "../../../test/accounts";

function buildProps(overrides: Partial<ComponentProps<typeof SettingsDialogStage>> = {}) {
  const alpha = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace" });
  const beta = buildAccount("beta", { displayName: "Beta workspace", label: "Beta workspace" });

  return {
    open: true,
    accounts: [alpha, beta],
    activeAccount: alpha,
    activeAccountId: alpha.id,
    appBuildLabel: "test-build",
    connectedAccountCount: 2,
    offline: false,
    backendActionsDisabled: false,
    cacheSummary: { itemCount: 1, totalBytes: 128, limitBytes: 256 * 1024 * 1024 },
    closeActionLabel: "Close",
    fileSizeDisplayMode: DEFAULT_UI_SETTINGS.fileSizeDisplayMode,
    themeMode: DEFAULT_UI_SETTINGS.themeMode,
    maxCacheableFileSizeBytes: DEFAULT_UI_SETTINGS.maxCacheableFileSizeBytes,
    previewFreshnessIntervalSeconds: DEFAULT_UI_SETTINGS.previewFreshnessIntervalSeconds,
    keepAwakeEnabled: true,
    keepAwakeState: "idle" as const,
    offlineItems: [],
    onClearCache: vi.fn(),
    onRemoveOfflineItem: vi.fn(),
    onClose: vi.fn(),
    onActiveAccountChange: vi.fn(),
    onOpenAddAccount: vi.fn(),
    onOpenReconnect: vi.fn(),
    onOpenRemove: vi.fn(),
    onOpenedFileCacheLimitChange: vi.fn(),
    onMaxCacheableFileSizeChange: vi.fn(),
    onPreviewFreshnessIntervalChange: vi.fn(),
    onKeepAwakeEnabledChange: vi.fn(),
    onThemeModeChange: vi.fn(),
    showHiddenFiles: false,
    onShowHiddenFilesChange: vi.fn(),
    experimentalHeicPreviewEnabled: false,
    onExperimentalHeicPreviewEnabledChange: vi.fn(),
    diagnosticsEnabled: false,
    onDiagnosticsEnabledChange: vi.fn(),
    diagnostics: {
      onOpenReport: vi.fn(),
      onClearData: vi.fn()
    },
    ...overrides
  };
}

function getDialog() {
  return screen.getByRole("dialog", { name: /Profile and settings/i });
}

describe("SettingsDialogStage", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(<SettingsDialogStage {...buildProps({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders dialog chrome when open", () => {
    render(<SettingsDialogStage {...buildProps()} />);

    const dialog = getDialog();
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(within(dialog).getByRole("heading", { name: /Profile & settings/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Close$/i })).toBeInTheDocument();
    expect(within(dialog).getByTestId("app-build-label")).toHaveTextContent("test-build");
  });

  it("shows pending removal records as retryable management actions without making them selectable", () => {
    const alpha = buildAccount("alpha", { displayName: "Pending Alpha", label: "Pending Alpha" });
    const beta = buildAccount("beta", { displayName: "Operational Beta", label: "Operational Beta" });
    const onOpenRemove = vi.fn();
    render(<SettingsDialogStage {...buildProps({
      accounts: [beta],
      activeAccount: undefined,
      activeAccountId: beta.id,
      managementActiveAccount: alpha,
      onOpenRemove,
      pendingRemovalAccounts: [{ account: alpha, phase: "purge" }]
    })} />);

    const dialog = getDialog();
    expect(dialog).toHaveTextContent(/Removal pending for Pending Alpha/i);
    expect(within(dialog).getByText(/browser cleanup/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Retry removal/i })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Active account")).not.toHaveTextContent("Pending Alpha");
    fireEvent.click(within(dialog).getByRole("button", { name: /Retry removal/i }));
    expect(onOpenRemove).toHaveBeenCalledTimes(1);
  });

  it("emits close from header button and scrim dismissal", () => {
    const onClose = vi.fn();
    const onDismissFromScrim = vi.fn();

    const { container } = render(
      <SettingsDialogStage
        {...buildProps({
          onClose,
          onDismissFromScrim
        })}
      />
    );

    fireEvent.click(within(getDialog()).getByRole("button", { name: /^Close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    const scrim = container.querySelector(".settings-modal-scrim");
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim!);
    expect(onDismissFromScrim).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to onClose when scrim is clicked without onDismissFromScrim", () => {
    const onClose = vi.fn();

    const { container } = render(<SettingsDialogStage {...buildProps({ onClose, onDismissFromScrim: undefined })} />);
    fireEvent.click(container.querySelector(".settings-modal-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("emits account selector and account action events without side effects", () => {
    const onActiveAccountChange = vi.fn();
    const onOpenAddAccount = vi.fn();
    const onOpenReconnect = vi.fn();
    const onOpenRemove = vi.fn();

    render(
      <SettingsDialogStage
        {...buildProps({
          onActiveAccountChange,
          onOpenAddAccount,
          onOpenReconnect,
          onOpenRemove
        })}
      />
    );

    const dialog = getDialog();
    fireEvent.change(within(dialog).getByLabelText(/Active account/i), { target: { value: "beta" } });
    expect(onActiveAccountChange).toHaveBeenCalledWith("beta");

    fireEvent.click(within(dialog).getByRole("button", { name: /^Add account$/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Reconnect$/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Remove$/i }));

    expect(onOpenAddAccount).toHaveBeenCalledTimes(1);
    expect(onOpenReconnect).toHaveBeenCalledTimes(1);
    expect(onOpenRemove).toHaveBeenCalledTimes(1);
  });

  it("shows offline workspace status and disables account actions when backend is disabled", () => {
    render(
      <SettingsDialogStage
        {...buildProps({
          offline: true,
          backendActionsDisabled: true
        })}
      />
    );

    const dialog = getDialog();
    expect(within(dialog).getByText("Offline", { selector: "dd" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Account changes require online mode/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Add account$/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /^Reconnect$/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /^Remove$/i })).toBeDisabled();
  });

  it("shows reconnect-required pill for reconnect accounts", () => {
    const reconnectAccount = buildAccount("alpha", {
      displayName: "Stale workspace",
      connectionState: "reconnect_required"
    });

    render(
      <SettingsDialogStage
        {...buildProps({
          activeAccount: reconnectAccount,
          accounts: [reconnectAccount]
        })}
      />
    );

    expect(within(getDialog()).getByText("Reconnect required")).toBeInTheDocument();
  });

  it("emits theme, hidden files, HEIC, and keep-awake changes", () => {
    const onThemeModeChange = vi.fn();
    const onShowHiddenFilesChange = vi.fn();
    const onExperimentalHeicPreviewEnabledChange = vi.fn();
    const onKeepAwakeEnabledChange = vi.fn();

    render(
      <SettingsDialogStage
        {...buildProps({
          onThemeModeChange,
          onShowHiddenFilesChange,
          onExperimentalHeicPreviewEnabledChange,
          onKeepAwakeEnabledChange
        })}
      />
    );

    const dialog = getDialog();
    const appearanceGroup = within(dialog).getByRole("group", { name: /Theme/i });

    fireEvent.click(within(appearanceGroup).getByRole("button", { name: "Dark" }));
    expect(onThemeModeChange).toHaveBeenCalledWith("dark");

    fireEvent.click(within(dialog).getByLabelText(/Show hidden files and folders/i));
    expect(onShowHiddenFilesChange).toHaveBeenCalledWith(true);

    fireEvent.click(within(dialog).getByLabelText(/Enable experimental HEIC preview/i));
    expect(onExperimentalHeicPreviewEnabledChange).toHaveBeenCalledWith(true);

    fireEvent.click(within(dialog).getByLabelText(/Keep screen awake during active work/i));
    expect(onKeepAwakeEnabledChange).toHaveBeenCalledWith(false);
  });

  it("renders keep-awake status copy for each wake-lock state", () => {
    const states = [
      ["active", /Active while media or transfers are running/i],
      ["requesting", /Requesting screen wake lock/i],
      ["unsupported", /Unavailable in this browser/i],
      ["denied", /Not granted by the browser/i],
      ["disabled", /Disabled on this device/i],
      ["idle", /Ready for media playback and transfers/i]
    ] as const;

    for (const [state, pattern] of states) {
      const { unmount } = render(<SettingsDialogStage {...buildProps({ keepAwakeState: state })} />);
      expect(within(getDialog()).getByText(pattern)).toBeInTheDocument();
      unmount();
    }
  });

  it("emits cache limit, max cacheable size, and preview freshness changes from CachePanel", () => {
    const onOpenedFileCacheLimitChange = vi.fn();
    const onMaxCacheableFileSizeChange = vi.fn();
    const onPreviewFreshnessIntervalChange = vi.fn();

    render(
      <SettingsDialogStage
        {...buildProps({
          onOpenedFileCacheLimitChange,
          onMaxCacheableFileSizeChange,
          onPreviewFreshnessIntervalChange
        })}
      />
    );

    const dialog = getDialog();
    fireEvent.change(within(dialog).getByLabelText(/Opened-file cache limit slider/i), { target: { value: "512" } });
    expect(onOpenedFileCacheLimitChange).toHaveBeenCalledWith(512 * 1024 * 1024);

    fireEvent.change(within(dialog).getByLabelText(/Max file size eligible for browser cache slider/i), { target: { value: "32" } });
    expect(onMaxCacheableFileSizeChange).toHaveBeenCalledWith(32 * 1024 * 1024);

    const freshnessValue = within(dialog).getByLabelText(/Cached preview update check interval value/i);
    fireEvent.change(freshnessValue, { target: { value: "5" } });
    fireEvent.blur(freshnessValue);
    expect(onPreviewFreshnessIntervalChange).toHaveBeenCalledWith(300);
  });

  it("emits clear cache and remove-offline callbacks from CachePanel", () => {
    const onClearCache = vi.fn();
    const onRemoveOfflineItem = vi.fn();

    render(
      <SettingsDialogStage
        {...buildProps({
          onClearCache,
          onRemoveOfflineItem,
          offlineItems: [{
            rootId: "root-1",
            rootPath: "Projects/roadmap.txt",
            name: "roadmap.txt",
            kind: "file",
            fileCount: 1,
            totalBytes: 128
          }]
        })}
      />
    );

    const dialog = getDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Clear cache$/i }));
    expect(onClearCache).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: /Remove offline copy for roadmap.txt from this device/i }));
    expect(onRemoveOfflineItem).toHaveBeenCalledWith("root-1");
  });

  it("shows empty offline-items affordance in CachePanel", () => {
    render(<SettingsDialogStage {...buildProps({ offlineItems: [] })} />);
    expect(within(getDialog()).getByText(/No files or folders are explicitly kept offline yet/i)).toBeInTheDocument();
  });
});
