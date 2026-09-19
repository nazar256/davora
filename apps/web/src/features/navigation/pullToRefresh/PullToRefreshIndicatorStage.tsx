export interface PullToRefreshIndicatorStageProps {
  readonly visible: boolean;
  readonly progress: number;
  readonly refreshing: boolean;
}

export function PullToRefreshIndicatorStage({ visible, progress, refreshing }: PullToRefreshIndicatorStageProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="pull-to-refresh-indicator"
      role="status"
      style={{
        opacity: progress,
        transform: `translateY(${(1 - progress) * 40}px)`
      }}
    >
      <span className="pull-to-refresh-spinner">
        {refreshing
          ? "Refreshing..."
          : progress >= 1
            ? "Release to refresh"
            : "Pull to refresh"}
      </span>
    </div>
  );
}
