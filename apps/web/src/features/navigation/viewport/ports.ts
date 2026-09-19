export const NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT = { kind: "narrow" } as const;
export const WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT = { kind: "wide" } as const;

export type ResponsiveViewportSnapshot =
  | typeof NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT
  | typeof WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT;

export type ResponsiveViewportListener = () => void;

export interface ResponsiveViewportPort {
  readonly getSnapshot: () => ResponsiveViewportSnapshot;
  readonly subscribe: (listener: ResponsiveViewportListener) => () => void;
}
