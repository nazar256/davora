import { StateBanner, type StateBannerProps } from "../../../components/StateBanner";

export interface WorkspaceStatusStageProps {
  readonly banner: StateBannerProps;
  readonly offlineToggle?: {
    readonly label: string;
    readonly onToggle: () => void;
  };
}

export function WorkspaceStatusStage({ banner, offlineToggle }: WorkspaceStatusStageProps) {
  return (
    <div className="state-banner-slot">
      <StateBanner {...banner} />
      {offlineToggle ? (
        <button
          className="quiet-button offline-mode-toggle"
          onClick={offlineToggle.onToggle}
          type="button"
        >
          {offlineToggle.label}
        </button>
      ) : null}
    </div>
  );
}
