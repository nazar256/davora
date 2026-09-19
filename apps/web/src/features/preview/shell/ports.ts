import type { AudioPreviewResumeTarget } from "../audio";
import type { PdfPreviewRuntimePorts } from "../pdf";
import type { VideoPreviewRuntimePorts } from "../video";

export type { AudioPreviewResumeTarget } from "../audio";

export interface OriginalFileOpenTask {
  readonly completion: Promise<void>;
  cancel(): void;
}

export interface OriginalFileOpenPorts {
  startOriginalFileOpen(input: { readonly path: string; readonly token: string }): OriginalFileOpenTask;
}

export interface PreviewModalRuntimePorts extends OriginalFileOpenPorts {
  readonly pdf: PdfPreviewRuntimePorts;
  readonly video: VideoPreviewRuntimePorts;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timeoutId: number | undefined): void;
  getLocationHref(): string;
  addWindowKeydownListener(listener: (event: KeyboardEvent) => void): () => void;
  loadAudioPreviewPosition(target: AudioPreviewResumeTarget): number | undefined;
  saveAudioPreviewPosition(target: AudioPreviewResumeTarget, positionSeconds: number): void;
  clearAudioPreviewPosition(target: AudioPreviewResumeTarget): void;
}
