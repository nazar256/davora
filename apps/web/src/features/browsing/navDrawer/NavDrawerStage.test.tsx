import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, RefCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FavouriteEntry } from "../favourites";
import type { BreadcrumbItem } from "../presentation";
import { NavDrawerStage } from "./NavDrawerStage";

const browserPointerEnvironment = {
  elementFromPoint: (x: number, y: number) => document.elementFromPoint(x, y),
  addWindowListener: (
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: PointerEvent) => void,
    options?: AddEventListenerOptions
  ) => {
    window.addEventListener(type, listener, options);
    return () => window.removeEventListener(type, listener);
  }
} as const;

const ROOT_BREADCRUMB: BreadcrumbItem = { label: "Home", ariaLabel: "Go to home folder", value: "" };
const NESTED_BREADCRUMBS: readonly BreadcrumbItem[] = [
  ROOT_BREADCRUMB,
  { label: "Projects", ariaLabel: "Go to /Projects", value: "Projects" },
  { label: "Plans", ariaLabel: "Go to /Projects/Plans", value: "Projects/Plans" }
];

const folderFavourite: FavouriteEntry = {
  accountId: "alpha",
  accountBackend: "mock",
  accountRootPath: ".davora-agent-test",
  cacheNamespace: "ns-alpha",
  path: "Projects",
  name: "Projects",
  isFolder: true,
  addedAt: "2026-07-10T00:00:00.000Z"
};

function buildProps(overrides: Partial<ComponentProps<typeof NavDrawerStage>> = {}) {
  return {
    open: false,
    onClose: vi.fn(),
    accountName: "Workspace Alpha",
    locationLabel: "/Projects/Plans",
    offline: false,
    workerUnavailable: false,
    explicitOfflineMode: false,
    cacheOnlyMode: false,
    onToggleOffline: vi.fn(),
    entries: [] as readonly FavouriteEntry[],
    offlineMode: false,
    pointerEnvironment: browserPointerEnvironment,
    onOpen: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn(),
    breadcrumbs: NESTED_BREADCRUMBS,
    currentPath: "Projects/Plans",
    onNavigateToPath: vi.fn(),
    canCreateFolder: true,
    canUploadFiles: true,
    canUploadFolders: true,
    mutationBusy: false,
    onCreateFolder: vi.fn(),
    onUploadFiles: vi.fn(),
    onUploadFolder: vi.fn(),
    onOpenSettings: vi.fn(),
    directoryUploadInputRef: vi.fn() as RefCallback<HTMLInputElement>,
    ...overrides
  };
}

