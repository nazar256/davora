/** Local structural copies keep platform adapters independent of feature modules. */
export interface BrowserWakeLockSentinelPort {
  readonly released: boolean;
  release(): Promise<void>;
  onRelease(listener: () => void): () => void;
}

export interface BrowserScreenWakeLockPort {
  isSupported(): boolean;
  getVisibilityState(): DocumentVisibilityState;
  subscribeVisibilityChange(listener: () => void): () => void;
  requestScreenWakeLock(): Promise<BrowserWakeLockSentinelPort>;
}

interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release: () => Promise<void>;
}

interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

type NavigatorWithWakeLock = Navigator & { wakeLock?: WakeLockLike };

export const createBrowserScreenWakeLockPort = (
  resolveNavigator: () => NavigatorWithWakeLock = () => navigator,
  resolveDocument: () => Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = () => document
): BrowserScreenWakeLockPort => {
  const wrapSentinel = (sentinel: WakeLockSentinelLike): BrowserWakeLockSentinelPort => ({
    get released() {
      return sentinel.released;
    },
    release: () => sentinel.release(),
    onRelease(listener) {
      sentinel.addEventListener("release", listener, { once: true });
      return () => sentinel.removeEventListener("release", listener);
    }
  });

  return {
    isSupported() {
      return Boolean(resolveNavigator().wakeLock);
    },
    getVisibilityState() {
      return resolveDocument().visibilityState;
    },
    subscribeVisibilityChange(listener) {
      const documentRef = resolveDocument();
      documentRef.addEventListener("visibilitychange", listener);
      return () => documentRef.removeEventListener("visibilitychange", listener);
    },
    async requestScreenWakeLock() {
      const wakeLock = resolveNavigator().wakeLock;
      if (!wakeLock) {
        throw new Error("Screen wake lock is unsupported");
      }
      return wrapSentinel(await wakeLock.request("screen"));
    }
  } satisfies BrowserScreenWakeLockPort;
};
