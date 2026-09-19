import type { SyntheticEvent } from "react";

import type { MediaStreamState } from "../media";

export interface AudioPreviewStageBindings {
  readonly audioRef: (element: HTMLAudioElement | null) => void;
  readonly audioElementKey: string;
  readonly effectiveSource?: string;
  readonly streamSource: boolean;
  readonly streamState: MediaStreamState;
  readonly retryAttempt: number;
  readonly maxRetries: number;
  readonly autoplayBlocked: boolean;
  readonly onCanPlay: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly onWaiting: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly onError: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly onPlay: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly onPlaying: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly onPause: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly onEnded: (event: SyntheticEvent<HTMLAudioElement>) => void;
  readonly startPlayback: () => void;
  readonly retryStreamNow: () => void;
}

export interface AudioPreviewInteraction {
  readonly stage: AudioPreviewStageBindings;
}