describe("NavDrawerStage", () => {
  afterEach(cleanup);

  it("projects closed vs open drawer state onto class, aria-hidden, inert, and scrim", () => {
    const onClose = vi.fn();
    const { rerender } = render(<NavDrawerStage {...buildProps({ onClose })} />);

    const drawer = document.querySelector("aside.nav-drawer");
    expect(drawer).toBeInstanceOf(HTMLElement);
    if (!(drawer instanceof HTMLElement)) {
      return;
    }
    expect(drawer).toHaveClass("nav-drawer");
    expect(drawer).not.toHaveClass("open");
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(drawer.inert).toBe(true);
    expect(screen.getByRole("button", { name: /Close navigation menu/i, hidden: true })).toBeInTheDocument();
    expect(document.querySelector(".nav-drawer-scrim")).not.toBeInTheDocument();

    rerender(<NavDrawerStage {...buildProps({ open: true, onClose })} />);
    expect(drawer).toHaveClass("nav-drawer", "open");
    expect(drawer).toHaveAttribute("aria-hidden", "false");
    expect(drawer.inert).toBe(false);
    const openCloseButton = screen.getAllByRole("button", { name: /Close navigation menu/i })[1];
    openCloseButton.focus();
    expect(document.activeElement).toBe(openCloseButton);
    expect(document.querySelector(".nav-drawer-scrim.open")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Close navigation menu/i })).toHaveLength(2);
  });

  it("keeps drawer content non-interactive when closed and focusable when open", () => {
    const onClose = vi.fn();
    const { rerender } = render(<NavDrawerStage {...buildProps({ onClose })} />);

    const drawer = document.querySelector("aside.nav-drawer");
    expect(drawer).toBeInstanceOf(HTMLElement);
    if (!(drawer instanceof HTMLElement)) {
      return;
    }
    expect(drawer.inert).toBe(true);

    rerender(<NavDrawerStage {...buildProps({ open: true, onClose })} />);
    expect(drawer.inert).toBe(false);

    const headerCloseButton = screen.getAllByRole("button", { name: /Close navigation menu/i })[1];
    headerCloseButton.focus();
    expect(document.activeElement).toBe(headerCloseButton);

    fireEvent.click(headerCloseButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when the scrim or header close button is clicked", () => {
    const onClose = vi.fn();
    render(<NavDrawerStage {...buildProps({ open: true, onClose })} />);

    fireEvent.click(screen.getAllByRole("button", { name: /Close navigation menu/i })[0]);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole("button", { name: /Close navigation menu/i })[1]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("retires active favourite pointer listeners when the drawer closes", () => {
    const listeners: Array<{ readonly type: "pointermove" | "pointerup" | "pointercancel"; readonly listener: (event: PointerEvent) => void; removed: boolean }> = [];
    const pointerEnvironment = {
      elementFromPoint: () => null,
      addWindowListener: (type: "pointermove" | "pointerup" | "pointercancel", listener: (event: PointerEvent) => void) => {
        const record = { type, listener, removed: false };
        listeners.push(record);
        return () => {
          record.removed = true;
        };
      }
    } as const;
    const { rerender } = render(<NavDrawerStage {...buildProps({ open: true, entries: [folderFavourite], pointerEnvironment })} />);
    const handle = screen.getByRole("button", { name: /Drag Projects favourite/i });
    Object.defineProperty(handle, "setPointerCapture", { configurable: true, value: vi.fn() });
    const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });
    fireEvent(handle, pointerDown);

    rerender(<NavDrawerStage {...buildProps({ open: false, entries: [folderFavourite], pointerEnvironment })} />);
    expect(listeners.filter(({ removed }) => removed)).toHaveLength(3);
  });

  it.each([
    { label: "Online", offline: false, workerUnavailable: false, explicitOfflineMode: false, cacheOnlyMode: false, pill: "Ready" },
    { label: "Offline", offline: true, workerUnavailable: false, explicitOfflineMode: false, cacheOnlyMode: true, pill: "Read-only" },
    { label: "Unavailable", offline: false, workerUnavailable: true, explicitOfflineMode: false, cacheOnlyMode: true, pill: "Read-only" },
    { label: "Offline mode", offline: false, workerUnavailable: false, explicitOfflineMode: true, cacheOnlyMode: true, pill: "Read-only" }
  ])("shows $label status badge and $pill operation pill", ({ label, offline, workerUnavailable, explicitOfflineMode, cacheOnlyMode, pill }) => {
    render(
      <NavDrawerStage
        {...buildProps({
          open: true,
          offline,
          workerUnavailable,
          explicitOfflineMode,
          cacheOnlyMode,
          offlineMode: explicitOfflineMode
        })}
      />
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(pill)).toBeInTheDocument();
  });

  it("shows offline toggle copy for online and explicit-offline modes and emits onToggleOffline", () => {
    const onToggleOffline = vi.fn();
    const { rerender } = render(
      <NavDrawerStage {...buildProps({ open: true, onToggleOffline, explicitOfflineMode: false })} />
    );

    expect(screen.getByRole("button", { name: /Go offline/i })).toBeInTheDocument();
    expect(screen.getByText("Switch to cached-only browsing without contacting the server.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Go offline/i }));
    expect(onToggleOffline).toHaveBeenCalledTimes(1);

    rerender(
      <NavDrawerStage {...buildProps({ open: true, onToggleOffline, explicitOfflineMode: true, offlineMode: true })} />
    );
    expect(screen.getByRole("button", { name: /Go online/i })).toBeInTheDocument();
    expect(screen.getByText("Browsing readable files stored on this device only.")).toBeInTheDocument();
  });

  it("renders home and nested folder breadcrumbs with aria-current and navigation callbacks", () => {
    const onNavigateToPath = vi.fn();
    const { rerender } = render(
      <NavDrawerStage
        {...buildProps({
          open: true,
          breadcrumbs: [ROOT_BREADCRUMB],
          currentPath: "",
          onNavigateToPath
        })}
      />
    );

    const folderNav = screen.getByRole("navigation", { name: /Folder navigation/i });
    const homeButton = within(folderNav).getByRole("button", { name: /Home/i });
    expect(homeButton).toHaveAttribute("aria-current", "page");

    fireEvent.click(homeButton);
    expect(onNavigateToPath).toHaveBeenCalledWith("");

    rerender(
      <NavDrawerStage
        {...buildProps({
          open: true,
          breadcrumbs: NESTED_BREADCRUMBS,
          currentPath: "Projects/Plans",
          onNavigateToPath
        })}
      />
    );
    const nestedFolderNav = screen.getByRole("navigation", { name: /Folder navigation/i });
    expect(within(nestedFolderNav).getByRole("button", { name: /Home/i })).not.toHaveAttribute("aria-current");
    expect(within(nestedFolderNav).getByRole("button", { name: /Plans/i })).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(nestedFolderNav).getByRole("button", { name: /Projects/i }));
    expect(onNavigateToPath).toHaveBeenCalledWith("Projects");
  });

  it("projects disabled state onto actions and emits upload and settings callbacks", () => {
    const onCreateFolder = vi.fn();
    const onUploadFiles = vi.fn();
    const onUploadFolder = vi.fn();
    const onOpenSettings = vi.fn();
    const { rerender } = render(
      <NavDrawerStage
        {...buildProps({
          open: true,
          canCreateFolder: false,
          canUploadFiles: false,
          canUploadFolders: false,
          mutationBusy: true,
          onCreateFolder,
          onUploadFiles,
          onUploadFolder,
          onOpenSettings
        })}
      />
    );

    expect(screen.getByRole("button", { name: /Create folder/i })).toBeDisabled();
    expect(screen.getByLabelText(/Upload files from navigation menu/i)).toBeDisabled();
    expect(screen.getByLabelText(/Upload folder from navigation menu/i)).toBeDisabled();

    rerender(
      <NavDrawerStage
        {...buildProps({
          open: true,
          onCreateFolder,
          onUploadFiles,
          onUploadFolder,
          onOpenSettings
        })}
      />
    );

    const fileInput = screen.getByLabelText(/Upload files from navigation menu/i);
    const folderInput = screen.getByLabelText(/Upload folder from navigation menu/i);
    fireEvent.change(fileInput, { target: { files: [new File(["a"], "a.txt", { type: "text/plain" })] } });
    fireEvent.change(folderInput, { target: { files: [new File(["b"], "b.txt", { type: "text/plain" })] } });
    expect(onUploadFiles).toHaveBeenCalled();
    expect(onUploadFolder).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("passes favourites props through to FavouritesStage", () => {
    const onRemove = vi.fn();
    render(
      <NavDrawerStage
        {...buildProps({
          open: true,
          entries: [folderFavourite],
          offlineMode: true,
          onRemove
        })}
      />
    );

    const favouritesSection = screen.getByRole("region", { name: /Favourites/i });
    expect(within(favouritesSection).getByRole("button", { name: /Open favourite folder Projects/i })).toBeInTheDocument();

    fireEvent.click(within(favouritesSection).getByRole("button", { name: /Remove Projects from Favourites/i }));
    expect(onRemove).toHaveBeenCalledWith(folderFavourite);
  });

  it("shows favourites empty copy from offline mode props", () => {
    render(<NavDrawerStage {...buildProps({ open: true, entries: [], offlineMode: true })} />);

    const favouritesSection = screen.getByRole("region", { name: /Favourites/i });
    expect(within(favouritesSection).getByText("No offline-available favourites in this workspace.")).toBeInTheDocument();
  });
});
