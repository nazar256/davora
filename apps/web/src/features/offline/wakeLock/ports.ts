export interface WakeLockSentinelPort {
  readonly released: boolean;
  release(): Promise<void>;
  onRelease(listener: () => void): () => void;
}

export interface ScreenWakeLockPort {
  isSupported(): boolean;
  getVisibilityState(): DocumentVisibilityState;
  subscribeVisibilityChange(listener: () => void): () => void;
  requestScreenWakeLock(): Promise<WakeLockSentinelPort>;
}
