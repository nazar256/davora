import { useCallback, useRef } from "react";

export interface RetentionSelectionChromeCoordinationPorts {
  readonly clearFocusedSelection: () => void;
  readonly clearBatchSelection: () => void;
  readonly closeMobileDetails: () => void;
  readonly closePreviewAndNavigation: () => void;
}

export interface RetentionSelectionChromeCoordination {
  readonly clearSelectionChrome: () => void;
}

export function useRetentionSelectionChromeCoordination(
  ports: RetentionSelectionChromeCoordinationPorts
): RetentionSelectionChromeCoordination {
  const portsRef = useRef(ports);
  portsRef.current = ports;

  const clearSelectionChrome = useCallback(() => {
    const currentPorts = portsRef.current;
    currentPorts.clearFocusedSelection();
    currentPorts.clearBatchSelection();
    currentPorts.closeMobileDetails();
    currentPorts.closePreviewAndNavigation();
  }, []);

  return { clearSelectionChrome };
}
