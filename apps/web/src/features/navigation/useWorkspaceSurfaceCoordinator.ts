import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { OpenSurfacesSnapshot } from "./model";
import type { HistoryPort } from "./ports";
import {
  applyWorkspacePopState,
  getWorkspaceOpenSurfaces,
  type WorkflowSurfacePorts,
  type WorkspaceSurfaceCoordinatorNavigation
} from "./workspaceSurfaceController";

export type { WorkflowSurfacePort, WorkflowSurfacePorts, WorkspaceSurfaceCoordinatorNavigation } from "./workspaceSurfaceController";

export interface WorkspaceSurfaceCoordinatorInput {
  readonly port: HistoryPort;
  readonly workflow: WorkflowSurfacePorts;
  readonly navigation: WorkspaceSurfaceCoordinatorNavigation;
}

/** Owns the single late workspace-surface history subscription. */
export const useWorkspaceSurfaceCoordinator = (input: WorkspaceSurfaceCoordinatorInput) => {
  const inputRef = useRef(input);
  const subscriptionGenerationRef = useRef(0);

  useLayoutEffect(() => {
    inputRef.current = input;
  }, [input]);

  const getOpenSurfaces = useCallback((): OpenSurfacesSnapshot => {
    return getWorkspaceOpenSurfaces(inputRef.current);
  }, []);

  useEffect(() => {
    const subscribedPort = input.port;
    const generation = ++subscriptionGenerationRef.current;
    let active = true;
    const subscribedHandler = (historyState: unknown) => {
      if (!active
        || subscriptionGenerationRef.current !== generation
        || inputRef.current.port !== subscribedPort) {
        return;
      }
      applyWorkspacePopState(historyState, inputRef.current);
    };
    const unsubscribe = subscribedPort.subscribe(subscribedHandler);
    return () => {
      active = false;
      if (subscriptionGenerationRef.current === generation) {
        subscriptionGenerationRef.current += 1;
      }
      unsubscribe();
    };
  }, [input.port]);

  return { getOpenSurfaces } as const;
};
