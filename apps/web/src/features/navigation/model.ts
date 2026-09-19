export type SurfaceKind =
  | "preview"
  | "action"
  | "account"
  | "remove-account"
  | "settings"
  | "search"
  | "navigation"
  | "mobile-details"
  | "transfers";

/** Destination picker shares the action history label but dismisses before account dialogs. */
export type DismissSurfaceKind = SurfaceKind | "destination";

export interface HistoryState {
  readonly davora: true;
  readonly accountId: string;
  readonly path: string;
  readonly surface?: SurfaceKind;
}

export interface OpenSurfacesSnapshot {
  readonly preview: boolean;
  readonly action: boolean;
  readonly destination: boolean;
  readonly account: boolean;
  readonly removeAccount: boolean;
  readonly settings: boolean;
  readonly search: boolean;
  readonly navigation: boolean;
  readonly mobileDetails: boolean;
  readonly transfers: boolean;
}

export type ChromeSurfaceKind = Extract<
  SurfaceKind,
  "navigation" | "search" | "mobile-details" | "settings" | "transfers"
>;

export interface ChromeSurfacesSnapshot {
  readonly navigation: boolean;
  readonly search: boolean;
  readonly mobileDetails: boolean;
  readonly settings: boolean;
  readonly transfers: boolean;
}

export interface WorkflowSurfacesSnapshot {
  readonly preview: boolean;
  readonly action: boolean;
  readonly destination: boolean;
  readonly account: boolean;
  readonly removeAccount: boolean;
}

export const CHROME_SURFACE_KEYS: Readonly<Record<ChromeSurfaceKind, keyof ChromeSurfacesSnapshot>> = {
  navigation: "navigation",
  search: "search",
  "mobile-details": "mobileDetails",
  settings: "settings",
  transfers: "transfers"
};

export const closedChromeSurfaces = (): ChromeSurfacesSnapshot => Object.freeze({
  navigation: false,
  search: false,
  mobileDetails: false,
  settings: false,
  transfers: false
});

export const openChromeSurface = (
  snapshot: ChromeSurfacesSnapshot,
  surface: ChromeSurfaceKind
): ChromeSurfacesSnapshot => Object.freeze({
  ...snapshot,
  [CHROME_SURFACE_KEYS[surface]]: true
});

export const closeChromeSurface = (
  snapshot: ChromeSurfacesSnapshot,
  surface: ChromeSurfaceKind
): ChromeSurfacesSnapshot => Object.freeze({
  ...snapshot,
  [CHROME_SURFACE_KEYS[surface]]: false
});

export const applyChromeDismiss = (
  snapshot: ChromeSurfacesSnapshot,
  surface: DismissSurfaceKind
): ChromeSurfacesSnapshot => {
  switch (surface) {
    case "settings":
    case "search":
    case "navigation":
    case "mobile-details":
    case "transfers":
      return closeChromeSurface(snapshot, surface);
    case "preview":
    case "action":
    case "destination":
    case "account":
    case "remove-account":
      return snapshot;
  }
};

export const clearChromeOnPathNavigate = (
  snapshot: ChromeSurfacesSnapshot
): ChromeSurfacesSnapshot => Object.freeze({
  ...snapshot,
  navigation: false,
  mobileDetails: false
});

export const mergeOpenSurfaces = (
  chrome: ChromeSurfacesSnapshot,
  workflow: WorkflowSurfacesSnapshot
): OpenSurfacesSnapshot => Object.freeze({
  ...workflow,
  settings: chrome.settings,
  search: chrome.search,
  navigation: chrome.navigation,
  mobileDetails: chrome.mobileDetails,
  transfers: chrome.transfers
});

export type ChromeOpenHistoryMode = boolean | "if-closed";

export const shouldPushChromeHistory = (
  snapshot: ChromeSurfacesSnapshot,
  surface: ChromeSurfaceKind,
  pushHistory: ChromeOpenHistoryMode = "if-closed"
): boolean => {
  if (pushHistory === false) {
    return false;
  }
  if (pushHistory === true) {
    return true;
  }
  return !snapshot[CHROME_SURFACE_KEYS[surface]];
};

export type NavigationCommand =
  | { readonly kind: "dismiss"; readonly surface: DismissSurfaceKind }
  | { readonly kind: "navigate"; readonly path: string };

export const DISMISS_SURFACE_ORDER: readonly DismissSurfaceKind[] = [
  "preview",
  "action",
  "destination",
  "account",
  "remove-account",
  "settings",
  "search",
  "navigation",
  "mobile-details",
  "transfers"
];

const DISMISS_SURFACE_KEYS: Readonly<Record<DismissSurfaceKind, keyof OpenSurfacesSnapshot>> = {
  preview: "preview",
  action: "action",
  destination: "destination",
  account: "account",
  "remove-account": "removeAccount",
  settings: "settings",
  search: "search",
  navigation: "navigation",
  "mobile-details": "mobileDetails",
  transfers: "transfers"
};

const isSurfaceKind = (value: unknown): value is SurfaceKind =>
  value === "preview"
  || value === "action"
  || value === "account"
  || value === "remove-account"
  || value === "settings"
  || value === "search"
  || value === "navigation"
  || value === "mobile-details"
  || value === "transfers";

const isHistoryRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const createHistoryState = (
  accountId: string,
  path: string,
  surface?: SurfaceKind
): HistoryState => Object.freeze({
  davora: true,
  accountId,
  path,
  ...(surface === undefined ? {} : { surface })
});

export const parseHistoryState = (value: unknown): HistoryState | null => {
  if (!isHistoryRecord(value) || value.davora !== true) {
    return null;
  }
  if (typeof value.accountId !== "string" || typeof value.path !== "string") {
    return null;
  }
  if (value.surface !== undefined && !isSurfaceKind(value.surface)) {
    return null;
  }
  return createHistoryState(value.accountId, value.path, value.surface);
};

export const resolvePathFromHistoryState = (
  historyState: unknown,
  currentPath: string
): string => resolveNavigationPath(historyState) ?? currentPath;

export const resolveNavigationPath = (historyState: unknown): string | null => {
  if (!isHistoryRecord(historyState) || historyState.davora !== true || typeof historyState.path !== "string") {
    return null;
  }
  return historyState.path;
};

export const resolvePopStateCommands = (input: {
  readonly historyState: unknown;
  readonly currentPath: string;
  readonly openSurfaces: OpenSurfacesSnapshot;
}): readonly NavigationCommand[] => {
  const commands: NavigationCommand[] = [];

  for (const surface of DISMISS_SURFACE_ORDER) {
    const key = DISMISS_SURFACE_KEYS[surface];
    if (input.openSurfaces[key]) {
      commands.push({ kind: "dismiss", surface });
      break;
    }
  }

  const nextPath = resolveNavigationPath(input.historyState);
  if (nextPath !== null && nextPath !== input.currentPath) {
    commands.push({ kind: "navigate", path: nextPath });
  }

  return Object.freeze(commands);
};
