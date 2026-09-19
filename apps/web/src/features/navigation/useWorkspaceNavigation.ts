import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  applyPathNavigateSideEffects,
  pushPath as pushPathTransition,
  pushSurface as pushSurfaceTransition,
  replacePath as replacePathTransition,
  syncPathToUrl as syncPathToUrlTransition
} from "./controller";
import {
  type ChromeOpenHistoryMode,
  type ChromeSurfaceKind,
  type ChromeSurfacesSnapshot,
  type DismissSurfaceKind,
  type SurfaceKind
} from "./model";
import { closedChromeSurfaces, closeChromeSurface, openChromeSurface, shouldPushChromeHistory } from "./model";
import type { HistoryPort } from "./ports";

export interface WorkspaceNavigationInput {
  readonly port: HistoryPort;
  readonly accountId: string;
  readonly path: {
    readonly clearSelectedEntry: () => void;
    readonly clearBatchSelection: () => void;
    readonly clearForPathTransition: () => void;
  };
}

const readLocation = (port: HistoryPort): { readonly href: string; readonly search: string } =>
  port.getLocation();

const isChromeSurface = (surface: DismissSurfaceKind): surface is ChromeSurfaceKind =>
  surface === "settings"
  || surface === "search"
  || surface === "navigation"
  || surface === "mobile-details"
  || surface === "transfers"
  || surface === "quick-actions";

export const useWorkspaceNavigation = (input: WorkspaceNavigationInput) => {
  const initialLocationRef = useRef(readLocation(input.port));
  const [currentPath, setCurrentPath] = useState(() => {
    const params = new URLSearchParams(initialLocationRef.current.search);
    const linkedAccountId = params.get("account");
    if (linkedAccountId !== null && linkedAccountId !== input.accountId) {
      return "";
    }
    return params.get("path") ?? "";
  });
  const [chrome, setChrome] = useState<ChromeSurfacesSnapshot>(closedChromeSurfaces);
  const inputRef = useRef(input);
  const chromeRef = useRef(chrome);
  const currentPathRef = useRef(currentPath);
  const initialUrlSyncRef = useRef(false);

  useLayoutEffect(() => {
    inputRef.current = input;
  }, [input]);
  useLayoutEffect(() => {
    chromeRef.current = chrome;
    currentPathRef.current = currentPath;
  }, [chrome, currentPath]);

  const resolveBaseHref = useCallback(() => readLocation(inputRef.current.port).href, []);
  const pushSurface = useCallback((surface: SurfaceKind) => {
    const current = inputRef.current;
    pushSurfaceTransition(current.port, current.accountId, currentPathRef.current, surface, resolveBaseHref());
  }, [resolveBaseHref]);
  const pushPath = useCallback((path: string) => {
    const current = inputRef.current;
    pushPathTransition(current.port, current.accountId, path, resolveBaseHref());
  }, [resolveBaseHref]);
  const replacePath = useCallback((path = currentPathRef.current) => {
    const current = inputRef.current;
    replacePathTransition(current.port, current.accountId, path, resolveBaseHref());
  }, [resolveBaseHref]);
  const syncPathToUrl = useCallback((path = currentPathRef.current, accountId?: string) => {
    const current = inputRef.current;
    syncPathToUrlTransition(current.port, {
      path,
      accountId: accountId ?? current.accountId,
      baseHref: resolveBaseHref()
    });
  }, [resolveBaseHref]);

  useEffect(() => {
    replacePath(currentPathRef.current);
  }, [replacePath]);

  useEffect(() => {
    if (!initialUrlSyncRef.current) {
      initialUrlSyncRef.current = true;
      return;
    }
    syncPathToUrl(currentPath, input.accountId);
  }, [currentPath, input.accountId, syncPathToUrl]);

  const openChrome = useCallback((surface: ChromeSurfaceKind, options?: { readonly pushHistory?: ChromeOpenHistoryMode }) => {
    if (shouldPushChromeHistory(chromeRef.current, surface, options?.pushHistory)) {
      pushSurface(surface);
    }
    setChrome((previous) => openChromeSurface(previous, surface));
  }, [pushSurface]);
  const closeChrome = useCallback((surface: ChromeSurfaceKind) => {
    setChrome((previous) => closeChromeSurface(previous, surface));
  }, []);
  const dismissChrome = useCallback((surface: DismissSurfaceKind) => {
    if (isChromeSurface(surface)) {
      closeChrome(surface);
    }
  }, [closeChrome]);
  const clearChromeForPathNavigate = useCallback(() => {
    setChrome((previous) => ({ ...previous, navigation: false, mobileDetails: false, quickActions: false }));
  }, []);
  const applyHistoryPath = useCallback((path: string) => {
    const current = inputRef.current;
    applyPathNavigateSideEffects({
      dismiss: {
        preview: () => undefined,
        action: () => undefined,
        destination: () => undefined,
        account: () => undefined,
        removeAccount: () => undefined,
        folderShortcut: () => undefined,
        reportBug: () => undefined,
        chrome: () => undefined
      },
      navigate: {
        clearSelectedEntry: current.path.clearSelectedEntry,
        clearBatchSelection: current.path.clearBatchSelection,
        clearChromeForPathNavigate,
        clearForPathTransition: current.path.clearForPathTransition,
        setCurrentPath
      }
    }, path);
  }, [clearChromeForPathNavigate]);
  const navigateToPath = useCallback((path: string) => {
    pushPath(path);
    applyHistoryPath(path);
  }, [applyHistoryPath, pushPath]);

  return {
    currentPath,
    setCurrentPath,
    getCurrentPath: () => currentPathRef.current,
    locationSearch: initialLocationRef.current.search,
    getLocationSearch: () => readLocation(inputRef.current.port).search,
    getChromeSnapshot: () => chromeRef.current,
    snapshot: chrome,
    navigationDrawerOpen: chrome.navigation,
    mobileSearchOpen: chrome.search,
    mobileDetailsOpen: chrome.mobileDetails,
    showSettingsDialog: chrome.settings,
    transferOpen: chrome.transfers,
    quickActionsOpen: chrome.quickActions,
    openChrome,
    closeChrome,
    dismissChrome,
    clearChromeForPathNavigate,
    pushSurface,
    pushPath,
    replacePath,
    syncPathToUrl,
    navigateToPath,
    applyHistoryPath
  } as const;
};
