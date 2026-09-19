/** Local structural copies keep platform adapters independent of feature modules. */
export interface BrowserSelectionTimerPrimitives {
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (timeoutId: number) => void;
}

export interface BrowserSelectionTimerPorts {
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (timeoutId: number | undefined) => void;
}

function createDefaultBrowserSelectionTimerPrimitives(): BrowserSelectionTimerPrimitives {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timeoutId) => window.clearTimeout(timeoutId)
  };
}

export function createBrowserSelectionTimerPorts(
  primitives: BrowserSelectionTimerPrimitives = createDefaultBrowserSelectionTimerPrimitives()
): BrowserSelectionTimerPorts {
  return {
    setTimeout: primitives.setTimeout,
    clearTimeout: (timeoutId) => {
      if (timeoutId !== undefined) {
        primitives.clearTimeout(timeoutId);
      }
    }
  };
}
