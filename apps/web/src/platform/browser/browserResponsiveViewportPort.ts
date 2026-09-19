const NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT = { kind: "narrow" } as const;
const WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT = { kind: "wide" } as const;

type ResponsiveViewportSnapshot =
  | typeof NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT
  | typeof WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT;

const NARROW_WORKSPACE_MEDIA_QUERY = "(max-width: 900px)";

export interface BrowserResponsiveViewportPort {
  readonly getSnapshot: () => ResponsiveViewportSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createBrowserResponsiveViewportPort(): BrowserResponsiveViewportPort {
  const mediaQuery = window.matchMedia(NARROW_WORKSPACE_MEDIA_QUERY);

  const getSnapshot = (): ResponsiveViewportSnapshot => (
    mediaQuery.matches
      ? NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT
      : WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT
  );

  const subscribe = (listener: () => void): (() => void) => {
    let active = true;
    const onChange = () => {
      if (active) {
        listener();
      }
    };
    mediaQuery.addEventListener("change", onChange);
    return () => {
      if (!active) {
        return;
      }
      active = false;
      mediaQuery.removeEventListener("change", onChange);
    };
  };

  return { getSnapshot, subscribe };
}
