import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppBarStage } from "./AppBarStage";
import type { AppBarSortPanelBinding } from "./useAppBarSortPanel";

function buildSortPanelBinding(overrides: Partial<AppBarSortPanelBinding> = {}): AppBarSortPanelBinding {
  return {
    open: false,
    toggle: vi.fn(),
    select: vi.fn(),
    reset: {
      confirming: false,
      count: 2,
      request: vi.fn(),
      confirm: vi.fn(),
      cancel: vi.fn()
    },
    ...overrides
  };
}

function buildProps(overrides: Partial<ComponentProps<typeof AppBarStage>> = {}) {
  return {
    supportText: "Online",
    hasAccounts: true,
    compactMobileHeader: false,
    navigationDrawerOpen: false,
    mobileSearchOpen: false,
    searchQuery: "",
    currentPath: "Projects/Plans",
    sortPanel: buildSortPanelBinding(),
    sortMode: "name-asc" as const,
    showRoutineCachedRefresh: false,
    cacheOnlyMode: false,
    explicitOfflineMode: false,
    offline: false,
    workerUnavailable: false,
    install: {
      available: false,
      busy: false,
      onInstall: vi.fn()
    },
    hasSession: true,
    onOpenNavigationDrawer: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onCloseMobileSearch: vi.fn(),
    onNavigateUp: vi.fn(),
    onOpenMobileSearch: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides
  };
}

function renderTransferTraySlot(): ReactNode {
  return (
    <button aria-label="Transfers" onClick={vi.fn()} type="button">
      Transfers
    </button>
  );
}

