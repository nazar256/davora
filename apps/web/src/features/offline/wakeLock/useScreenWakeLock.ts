import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WakeLockReason, ScreenWakeLockState } from "./model";
import type { ScreenWakeLockPort, WakeLockSentinelPort } from "./ports";

interface OwnedSentinel {
  readonly sentinel: WakeLockSentinelPort;
  disposeReleaseListener: () => void;
}

function createIdempotentDisposer(dispose: () => void): () => void {
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    dispose();
  };
}

export function useScreenWakeLock(options: {
  enabled: boolean;
  reasons: WakeLockReason[];
  ports: ScreenWakeLockPort;
}) {
  const reasonsKey = options.reasons.join("\0");
  const reasons = useMemo(() => [...new Set(options.reasons)], [reasonsKey]);
  const supported = options.ports.isSupported();
  const desired = options.enabled && reasons.length > 0;
  const desiredRef = useRef(desired);
  const mountedRef = useRef(true);
  const enabledRef = useRef(options.enabled);
  const supportedRef = useRef(supported);
  const ownedSentinelRef = useRef<OwnedSentinel>();
  const requestRef = useRef<Promise<WakeLockSentinelPort>>();
  const [state, setState] = useState<ScreenWakeLockState>(() => {
    if (!options.enabled) {
      return "disabled";
    }
    return supported ? "idle" : "unsupported";
  });

  desiredRef.current = desired;
  enabledRef.current = options.enabled;
  supportedRef.current = supported;

  const resolveReleasedState = useCallback((): ScreenWakeLockState => {
    if (!enabledRef.current) {
      return "disabled";
    }
    return supportedRef.current ? "idle" : "unsupported";
  }, []);

  const detachOwnedSentinel = useCallback((expected?: OwnedSentinel): OwnedSentinel | undefined => {
    const ownedSentinel = ownedSentinelRef.current;
    if (!ownedSentinel || (expected && ownedSentinel !== expected)) {
      return undefined;
    }
    ownedSentinelRef.current = undefined;
    ownedSentinel.disposeReleaseListener();
    return ownedSentinel;
  }, []);

  const releaseCurrent = useCallback(async () => {
    requestRef.current = undefined;
    const ownedSentinel = detachOwnedSentinel();
    if (mountedRef.current) {
      setState(resolveReleasedState());
    }
    if (ownedSentinel && !ownedSentinel.sentinel.released) {
      await ownedSentinel.sentinel.release().catch(() => undefined);
    }
  }, [detachOwnedSentinel, resolveReleasedState]);

  const acquire = useCallback(async () => {
    if (!options.ports.isSupported()
      || !desiredRef.current
      || options.ports.getVisibilityState() !== "visible"
      || ownedSentinelRef.current
      || requestRef.current) {
      return;
    }

    if (mountedRef.current) {
      setState("requesting");
    }
    const request = options.ports.requestScreenWakeLock();
    requestRef.current = request;

    try {
      const sentinel = await request;
      if (requestRef.current !== request) {
        await sentinel.release().catch(() => undefined);
        return;
      }
      requestRef.current = undefined;

      if (!mountedRef.current
        || !desiredRef.current
        || options.ports.getVisibilityState() !== "visible") {
        await sentinel.release().catch(() => undefined);
        if (mountedRef.current) {
          setState(resolveReleasedState());
        }
        return;
      }

      const ownedSentinel: OwnedSentinel = {
        sentinel,
        disposeReleaseListener: () => undefined
      };
      ownedSentinelRef.current = ownedSentinel;
      const onRelease = () => {
        const detached = detachOwnedSentinel(ownedSentinel);
        if (!detached) {
          return;
        }
        if (mountedRef.current) {
          setState(resolveReleasedState());
        }
      };
      ownedSentinel.disposeReleaseListener = createIdempotentDisposer(sentinel.onRelease(onRelease));
      if (ownedSentinelRef.current !== ownedSentinel) {
        ownedSentinel.disposeReleaseListener();
        return;
      }
      setState("active");
    } catch {
      if (requestRef.current !== request) {
        return;
      }
      requestRef.current = undefined;
      if (mountedRef.current
        && desiredRef.current
        && supportedRef.current
        && options.ports.getVisibilityState() === "visible") {
        setState("denied");
      }
    }
  }, [detachOwnedSentinel, options.ports, resolveReleasedState]);

  useEffect(() => {
    if (!options.enabled) {
      void releaseCurrent();
      setState("disabled");
      return;
    }
    if (!supported) {
      void releaseCurrent();
      setState("unsupported");
      return;
    }
    if (!desired) {
      void releaseCurrent();
      return;
    }
    void acquire();
  }, [acquire, desired, options.enabled, reasonsKey, releaseCurrent, supported]);

  useEffect(() => {
    return options.ports.subscribeVisibilityChange(() => {
      if (options.ports.getVisibilityState() === "visible") {
        if (desiredRef.current) {
          void acquire();
        }
        return;
      }
      void releaseCurrent();
    });
  }, [acquire, options.ports, releaseCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const ownedSentinel = detachOwnedSentinel();
      if (ownedSentinel && !ownedSentinel.sentinel.released) {
        void ownedSentinel.sentinel.release().catch(() => undefined);
      }
    };
  }, [detachOwnedSentinel]);

  return { state, reasons, supported };
}
