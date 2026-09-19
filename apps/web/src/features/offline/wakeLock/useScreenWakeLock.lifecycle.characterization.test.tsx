import { StrictMode, type ComponentType, type PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useScreenWakeLock,
  type ScreenWakeLockPort,
  type ScreenWakeLockState,
  type WakeLockReason,
  type WakeLockSentinelPort
} from "./index";

type HookProps = {
  readonly enabled: boolean;
  readonly reasons: WakeLockReason[];
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

class TestWakeLockSentinel implements WakeLockSentinelPort {
  private releasedValue = false;
  private readonly listeners = new Set<() => void>();
  private readonly releaseGate: Deferred<void> | undefined;

  releaseCalls = 0;
  releaseListenerRegistrations = 0;
  releaseListenerDisposerCalls = 0;
  releaseSettled = false;

  constructor(
    readonly id: string,
    private readonly releaseRejects = false,
    deferRelease = false
  ) {
    this.releaseGate = deferRelease ? createDeferred<void>() : undefined;
  }

  get released(): boolean {
    return this.releasedValue;
  }

  get liveReleaseListenerCount(): number {
    return this.listeners.size;
  }

  release(): Promise<void> {
    this.releaseCalls += 1;
    if (this.releaseRejects) {
      this.releaseSettled = true;
      return Promise.reject(new Error(`release failed for ${this.id}`));
    }
    if (this.releaseGate) {
      return this.releaseGate.promise.then(() => {
        this.releasedValue = true;
        this.releaseSettled = true;
      });
    }
    this.releasedValue = true;
    this.releaseSettled = true;
    return Promise.resolve();
  }

  onRelease(listener: () => void): () => void {
    this.releaseListenerRegistrations += 1;
    this.listeners.add(listener);
    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      this.releaseListenerDisposerCalls += 1;
      this.listeners.delete(listener);
    };
  }

  resolveRelease(): void {
    this.releaseGate?.resolve(undefined);
  }

  simulateExternalRelease(): void {
    this.releasedValue = true;
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) {
      listener();
    }
  }
}

interface RequestRecord {
  readonly id: number;
  readonly deferred: Deferred<WakeLockSentinelPort>;
  settled: boolean;
}

interface WakeLockFixture {
  readonly port: ScreenWakeLockPort;
  readonly requests: RequestRecord[];
  readonly sentinels: TestWakeLockSentinel[];
  readonly setVisibility: (state: DocumentVisibilityState) => void;
  readonly liveVisibilitySubscriptionCount: () => number;
  readonly visibilitySubscribeCalls: () => number;
  readonly visibilityUnsubscribeCalls: () => number;
  createSentinel(options?: { readonly releaseRejects?: boolean; readonly deferRelease?: boolean }): TestWakeLockSentinel;
}

function createWakeLockFixture(): WakeLockFixture {
  let visibilityState: DocumentVisibilityState = "visible";
  let visibilitySubscribeCount = 0;
  let visibilityUnsubscribeCount = 0;
  const visibilityListeners = new Set<() => void>();
  const requests: RequestRecord[] = [];
  const sentinels: TestWakeLockSentinel[] = [];

  const port: ScreenWakeLockPort = {
    isSupported: () => true,
    getVisibilityState: () => visibilityState,
    subscribeVisibilityChange(listener) {
      visibilitySubscribeCount += 1;
      visibilityListeners.add(listener);
      let disposed = false;
      return () => {
        if (disposed) {
          return;
        }
        disposed = true;
        visibilityUnsubscribeCount += 1;
        visibilityListeners.delete(listener);
      };
    },
    requestScreenWakeLock() {
      const record: RequestRecord = {
        id: requests.length + 1,
        deferred: createDeferred<WakeLockSentinelPort>(),
        settled: false
      };
      requests.push(record);
      record.deferred.promise.then(
        () => { record.settled = true; },
        () => { record.settled = true; }
      );
      return record.deferred.promise;
    }
  };

  return {
    port,
    requests,
    sentinels,
    setVisibility(state) {
      visibilityState = state;
      for (const listener of [...visibilityListeners]) {
        listener();
      }
    },
    liveVisibilitySubscriptionCount: () => visibilityListeners.size,
    visibilitySubscribeCalls: () => visibilitySubscribeCount,
    visibilityUnsubscribeCalls: () => visibilityUnsubscribeCount,
    createSentinel(options = {}) {
      const sentinel = new TestWakeLockSentinel(
        `sentinel-${sentinels.length + 1}`,
        options.releaseRejects ?? false,
        options.deferRelease ?? false
      );
      sentinels.push(sentinel);
      return sentinel;
    }
  };
}

