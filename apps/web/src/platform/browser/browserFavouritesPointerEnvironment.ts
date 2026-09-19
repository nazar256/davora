type PointerListenerType = "pointermove" | "pointerup" | "pointercancel";

interface BrowserFavouritesPointerEnvironment {
  elementFromPoint(x: number, y: number): Element | null;
  addWindowListener(
    type: PointerListenerType,
    listener: (event: PointerEvent) => void,
    options?: AddEventListenerOptions
  ): () => void;
}

export function createBrowserFavouritesPointerEnvironment(): BrowserFavouritesPointerEnvironment {
  return {
    elementFromPoint: (x, y) => document.elementFromPoint(x, y),
    addWindowListener: (type, listener, options) => {
      window.addEventListener(type, listener, options);
      return () => window.removeEventListener(type, listener, options);
    }
  };
}
