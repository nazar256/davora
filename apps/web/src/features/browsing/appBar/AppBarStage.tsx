import {
  ArrowDownAZ,
  ArrowDownNarrowWide,
  ArrowDownWideNarrow,
  ArrowDownZA,
  ArrowUp,
  ClockArrowDown,
  ClockArrowUp,
  Menu,
  Search,
  Settings,
  Wifi,
  WifiOff,
  X,
  type LucideIcon
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";

import {
  getSortModeLabel,
  SORT_MODE_OPTIONS,
  type SortMode
} from "../model";
import { buildFolderSortResetQuestion } from "../folderSort";
import type { AppBarSortPanelBinding } from "./useAppBarSortPanel";

function buildHeaderStatusBadgeLabel(input: {
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  readonly workerUnavailable: boolean;
}): string {
  if (input.explicitOfflineMode) {
    return "Offline mode";
  }
  if (input.offline) {
    return "Offline";
  }
  if (input.workerUnavailable) {
    return "Server unavailable";
  }
  return "Online";
}

const SORT_MODE_ICONS: Record<SortMode, LucideIcon> = {
  "name-asc": ArrowDownAZ,
  "name-desc": ArrowDownZA,
  "modified-desc": ClockArrowDown,
  "modified-asc": ClockArrowUp,
  "size-desc": ArrowDownWideNarrow,
  "size-asc": ArrowDownNarrowWide
};

export interface AppBarStageProps {
  readonly supportText: string;
  readonly hasAccounts: boolean;
  readonly compactMobileHeader: boolean;
  readonly navigationDrawerOpen: boolean;
  readonly mobileSearchOpen: boolean;
  readonly searchQuery: string;
  readonly currentPath: string;
  readonly sortPanel: AppBarSortPanelBinding;
  readonly sortMode: SortMode;
  readonly showRoutineCachedRefresh: boolean;
  readonly cacheOnlyMode: boolean;
  readonly explicitOfflineMode: boolean;
  readonly offline: boolean;
  readonly workerUnavailable: boolean;
  readonly install: {
    readonly available: boolean;
    readonly busy: boolean;
    readonly onInstall: () => void;
  };
  readonly hasSession: boolean;
  readonly transferTray?: ReactNode;
  readonly onOpenNavigationDrawer: () => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onCloseMobileSearch: () => void;
  readonly onNavigateUp: () => void;
  readonly onOpenMobileSearch: () => void;
  readonly onOpenSettings: () => void;
}

export function AppBarStage(props: AppBarStageProps) {
  const showHeaderStatusBadge = !props.compactMobileHeader;
  const showPersistentProductName = !props.hasAccounts;
  const showContextualActions = (props.hasSession && props.install.available) || props.hasAccounts;
  const statusBadgeLabel = buildHeaderStatusBadgeLabel({
    explicitOfflineMode: props.explicitOfflineMode,
    offline: props.offline,
    workerUnavailable: props.workerUnavailable
  });
  const SortModeIcon = SORT_MODE_ICONS[props.sortMode];

  const handleSearchQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    props.onSearchQueryChange(event.target.value);
  };

  return (
    <>
      <header
        className={`app-bar${props.compactMobileHeader ? " app-bar-compact" : ""}${props.compactMobileHeader && props.mobileSearchOpen ? " app-bar-search-open" : ""}`}
      >
        <div className="app-bar-brand">
          {props.hasAccounts ? (
            <button
              aria-expanded={props.navigationDrawerOpen}
              aria-label="Open navigation menu"
              className="nav-drawer-trigger"
              onClick={props.onOpenNavigationDrawer}
              type="button"
            >
              <Menu aria-hidden="true" />
            </button>
          ) : null}
          {props.compactMobileHeader && props.hasAccounts ? (
            props.mobileSearchOpen ? (
              <div className="mobile-app-bar-search search-block">
                <input
                  aria-label="Search files"
                  autoFocus
                  onChange={handleSearchQueryChange}
                  placeholder="Search files"
                  value={props.searchQuery}
                />
                <button
                  aria-label="Close search"
                  className="mobile-search-close-button"
                  onClick={props.onCloseMobileSearch}
                  title="Close search"
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                {props.currentPath ? (
                  <button
                    aria-label="Go up one folder level"
                    className="mobile-parent-button"
                    onClick={props.onNavigateUp}
                    type="button"
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                ) : null}
              </>
            )
          ) : (
            <>
              <div aria-hidden="true" className="app-logo">
                D
              </div>
              <div className="app-bar-brand-copy">
                {showPersistentProductName ? <h1>Davora</h1> : null}
                {!props.compactMobileHeader ? <p className="status app-bar-subtitle">{props.supportText}</p> : null}
              </div>
            </>
          )}
        </div>
        <div className="app-bar-actions">
          {showContextualActions ? (
            <div className="app-bar-contextual-actions">
              {props.hasSession && props.install.available ? (
                <button
                  className="quiet-button app-install-button"
                  disabled={props.install.busy}
                  onClick={props.install.onInstall}
                  type="button"
                >
                  {props.install.busy ? "Installing…" : "Install app"}
                </button>
              ) : null}
              {props.hasAccounts && !props.compactMobileHeader ? (
                <button className="button-with-icon" onClick={props.onOpenSettings} type="button">
                  <Settings aria-hidden="true" />
                  Profile & settings
                </button>
              ) : null}
            </div>
          ) : null}
          {props.hasAccounts ? (
            <>
              {props.compactMobileHeader && !props.mobileSearchOpen ? (
                <button
                  aria-label="Open search"
                  className="mobile-search-button"
                  onClick={props.onOpenMobileSearch}
                  title="Search"
                  type="button"
                >
                  <Search aria-hidden="true" />
                </button>
              ) : null}
              {props.compactMobileHeader && !props.mobileSearchOpen ? (
                <button
                  aria-expanded={props.sortPanel.open}
                  aria-label={`Open sort options. Current sort: ${getSortModeLabel(props.sortMode)}`}
                  className="mobile-sort-button"
                  onClick={props.sortPanel.toggle}
                  title={`Sort: ${getSortModeLabel(props.sortMode)}`}
                  type="button"
                >
                  <SortModeIcon aria-hidden="true" />
                </button>
              ) : null}
              {props.compactMobileHeader && !props.mobileSearchOpen && props.showRoutineCachedRefresh ? (
                <span aria-label="Refreshing cached folder" className="mobile-refresh-status" role="status">
                  Sync
                </span>
              ) : null}
              {props.transferTray}
            </>
          ) : null}
          {showHeaderStatusBadge ? (
            <div className={`badge status-badge ${props.cacheOnlyMode ? "offline" : "online"}`}>
              {props.cacheOnlyMode ? <WifiOff aria-hidden="true" /> : <Wifi aria-hidden="true" />}
              {statusBadgeLabel}
            </div>
          ) : null}
        </div>
      </header>
      {props.compactMobileHeader && props.sortPanel.open ? (
        <div aria-label="Sort options" className="mobile-sort-panel" role="group">
          {SORT_MODE_OPTIONS.map((option) => (
            <button
              aria-pressed={props.sortMode === option.value}
              className={`mobile-sort-option${props.sortMode === option.value ? " active" : ""}`}
              key={option.value}
              onClick={() => props.sortPanel.select(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
          <div className="mobile-sort-reset">
            {props.sortPanel.reset.confirming ? (
              <>
                <span className="mobile-sort-reset-question">
                  {buildFolderSortResetQuestion(props.sortPanel.reset.count)}
                </span>
                <div className="mobile-sort-reset-actions">
                  <button
                    className="mobile-sort-reset-confirm"
                    onClick={props.sortPanel.reset.confirm}
                    type="button"
                  >
                    Clear
                  </button>
                  <button
                    className="mobile-sort-reset-cancel"
                    onClick={props.sortPanel.reset.cancel}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button
                className="mobile-sort-reset-button"
                disabled={props.sortPanel.reset.count === 0}
                onClick={props.sortPanel.reset.request}
                type="button"
              >
                Reset folder sort settings
              </button>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
