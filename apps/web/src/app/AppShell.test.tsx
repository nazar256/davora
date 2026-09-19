import { forwardRef, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell, type AppShellProps } from "./AppShell";

vi.mock("../features/browsing", () => ({
  AppBarStage: () => <div data-stage="app-bar" />,
  BrowseHeaderStage: () => <div data-stage="browse-header" />,
  FileListStage: forwardRef<HTMLElement>((_props, ref) => <section data-stage="file-list" ref={ref} />),
  NavDrawerStage: () => <div data-stage="nav-drawer" />
}));

vi.mock("../features/accounts", () => ({
  AccountBootstrapShell: ({ appBar, navDrawer, reloadPrompt }: {
    appBar: ReactNode;
    navDrawer?: ReactNode;
    reloadPrompt: ReactNode;
  }) => (
    <div className="shell" data-stage="bootstrap-shell">
      {reloadPrompt}
      {appBar}
      {navDrawer}
      <div data-stage="bootstrap-content" />
    </div>
  ),
  ConnectAccountDialogStage: () => <div data-stage="connect-account" />,
  RemoveAccountStage: () => <div data-stage="remove-account" />
}));

vi.mock("../features/settings", () => ({
  SettingsDialogStage: () => <div data-stage="settings" />
}));

vi.mock("../features/offline/sync", () => ({
  OfflineSyncConfirmStage: () => <div data-stage="offline-sync" />
}));

vi.mock("../features/operations", () => ({
  MutationWorkflowStage: () => <div data-stage="mutation" />,
  SelectionDetailsStage: () => <div data-stage="selection-details" />
}));

vi.mock("../features/preview/folderAudio", () => ({
  FolderAudioBrowseMount: () => <div data-stage="folder-audio" />
}));

vi.mock("../features/preview/shell", () => ({
  PreviewModalStage: () => <div data-stage="preview" />
}));

vi.mock("../features/pwa", () => ({
  ReloadPromptStage: () => <div data-stage="reload-prompt" />
}));

vi.mock("../components/StateBanner", () => ({
  StateBanner: () => <div data-stage="state-banner" />
}));

function stageOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-stage]"))
    .map((element) => element.dataset.stage ?? "");
}

const mockedStageProps = null!;

function commonBindings(navigationKey = "account-a") {
  return {
    reloadPrompt: mockedStageProps,
    appBar: mockedStageProps,
    navigationDrawer: { key: navigationKey, props: mockedStageProps },
    removeAccount: mockedStageProps
  };
}

function bootstrapProps(navigationKey?: string): AppShellProps {
  return {
    kind: "bootstrap",
    common: commonBindings(navigationKey),
    bootstrap: mockedStageProps
  };
}

function workspaceProps(input: {
  navigationKey?: string;
  fileListRef?: (element: HTMLElement | null) => void;
  onToggleOffline?: () => void;
  pullToRefresh?: {
    visible?: boolean;
    progress?: number;
    refreshing?: boolean;
  };
} = {}): AppShellProps {
  return {
    kind: "workspace",
    common: commonBindings(input.navigationKey),
    status: {
      banner: mockedStageProps,
      offlineToggle: {
        label: "Go offline",
        onToggle: input.onToggleOffline ?? vi.fn()
      }
    },
    workspace: {
      className: "workspace-layout workspace-layout-full",
      pullToRefresh: {
        indicator: {
          visible: input.pullToRefresh?.visible ?? true,
          progress: input.pullToRefresh?.progress ?? 0.5,
          refreshing: input.pullToRefresh?.refreshing ?? false
        },
        handlers: {
          onTouchStart: vi.fn(),
          onTouchMove: vi.fn(),
          onTouchEnd: vi.fn()
        }
      },
      browsePanelClassName: "browse-panel-with-audio",
      browseHeader: mockedStageProps,
      folderAudio: mockedStageProps,
      fileList: { props: mockedStageProps, ref: input.fileListRef },
      selectionDetails: mockedStageProps
    },
    overlays: {
      settings: mockedStageProps,
      offlineSync: mockedStageProps,
      connectAccount: mockedStageProps,
      mutation: mockedStageProps,
      preview: mockedStageProps
    }
  };
}