describe("AppBarStage", () => {
  afterEach(cleanup);

  it("renders desktop branding with subtitle variants and zero-account product name", () => {
    const { rerender } = render(
      <AppBarStage
        {...buildProps({
          hasAccounts: false,
          supportText: "No accounts connected"
        })}
      />
    );

    expect(screen.getByRole("heading", { level: 1, name: "Davora" })).toBeInTheDocument();
    expect(screen.getByText("No accounts connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open navigation menu/i })).not.toBeInTheDocument();

    rerender(
      <AppBarStage
        {...buildProps({
          supportText: "Checking connection"
        })}
      />
    );

    expect(screen.queryByRole("heading", { level: 1, name: "Davora" })).not.toBeInTheDocument();
    expect(screen.getByText("Checking connection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open navigation menu/i })).toBeInTheDocument();
  });

  it("keeps folder identity out of the compact mobile header and hides desktop subtitle", () => {
    render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          supportText: "/Projects/Plans"
        })}
      />
    );

    expect(document.querySelector(".mobile-app-bar-title")).toBeNull();
    expect(screen.queryByText("/Projects/Plans")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Davora" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go up one folder level/i })).toBeInTheDocument();
  });

  it("projects navigation drawer open state onto aria-expanded", () => {
    const { rerender } = render(<AppBarStage {...buildProps({ navigationDrawerOpen: false })} />);
    expect(screen.getByRole("button", { name: /Open navigation menu/i })).toHaveAttribute("aria-expanded", "false");

    rerender(<AppBarStage {...buildProps({ navigationDrawerOpen: true })} />);
    expect(screen.getByRole("button", { name: /Open navigation menu/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("switches between mobile search closed and open chrome", () => {
    const onOpenMobileSearch = vi.fn();
    const onCloseMobileSearch = vi.fn();
    const onSearchQueryChange = vi.fn();
    const { rerender } = render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          mobileSearchOpen: false,
          onOpenMobileSearch,
          onCloseMobileSearch,
          onSearchQueryChange
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Open search/i }));
    expect(onOpenMobileSearch).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/Search files/i)).not.toBeInTheDocument();

    rerender(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          mobileSearchOpen: true,
          searchQuery: "roadmap",
          onCloseMobileSearch,
          onSearchQueryChange
        })}
      />
    );

    const searchInput = screen.getByLabelText(/Search files/i);
    expect(searchInput).toHaveValue("roadmap");
    fireEvent.change(searchInput, { target: { value: "notes" } });
    expect(onSearchQueryChange).toHaveBeenCalledWith("notes");

    fireEvent.click(screen.getByRole("button", { name: /Close search/i }));
    expect(onCloseMobileSearch).toHaveBeenCalledTimes(1);
  });

  it("renders sort panel options with aria-pressed and closes on select", () => {
    const toggleSortPanel = vi.fn();
    const selectSortMode = vi.fn();
    const { rerender } = render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          sortPanel: buildSortPanelBinding({ toggle: toggleSortPanel, select: selectSortMode }),
          sortMode: "name-asc",
        })}
      />
    );

    const sortButton = screen.getByRole("button", { name: /Open sort options\. Current sort: Name A-Z/i });
    expect(sortButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(sortButton);
    expect(toggleSortPanel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: /Sort options/i })).not.toBeInTheDocument();

    rerender(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          sortPanel: buildSortPanelBinding({ open: true, toggle: toggleSortPanel, select: selectSortMode }),
          sortMode: "name-asc",
        })}
      />
    );

    const sortPanel = screen.getByRole("group", { name: /Sort options/i });
    expect(sortButton).toHaveAttribute("aria-expanded", "true");
    expect(within(sortPanel).getByRole("button", { name: "Name A-Z" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sortPanel).getByRole("button", { name: "Name Z-A" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(within(sortPanel).getByRole("button", { name: "Name Z-A" }));
    expect(selectSortMode).toHaveBeenCalledWith("name-desc");
  });

  it.each([
    { sortMode: "name-asc" as const, label: "Name A-Z", iconClass: "lucide-arrow-down-a-z" },
    { sortMode: "name-desc" as const, label: "Name Z-A", iconClass: "lucide-arrow-down-z-a" },
    { sortMode: "modified-desc" as const, label: "Modified newest", iconClass: "lucide-clock-arrow-down" },
    { sortMode: "modified-asc" as const, label: "Modified oldest", iconClass: "lucide-clock-arrow-up" },
    { sortMode: "size-desc" as const, label: "Size largest", iconClass: "lucide-arrow-down-wide-narrow" },
    { sortMode: "size-asc" as const, label: "Size smallest", iconClass: "lucide-arrow-down-narrow-wide" }
  ])("renders an icon-only $label sort trigger", ({ sortMode, label, iconClass }) => {
    render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          sortMode
        })}
      />
    );

    const sortButton = screen.getByRole("button", { name: `Open sort options. Current sort: ${label}` });
    expect(sortButton).toHaveAttribute("title", `Sort: ${label}`);
    expect(sortButton.textContent).toBe("");
    const icon = sortButton.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("class") ?? "").toContain(iconClass);
  });

  it("keeps the wake-lock status out of the app bar", () => {
    render(<AppBarStage {...buildProps({ compactMobileHeader: true })} />);
    expect(document.querySelector(".wake-lock-status")).toBeNull();
    expect(screen.queryByText(/Screen awake/i)).not.toBeInTheDocument();
  });

  it("toggles compact sort visibility while preserving open state across wide and search chrome", () => {
    const toggleSortPanel = vi.fn();
    const { rerender } = render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          mobileSearchOpen: false,
          sortPanel: buildSortPanelBinding({ toggle: toggleSortPanel })
        })}
      />
    );

    const closedSortButton = screen.getByRole("button", { name: /Open sort options\. Current sort: Name A-Z/i });
    expect(closedSortButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(closedSortButton);
    expect(toggleSortPanel).toHaveBeenCalledTimes(1);

    rerender(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          mobileSearchOpen: false,
          sortPanel: buildSortPanelBinding({ open: true, toggle: toggleSortPanel })
        })}
      />
    );
    expect(screen.getByRole("button", { name: /Open sort options\. Current sort: Name A-Z/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();

    rerender(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: false,
          mobileSearchOpen: false,
          sortPanel: buildSortPanelBinding({ open: true, toggle: toggleSortPanel })
        })}
      />
    );
    expect(screen.queryByRole("group", { name: /Sort options/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open sort options/i })).not.toBeInTheDocument();

    rerender(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          mobileSearchOpen: true,
          sortPanel: buildSortPanelBinding({ open: true, toggle: toggleSortPanel })
        })}
      />
    );
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();

    rerender(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          mobileSearchOpen: false,
          sortPanel: buildSortPanelBinding({ open: true, toggle: toggleSortPanel })
        })}
      />
    );
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();
  });

  it("keeps option order and current-mode selection callback behavior", () => {
    const selectSortMode = vi.fn();
    render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          sortPanel: buildSortPanelBinding({ open: true, select: selectSortMode }),
          sortMode: "name-asc",
        })}
      />
    );

    const sortPanel = screen.getByRole("group", { name: /Sort options/i });
    const optionButtons = within(sortPanel).getAllByRole("button")
      .filter((button) => button.classList.contains("mobile-sort-option"));
    expect(optionButtons.map((button) => button.textContent)).toEqual([
      "Name A-Z",
      "Name Z-A",
      "Modified newest",
      "Modified oldest",
      "Size largest",
      "Size smallest"
    ]);
    fireEvent.click(within(sortPanel).getByRole("button", { name: "Name A-Z" }));
    expect(selectSortMode).toHaveBeenCalledWith("name-asc");

    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();
  });

  it("renders a separated reset row with two-step inline confirmation", () => {
    const request = vi.fn();
    const confirm = vi.fn();
    const cancel = vi.fn();
    const { rerender } = render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          sortPanel: buildSortPanelBinding({ open: true, reset: { confirming: false, count: 3, request, confirm, cancel } })
        })}
      />
    );

    const sortPanel = screen.getByRole("group", { name: /Sort options/i });
    const resetButton = within(sortPanel).getByRole("button", { name: "Reset folder sort settings" });
    expect(resetButton).not.toBeDisabled();
    fireEvent.click(resetButton);
    expect(request).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();

    rerender(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          sortPanel: buildSortPanelBinding({ open: true, reset: { confirming: true, count: 3, request, confirm, cancel } })
        })}
      />
    );

    expect(within(sortPanel).getByText("Clear saved sort for 3 folders?")).toBeInTheDocument();
    fireEvent.click(within(sortPanel).getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    fireEvent.click(within(sortPanel).getByRole("button", { name: "Clear" }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("disables the reset action when no folder sort overrides exist", () => {
    render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          sortPanel: buildSortPanelBinding({ open: true, reset: { confirming: false, count: 0, request: vi.fn(), confirm: vi.fn(), cancel: vi.fn() } })
        })}
      />
    );

    const sortPanel = screen.getByRole("group", { name: /Sort options/i });
    expect(within(sortPanel).getByRole("button", { name: "Reset folder sort settings" })).toBeDisabled();
  });

  it("does not add Back dismissal or lifecycle resources to the sort panel", () => {
    const toggleSortPanel = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <AppBarStage {...buildProps({ compactMobileHeader: true, sortPanel: buildSortPanelBinding({ open: true, toggle: toggleSortPanel }) })} />
      </StrictMode>
    );

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();
    expect(toggleSortPanel).not.toHaveBeenCalled();

    unmount();
    expect(toggleSortPanel).not.toHaveBeenCalled();
  });

  it("keeps mobile sort controls out of desktop rendering", () => {
    render(<AppBarStage {...buildProps({ compactMobileHeader: false, sortPanel: buildSortPanelBinding({ open: true }) })} />);

    expect(screen.queryByRole("button", { name: /Open sort options/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Sort options/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Profile & settings/i })).toBeInTheDocument();
  });

  it("gates install and settings actions from props", () => {
    const onInstall = vi.fn();
    const onOpenSettings = vi.fn();
    const { rerender } = render(
      <AppBarStage
        {...buildProps({
          hasSession: true,
          install: { available: true, busy: false, onInstall },
          onOpenSettings
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Install app/i }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    rerender(
      <AppBarStage
        {...buildProps({
          hasSession: false,
          install: { available: true, busy: false, onInstall },
          compactMobileHeader: true,
          onOpenSettings
        })}
      />
    );

    expect(screen.queryByRole("button", { name: /Install app/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Profile & settings/i })).not.toBeInTheDocument();
  });

  it("keeps the contextual install action disabled while installation is busy", () => {
    const onInstall = vi.fn();
    render(
      <AppBarStage
        {...buildProps({
          hasSession: true,
          install: { available: true, busy: true, onInstall }
        })}
      />
    );

    const installButton = screen.getByRole("button", { name: /Installing/i });
    expect(installButton).toBeDisabled();
    fireEvent.click(installButton);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("renders transfer tray slot actions when provided", () => {
    const onTransferToggle = vi.fn();
    render(
      <AppBarStage
        {...buildProps({
          transferTray: (
            <button aria-label="Transfers" onClick={onTransferToggle} type="button">
              Transfers
            </button>
          )
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Transfers/i }));
    expect(onTransferToggle).toHaveBeenCalledTimes(1);
  });

  it("invokes onNavigateUp from the compact parent button", () => {
    const onNavigateUp = vi.fn();
    render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          currentPath: "Projects/Plans",
          onNavigateUp
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Go up one folder level/i }));
    expect(onNavigateUp).toHaveBeenCalledTimes(1);
  });

  it("shows the online status badge on desktop layouts", () => {
    render(
      <AppBarStage
        {...buildProps({
          supportText: "Online",
          workerUnavailable: true
        })}
      />
    );

    expect(screen.getByText("Server unavailable")).toBeInTheDocument();
  });

  it("keeps transfer tray slot reachable in compact layouts", () => {
    render(
      <AppBarStage
        {...buildProps({
          compactMobileHeader: true,
          transferTray: renderTransferTraySlot()
        })}
      />
    );

    expect(screen.getByRole("button", { name: /Transfers/i })).toBeInTheDocument();
  });
});
