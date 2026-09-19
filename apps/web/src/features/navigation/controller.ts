import { buildLocationHref } from "./location";
import {
  createHistoryState,
  parseHistoryState,
  type DismissSurfaceKind,
  type NavigationCommand,
  type SurfaceKind
} from "./model";
import type {
  HistoryPort,
  NavigationCommandApplicationPorts,
  NavigationCommandApplicationSource
} from "./ports";

export const createNavigationCommandApplicationPorts = (
  source: NavigationCommandApplicationSource
): NavigationCommandApplicationPorts => ({
  dismiss: {
    preview: () => source.closePreview(),
    action: () => source.dismissAction(),
    destination: () => source.closeDestinationPicker(),
    account: () => source.setShowAccountDialog(false),
    removeAccount: () => source.setRemoveAccountTarget(undefined),
    folderShortcut: () => source.dismissFolderShortcut(),
    chrome: (surface) => source.dismissChrome(surface)
  },
  navigate: {
    clearSelectedEntry: () => source.clearSelectedEntry(),
    clearBatchSelection: () => source.clearBatchSelection(),
    clearChromeForPathNavigate: () => source.clearChromeForPathNavigate(),
    clearForPathTransition: () => source.clearForPathTransition(),
    setCurrentPath: (path) => source.setCurrentPath(path)
  }
});

export const applyPathNavigateSideEffects = (
  ports: NavigationCommandApplicationPorts,
  path: string
): void => {
  ports.navigate.clearSelectedEntry();
  ports.navigate.clearBatchSelection();
  ports.navigate.clearChromeForPathNavigate();
  ports.navigate.clearForPathTransition();
  ports.navigate.setCurrentPath(path);
};

export const applyNavigationDismiss = (
  ports: NavigationCommandApplicationPorts,
  surface: DismissSurfaceKind
): void => {
  switch (surface) {
    case "preview":
      ports.dismiss.preview();
      break;
    case "action":
      ports.dismiss.action();
      break;
    case "destination":
      ports.dismiss.destination();
      break;
    case "account":
      ports.dismiss.account();
      break;
    case "remove-account":
      ports.dismiss.removeAccount();
      break;
    case "folder-shortcut":
      ports.dismiss.folderShortcut();
      break;
    case "settings":
    case "search":
    case "navigation":
    case "mobile-details":
    case "transfers":
      ports.dismiss.chrome(surface);
      break;
  }
};

export const applyNavigationCommands = (
  ports: NavigationCommandApplicationPorts,
  commands: readonly NavigationCommand[]
): void => {
  for (const command of commands) {
    if (command.kind === "dismiss") {
      applyNavigationDismiss(ports, command.surface);
    } else {
      applyPathNavigateSideEffects(ports, command.path);
    }
  }
};

export const pushSurface = (
  port: HistoryPort,
  accountId: string,
  path: string,
  surface: SurfaceKind,
  baseHref: string
): void => {
  const url = buildLocationHref(baseHref, path, accountId);
  port.pushState(createHistoryState(accountId, path, surface), url);
};

export const replacePath = (
  port: HistoryPort,
  accountId: string,
  path: string,
  baseHref: string
): void => {
  const url = buildLocationHref(baseHref, path, accountId);
  port.replaceState(createHistoryState(accountId, path), url);
};

export const pushPath = (
  port: HistoryPort,
  accountId: string,
  path: string,
  baseHref: string
): void => {
  const url = buildLocationHref(baseHref, path, accountId);
  port.pushState(createHistoryState(accountId, path), url);
};

export const syncPathToUrl = (
  port: HistoryPort,
  input: {
    readonly path: string;
    readonly accountId?: string;
    readonly baseHref: string;
  }
): void => {
  const current = parseHistoryState(port.getState());
  const accountId = input.accountId ?? current?.accountId ?? "";
  const url = buildLocationHref(input.baseHref, input.path, accountId);
  const nextState = current
    ? createHistoryState(accountId, input.path, current.surface)
    : createHistoryState(accountId, input.path);
  port.replaceState(nextState, url);
};

export const readCurrentHistoryState = (port: HistoryPort) => parseHistoryState(port.getState());