describe("AppShell", () => {
  it("projects bootstrap chrome and account overlays without mounting workspace stages", () => {
    const { container } = render(<AppShell {...bootstrapProps()} />);

    expect(stageOrder(container)).toEqual([
      "bootstrap-shell",
      "reload-prompt",
      "app-bar",
      "nav-drawer",
      "bootstrap-content",
      "remove-account"
    ]);
    expect(container.querySelector("[data-stage='state-banner']")).toBeNull();
    expect(container.querySelector("[data-stage='browse-header']")).toBeNull();
    expect(container.querySelector("main")).toBeNull();
  });

  it("preserves workspace DOM classes, stage order, toggle intent, and file-list ref", () => {
    const onToggleOffline = vi.fn();
    const fileListRef = vi.fn();
    const { container, unmount } = render(
      <AppShell {...workspaceProps({ fileListRef, onToggleOffline })} />
    );

    expect(container.firstElementChild).toHaveClass("shell");
    expect(container.querySelector("main")).toHaveClass("workspace-layout", "workspace-layout-full");
    expect(container.querySelector("section.browse-panel-with-audio")).not.toBeNull();
    const statusSlot = container.querySelector(".state-banner-slot");
    const main = container.querySelector("main");
    expect(statusSlot).toBeInTheDocument();
    expect(statusSlot?.nextElementSibling).toBe(main);
    expect(container.querySelectorAll(".state-banner-slot")).toHaveLength(1);
    expect(container.querySelectorAll(".offline-mode-toggle")).toHaveLength(1);
    expect(container.querySelector(".pull-to-refresh-indicator")).toHaveStyle({
      opacity: "0.5",
      transform: "translateY(20px)"
    });
    expect(stageOrder(container)).toEqual([
      "reload-prompt",
      "app-bar",
      "nav-drawer",
      "state-banner",
      "browse-header",
      "folder-audio",
      "file-list",
      "selection-details",
      "settings",
      "offline-sync",
      "connect-account",
      "remove-account",
      "mutation",
      "preview"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Go offline" }));
    expect(onToggleOffline).toHaveBeenCalledTimes(1);
    expect(fileListRef).toHaveBeenCalledWith(container.querySelector("[data-stage='file-list']"));

    unmount();
    expect(fileListRef).toHaveBeenLastCalledWith(null);
  });

  it("uses the active-account key as the navigation-drawer remount boundary", () => {
    const { container, rerender } = render(<AppShell {...bootstrapProps("account-a")} />);
    const firstDrawer = container.querySelector("[data-stage='nav-drawer']");

    rerender(<AppShell {...bootstrapProps("account-a")} />);
    expect(container.querySelector("[data-stage='nav-drawer']")).toBe(firstDrawer);

    rerender(<AppShell {...bootstrapProps("account-b")} />);
    expect(container.querySelector("[data-stage='nav-drawer']")).not.toBe(firstDrawer);
  });

  it("preserves pull indicator ARIA, copy precedence, and shell touch handlers", () => {
    const handlers = {
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn()
    };
    const baseProps = workspaceProps({ pullToRefresh: { progress: 0.5 } });
    if (baseProps.kind !== "workspace") {
      throw new Error("Expected workspace props.");
    }
    const props: Extract<AppShellProps, { kind: "workspace" }> = {
      ...baseProps,
      workspace: {
        ...baseProps.workspace,
        pullToRefresh: {
          indicator: { visible: true, progress: 0.5, refreshing: false },
          handlers
        }
      }
    };
    const { container, rerender } = render(<AppShell {...props} />);
    const main = container.querySelector("main");
    const indicator = screen.getByRole("status");

    expect(indicator).toHaveAttribute("aria-live", "polite");
    expect(indicator).toHaveClass("pull-to-refresh-indicator");
    expect(indicator.querySelector(".pull-to-refresh-spinner")).toHaveTextContent("Pull to refresh");
    expect(indicator).toHaveStyle({ opacity: "0.5", transform: "translateY(20px)" });
    expect(main).toBeTruthy();
    if (main) {
      fireEvent.touchStart(main, { touches: [{ clientY: 0 }] });
      fireEvent.touchMove(main, { touches: [{ clientY: 12 }] });
      fireEvent.touchEnd(main);
    }
    expect(handlers.onTouchStart).toHaveBeenCalledTimes(1);
    expect(handlers.onTouchMove).toHaveBeenCalledTimes(1);
    expect(handlers.onTouchEnd).toHaveBeenCalledTimes(1);

    rerender(<AppShell {...workspaceProps({ pullToRefresh: { progress: 1, refreshing: false } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Release to refresh");
    rerender(<AppShell {...workspaceProps({ pullToRefresh: { progress: 1, refreshing: true } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing...");
    rerender(<AppShell {...workspaceProps({ pullToRefresh: { visible: false, progress: 0, refreshing: false } })} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
