export interface VideoPreviewRuntimePorts {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timeoutId: number | undefined): void;
  getLocationHref(): string;
}
