import { mergeOpenSurfaces, resolvePopStateCommands, type ChromeSurfaceKind, type ChromeSurfacesSnapshot, type DismissSurfaceKind, type OpenSurfacesSnapshot } from "./model";

export interface WorkflowSurfacePort {
  readonly isOpen: () => boolean;
  readonly dismiss: () => void;
}

export interface WorkflowSurfacePorts {
  readonly preview: WorkflowSurfacePort;
  readonly action: WorkflowSurfacePort;
  readonly destination: WorkflowSurfacePort;
  readonly account: WorkflowSurfacePort;
  readonly removeAccount: WorkflowSurfacePort;
}

export interface WorkspaceSurfaceCoordinatorNavigation {
  readonly getCurrentPath: () => string;
  readonly getChromeSnapshot: () => ChromeSurfacesSnapshot;
  readonly dismissChrome: (surface: ChromeSurfaceKind) => void;
  readonly applyHistoryPath: (path: string) => void;
}

export interface WorkspaceSurfaceControllerPorts {
  readonly workflow: WorkflowSurfacePorts;
  readonly navigation: WorkspaceSurfaceCoordinatorNavigation;
}

const workflowSnapshot = (ports: WorkflowSurfacePorts) => ({
  preview: ports.preview.isOpen(),
  action: ports.action.isOpen(),
  destination: ports.destination.isOpen(),
  account: ports.account.isOpen(),
  removeAccount: ports.removeAccount.isOpen()
});

const isChromeSurface = (surface: DismissSurfaceKind): surface is ChromeSurfaceKind =>
  surface === "settings"
  || surface === "search"
  || surface === "navigation"
  || surface === "mobile-details"
  || surface === "transfers";

const dismissWorkflowSurface = (ports: WorkflowSurfacePorts, surface: DismissSurfaceKind): boolean => {
  switch (surface) {
    case "preview":
      ports.preview.dismiss();
      return true;
    case "action":
      ports.action.dismiss();
      return true;
    case "destination":
      ports.destination.dismiss();
      return true;
    case "account":
      ports.account.dismiss();
      return true;
    case "remove-account":
      ports.removeAccount.dismiss();
      return true;
    case "settings":
    case "search":
    case "navigation":
    case "mobile-details":
    case "transfers":
      return false;
  }
};

export const getWorkspaceOpenSurfaces = (
  ports: WorkspaceSurfaceControllerPorts
): OpenSurfacesSnapshot => mergeOpenSurfaces(
  ports.navigation.getChromeSnapshot(),
  workflowSnapshot(ports.workflow)
);

export const applyWorkspacePopState = (
  historyState: unknown,
  ports: WorkspaceSurfaceControllerPorts
): void => {
  const commands = resolvePopStateCommands({
    historyState,
    currentPath: ports.navigation.getCurrentPath(),
    openSurfaces: getWorkspaceOpenSurfaces(ports)
  });
  for (const command of commands) {
    if (command.kind === "dismiss") {
      if (dismissWorkflowSurface(ports.workflow, command.surface)) continue;
      if (isChromeSurface(command.surface)) ports.navigation.dismissChrome(command.surface);
    } else {
      ports.navigation.applyHistoryPath(command.path);
    }
  }
};