async function settleMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function resolveRequest(record: RequestRecord, sentinel: WakeLockSentinelPort): Promise<void> {
  await act(async () => {
    record.deferred.resolve(sentinel);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function rejectRequest(record: RequestRecord, reason = new Error("request denied")): Promise<void> {
  await act(async () => {
    record.deferred.reject(reason);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mountWakeLock(fixture: WakeLockFixture, initialProps: HookProps, wrapper?: ComponentType<PropsWithChildren>) {
  return renderHook(
    (props: HookProps) => useScreenWakeLock({ ...props, ports: fixture.port }),
    { initialProps, wrapper }
  );
}

function expectKnownState(state: ScreenWakeLockState): void {
  expect(["disabled", "unsupported", "idle", "requesting", "active", "denied"]).toContain(state);
}

function expectNoLiveFixtureWork(fixture: WakeLockFixture): void {
  expect(fixture.liveVisibilitySubscriptionCount()).toBe(0);
  expect(fixture.requests.every((request) => request.settled)).toBe(true);
  expect(fixture.sentinels.every((sentinel) => sentinel.liveReleaseListenerCount === 0)).toBe(true);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useScreenWakeLock async lifetime characterization", () => {
  it("deduplicates reasons and owns one request and sentinel across rerenders", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, {
      enabled: true,
      reasons: ["download", "download"]
    });
    const request = fixture.requests[0];
    const sentinel = fixture.createSentinel();

    expect(request).toBeDefined();
    expect(hook.result.current.state).toBe("requesting");
    expect(hook.result.current.reasons).toEqual(["download"]);
    await resolveRequest(request, sentinel);
    expect(hook.result.current.state).toBe("active");
    expect(sentinel.releaseListenerRegistrations).toBe(1);

    act(() => {
      hook.rerender({ enabled: true, reasons: ["offlineSync", "download", "offlineSync"] });
    });
    expect(hook.result.current.reasons).toEqual(["offlineSync", "download"]);
    expect(fixture.requests).toHaveLength(1);
    expect(hook.result.current.state).toBe("active");
    expectKnownState(hook.result.current.state);

    hook.unmount();
    await settleMicrotasks();
    expect(sentinel.releaseCalls).toBe(1);
    expect(fixture.visibilitySubscribeCalls()).toBe(1);
    expect(fixture.visibilityUnsubscribeCalls()).toBe(1);
    expectNoLiveFixtureWork(fixture);
  });

  it.each([
    ["last reason removed", "idle"] as const,
    ["keep-awake disabled", "disabled"] as const
  ])("releases a late success when %s", async (caseName, expectedState) => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["download"] });
    const request = fixture.requests[0];
    const lateSentinel = fixture.createSentinel();

    expect(request).toBeDefined();
    act(() => {
      if (caseName === "last reason removed") {
        hook.rerender({ enabled: true, reasons: [] });
      } else {
        hook.rerender({ enabled: false, reasons: ["download"] });
      }
    });
    expect(hook.result.current.state).toBe(expectedState);
    await resolveRequest(request, lateSentinel);

    expect(lateSentinel.releaseCalls).toBe(1);
    expect(lateSentinel.releaseListenerRegistrations).toBe(0);
    expect(lateSentinel.liveReleaseListenerCount).toBe(0);
    expect(hook.result.current.state).toBe(expectedState);
    hook.unmount();
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });

  it("releases a late success after hidden visibility without publishing it", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["offlineSync"] });
    const request = fixture.requests[0];
    const lateSentinel = fixture.createSentinel();

    act(() => fixture.setVisibility("hidden"));
    expect(hook.result.current.state).toBe("idle");
    await resolveRequest(request, lateSentinel);

    expect(lateSentinel.releaseCalls).toBe(1);
    expect(lateSentinel.releaseListenerRegistrations).toBe(0);
    expect(hook.result.current.state).toBe("idle");
    hook.unmount();
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });

  it("releases a late success after unmount without a post-unmount warning", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["download"] });
    const request = fixture.requests[0];
    const lateSentinel = fixture.createSentinel();
    const consoleError = vi.spyOn(console, "error");

    hook.unmount();
    await resolveRequest(request, lateSentinel);

    expect(lateSentinel.releaseCalls).toBe(1);
    expect(lateSentinel.releaseListenerRegistrations).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    expectNoLiveFixtureWork(fixture);
  });

  it("reports a current visible rejection as denied", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["download"] });

    await rejectRequest(fixture.requests[0]);

    expect(hook.result.current.state).toBe("denied");
    hook.unmount();
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });

  it.each([
    ["last reason removed", "idle"] as const,
    ["keep-awake disabled", "disabled"] as const,
    ["hidden visibility", "idle"] as const
  ])("ignores a stale rejection after %s", async (caseName, expectedState) => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["download"] });

    act(() => {
      if (caseName === "last reason removed") {
        hook.rerender({ enabled: true, reasons: [] });
      } else if (caseName === "keep-awake disabled") {
        hook.rerender({ enabled: false, reasons: ["download"] });
      } else {
        fixture.setVisibility("hidden");
      }
    });
    await rejectRequest(fixture.requests[0]);

    expect(hook.result.current.state).toBe(expectedState);
    hook.unmount();
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });

  it("ignores a rejection after unmount and leaves no warning or live work", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["download"] });
    const consoleError = vi.spyOn(console, "error");

    hook.unmount();
    await rejectRequest(fixture.requests[0]);

    expect(consoleError).not.toHaveBeenCalled();
    expectNoLiveFixtureWork(fixture);
  });

  it.each([
    ["disabled", "disabled"] as const,
    ["last reason removed", "idle"] as const,
    ["hidden visibility", "idle"] as const,
    ["unmount", "unmounted"] as const
  ])("releases an owned sentinel exactly once on %s", async (caseName, expectedState) => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["download"] });
    const sentinel = fixture.createSentinel();
    await resolveRequest(fixture.requests[0], sentinel);

    act(() => {
      if (caseName === "disabled") {
        hook.rerender({ enabled: false, reasons: ["download"] });
      } else if (caseName === "last reason removed") {
        hook.rerender({ enabled: true, reasons: [] });
      } else if (caseName === "hidden visibility") {
        fixture.setVisibility("hidden");
      } else {
        hook.unmount();
      }
    });
    await settleMicrotasks();

    if (expectedState !== "unmounted") {
      expect(hook.result.current.state).toBe(expectedState);
    }
    expect(sentinel.releaseCalls).toBe(1);
    expect(sentinel.releaseListenerDisposerCalls).toBe(1);
    expect(sentinel.liveReleaseListenerCount).toBe(0);

    act(() => {
      if (caseName === "disabled") {
        hook.rerender({ enabled: false, reasons: ["download"] });
      } else if (caseName === "last reason removed") {
        hook.rerender({ enabled: true, reasons: [] });
      } else if (caseName === "hidden visibility") {
        fixture.setVisibility("hidden");
      }
      sentinel.simulateExternalRelease();
    });
    await settleMicrotasks();
    expect(sentinel.releaseCalls).toBe(1);
    expect(sentinel.liveReleaseListenerCount).toBe(0);

    if (caseName !== "unmount") {
      hook.unmount();
    }
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });

  it("disposes the release listener even when sentinel release rejects", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["download"] });
    const sentinel = fixture.createSentinel({ releaseRejects: true });
    await resolveRequest(fixture.requests[0], sentinel);

    act(() => hook.rerender({ enabled: false, reasons: ["download"] }));
    await settleMicrotasks();

    expect(sentinel.releaseCalls).toBe(1);
    expect(sentinel.releaseSettled).toBe(true);
    expect(sentinel.releaseListenerDisposerCalls).toBe(1);
    expect(sentinel.liveReleaseListenerCount).toBe(0);
    hook.unmount();
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });

  it("does not let an old external release clear a replacement sentinel", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["offlineSync"] });
    const first = fixture.createSentinel();
    await resolveRequest(fixture.requests[0], first);

    act(() => fixture.setVisibility("hidden"));
    expect(first.releaseCalls).toBe(1);
    act(() => fixture.setVisibility("visible"));
    const secondRequest = fixture.requests[1];
    const second = fixture.createSentinel();
    expect(secondRequest).toBeDefined();
    await resolveRequest(secondRequest, second);
    expect(hook.result.current.state).toBe("active");

    act(() => first.simulateExternalRelease());
    expect(hook.result.current.state).toBe("active");
    expect(second.liveReleaseListenerCount).toBe(1);

    act(() => second.simulateExternalRelease());
    expect(hook.result.current.state).toBe("idle");
    hook.unmount();
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });

  it("balances visibility ownership and avoids duplicate acquisition under StrictMode", async () => {
    const fixture = createWakeLockFixture();
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["download"] }, wrapper);
    const sentinel = fixture.createSentinel();

    expect(fixture.visibilitySubscribeCalls()).toBe(2);
    expect(fixture.liveVisibilitySubscriptionCount()).toBe(1);
    expect(fixture.requests).toHaveLength(1);
    await resolveRequest(fixture.requests[0], sentinel);
    expect(hook.result.current.state).toBe("active");

    hook.unmount();
    await settleMicrotasks();
    expect(fixture.visibilityUnsubscribeCalls()).toBe(2);
    expect(fixture.liveVisibilitySubscriptionCount()).toBe(0);
    expect(fixture.requests).toHaveLength(1);
    expectNoLiveFixtureWork(fixture);
  });

  it("reacquires only when visible, enabled, and still needed", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: true, reasons: ["offlineSync"] });
    const first = fixture.createSentinel();
    await resolveRequest(fixture.requests[0], first);

    act(() => fixture.setVisibility("hidden"));
    expect(first.releaseCalls).toBe(1);
    expect(hook.result.current.state).toBe("idle");
    act(() => fixture.setVisibility("visible"));
    const secondRequest = fixture.requests[1];
    const second = fixture.createSentinel();
    expect(secondRequest).toBeDefined();
    await resolveRequest(secondRequest, second);
    expect(hook.result.current.state).toBe("active");

    act(() => hook.rerender({ enabled: false, reasons: ["offlineSync"] }));
    act(() => {
      fixture.setVisibility("hidden");
      fixture.setVisibility("visible");
    });
    expect(fixture.requests).toHaveLength(2);
    expect(hook.result.current.state).toBe("disabled");

    act(() => hook.rerender({ enabled: true, reasons: [] }));
    act(() => {
      fixture.setVisibility("hidden");
      fixture.setVisibility("visible");
    });
    expect(fixture.requests).toHaveLength(2);
    expect(hook.result.current.state).toBe("idle");
    hook.unmount();
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });

  it("keeps the public state projection finite and quiesces all work after unmount", async () => {
    const fixture = createWakeLockFixture();
    const hook = mountWakeLock(fixture, { enabled: false, reasons: ["download", "download"] });

    expect(hook.result.current.state).toBe("disabled");
    expect(hook.result.current.reasons).toEqual(["download"]);
    expectKnownState(hook.result.current.state);

    act(() => hook.rerender({ enabled: true, reasons: ["download", "transferQueue", "download"] }));
    const sentinel = fixture.createSentinel();
    await resolveRequest(fixture.requests[0], sentinel);
    expect(hook.result.current.state).toBe("active");
    expect(hook.result.current.reasons).toEqual(["download", "transferQueue"]);
    expectKnownState(hook.result.current.state);

    hook.unmount();
    await settleMicrotasks();
    expectNoLiveFixtureWork(fixture);
  });
});
