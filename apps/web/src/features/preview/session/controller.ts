import {
  closedPreviewSession,
  createPreviewRequestKey,
  createPreviewSessionState,
  type PreviewOpenRequest,
  type PreviewRequestKey,
  type PreviewSessionState,
  type PreviewSnapshot
} from "./model";
import type { PreviewAcquisition, PreviewAbortHandle, PreviewCacheSnapshot, PreviewFailure, PreviewResource, PreviewSessionPorts } from "./ports";

export type PreviewOpenOutcome =
  | { readonly kind: "opened"; readonly key: PreviewRequestKey }
  | { readonly kind: "download-original" }
  | { readonly kind: "failed"; readonly key: PreviewRequestKey; readonly message: string }
  | { readonly kind: "session-terminated"; readonly key: PreviewRequestKey; readonly reason: "session-expired" | "reconnect-required" }
  | { readonly kind: "superseded"; readonly key: PreviewRequestKey };

export type PreviewApplyRefreshOutcome =
  | { readonly kind: "applied"; readonly key: PreviewRequestKey }
  | { readonly kind: "not-ready" }
  | { readonly kind: "superseded"; readonly key: PreviewRequestKey };

interface ActivePreviewSession {
  readonly key: PreviewRequestKey;
  readonly abort: PreviewAbortHandle;
  applied?: PreviewResource;
  pending?: PreviewAcquisition;
  background?: Promise<void>;
  retired: boolean;
}

type CacheWriteOutcome =
  | { readonly kind: "written"; readonly snapshot: PreviewCacheSnapshot }
  | { readonly kind: "skipped"; readonly reason: "over-limit" | "not-cacheable" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "session-terminated"; readonly reason: "session-expired" | "reconnect-required" }
  | { readonly kind: "superseded" };

type RecoverableFailure = Exclude<PreviewFailure, { readonly kind: "aborted" } | { readonly kind: "session-terminal" }>;
type FailureOutcome =
  | { readonly kind: "recoverable"; readonly failure: RecoverableFailure }
  | { readonly kind: "session-terminated"; readonly reason: "session-expired" | "reconnect-required" }
  | { readonly kind: "superseded" };

function isFresh(cachedAtMs: number, key: PreviewRequestKey, now: number): boolean {
  return now - cachedAtMs <= key.freshnessIntervalMs;
}

export class PreviewSessionController {
  private nextRequestSequence = 1;
  private active: ActivePreviewSession | undefined;

  constructor(private readonly ports: PreviewSessionPorts) {}

  async open(request: PreviewOpenRequest): Promise<PreviewOpenOutcome> {
    if (request.target === "ordinary-unsupported") {
      return { kind: "download-original" };
    }

    this.retireActive();
    const key = createPreviewRequestKey({ ...request, requestSequence: this.nextRequestSequence++ });
    const active: ActivePreviewSession = { key, abort: this.ports.abort.create(), retired: false };
    this.active = active;
    if (!this.publish(active, { kind: "opening", key })) {
      return { kind: "superseded", key };
    }

    let cached;
    try {
      cached = await this.ports.cache.read(key, active.abort);
    } catch (error) {
      const failure = this.handleFailure(active, error);
      if (failure.kind === "session-terminated") {
        return { kind: "session-terminated", key, reason: failure.reason };
      }
      if (failure.kind === "superseded") {
        return { kind: "superseded", key };
      }
      cached = undefined;
    }
    if (!this.isActive(active)) {
      return { kind: "superseded", key };
    }

    if (cached) {
      const cacheStatus = key.connectionMode === "cache-only"
        ? "cache-only"
        : isFresh(cached.cachedAtMs, key, this.ports.clock.now())
          ? "fresh"
          : "refreshing";
      if (!this.apply(active, { kind: "cached", key, current: cached.acquisition.snapshot, status: cacheStatus, ...(cached.cachedAt === undefined ? {} : { cachedAt: cached.cachedAt }) }, cached.acquisition)) {
        return { kind: "superseded", key };
      }
      if (cacheStatus === "refreshing") {
        active.background = this.refresh(active, cached.acquisition.snapshot, cached.cachedAt);
      }
      return { kind: "opened", key };
    }

    if (key.connectionMode === "cache-only") {
      return this.failIfCurrent(active, "No cached preview is available for this file.");
    }

    return this.acquireLive(active);
  }

  close(): void {
    const active = this.active;
    this.retireActive();
    if (active && this.ports.current.isCurrent(active.key)) {
      this.ports.publication.publish(closedPreviewSession());
    }
  }

  /** Account/session/mode/unmount ownership has changed; do not publish into it. */
  invalidate(): void {
    this.retireActive();
  }

  async applyRefresh(): Promise<PreviewApplyRefreshOutcome> {
    const active = this.active;
    if (!active?.pending) {
      return { kind: "not-ready" };
    }
    if (!this.isActive(active)) {
      return { kind: "superseded", key: active.key };
    }
    const pending = active.pending;
    if (!this.apply(active, { kind: "live", key: active.key, current: pending.snapshot }, pending)) {
      return { kind: "superseded", key: active.key };
    }
    active.pending = undefined;
    return { kind: "applied", key: active.key };
  }

  async waitForBackground(): Promise<void> {
    await this.active?.background;
  }

  private async acquireLive(active: ActivePreviewSession): Promise<PreviewOpenOutcome> {
    const { key } = active;
    let live: PreviewAcquisition;
    try {
      live = await this.ports.live.acquire(key, active.abort);
      if (!this.isActive(active)) {
        return { kind: "superseded", key };
      }
    } catch (error) {
      const failure = this.handleFailure(active, error);
      if (failure.kind === "session-terminated") {
        return { kind: "session-terminated", key, reason: failure.reason };
      }
      return failure.kind === "superseded"
        ? { kind: "superseded", key }
        : this.failIfCurrent(active, failure.failure.message);
    }
    if (!this.isActive(active)) {
      return { kind: "superseded", key };
    }
    if (live.snapshot.source === "stream") {
      if (!this.apply(active, { kind: "live", key, current: live.snapshot }, live)) {
        return { kind: "superseded", key };
      }
      active.background = this.persistStream(active, live);
      return { kind: "opened", key };
    }
    const write = await this.writeCurrentCache(active, live);
    if (write.kind === "superseded") {
      return { kind: "superseded", key };
    }
    if (write.kind === "session-terminated") {
      return { kind: "session-terminated", key, reason: write.reason };
    }
    if (write.kind === "failed") {
      return this.failIfCurrent(active, write.message);
    }
    if (!this.apply(active, { kind: "live", key, current: live.snapshot }, live)) {
      return { kind: "superseded", key };
    }
    return { kind: "opened", key };
  }

  private async refresh(active: ActivePreviewSession, current: PreviewSnapshot, cachedAt: string | undefined): Promise<void> {
    let live: PreviewAcquisition;
    try {
      live = await this.ports.live.acquire(active.key, active.abort);
    } catch (error) {
      const failure = this.handleFailure(active, error);
      if (failure.kind === "recoverable") {
        this.publish(active, { kind: "cached", key: active.key, current, status: "refresh-failed", ...(cachedAt === undefined ? {} : { cachedAt }) });
      }
      return;
    }
    if (!this.isActive(active)) {
      return;
    }
    if (live.snapshot.source === "stream") {
      if (live.snapshot.fingerprint === current.fingerprint) {
        this.publish(active, { kind: "cached", key: active.key, current, status: "verified", ...(cachedAt === undefined ? {} : { cachedAt }) });
        if (current.source === "stream") {
          // Metadata-only cached entries never held a Blob; persist the
          // identical live stream so the offline copy still completes.
          active.background = this.persistStream(active, live);
        }
        return;
      }
      if (this.apply(active, { kind: "live", key: active.key, current: live.snapshot }, live)) {
        active.background = this.persistStream(active, live);
      }
      return;
    }
    const write = await this.writeCurrentCache(active, live);
    if (write.kind === "superseded" || write.kind === "session-terminated") {
      return;
    }
    if (write.kind === "skipped") {
      this.publish(active, { kind: "cached", key: active.key, current, status: "refresh-skipped", ...(cachedAt === undefined ? {} : { cachedAt }) });
      return;
    }
    if (write.kind === "failed") {
      this.publish(active, { kind: "cached", key: active.key, current, status: "refresh-failed", ...(cachedAt === undefined ? {} : { cachedAt }) });
      return;
    }
    if (live.snapshot.fingerprint === current.fingerprint) {
      this.publish(active, { kind: "cached", key: active.key, current, status: "verified", ...(cachedAt === undefined ? {} : { cachedAt }) });
      return;
    }
    active.pending = live;
    this.publish(active, { kind: "refresh-ready", key: active.key, current, next: live.snapshot, ...(cachedAt === undefined ? {} : { cachedAt }) });
  }

  private failIfCurrent(active: ActivePreviewSession, message: string): PreviewOpenOutcome {
    if (!this.isActive(active) || !this.publish(active, { kind: "failed", key: active.key, message })) {
      return { kind: "superseded", key: active.key };
    }
    return { kind: "failed", key: active.key, message };
  }

  private async writeCurrentCache(active: ActivePreviewSession, acquisition: PreviewAcquisition): Promise<CacheWriteOutcome> {
    if (!this.isActive(active)) {
      return { kind: "superseded" };
    }
    try {
      const result = await this.ports.cache.write(active.key, acquisition, active.abort);
      if (result.kind === "skipped") {
        return result;
      }
      if (!this.isActive(active) || !this.publishCacheSnapshot(active, result.snapshot)) {
        return { kind: "superseded" };
      }
      return { kind: "written", snapshot: result.snapshot };
    } catch (error) {
      const failure = this.handleFailure(active, error);
      if (failure.kind === "session-terminated") {
        return failure;
      }
      return failure.kind === "recoverable"
        ? { kind: "failed", message: failure.failure.message }
        : failure;
    }
  }

  private async persistStream(active: ActivePreviewSession, acquisition: PreviewAcquisition): Promise<void> {
    if (!this.isActive(active)) return;
    try {
      const result = await this.ports.cache.write(active.key, acquisition, active.abort);
      if (result.kind === "skipped") return;
      if (!this.isActive(active) || !this.publishCacheSnapshot(active, result.snapshot)) return;
      this.publishCacheEvent(active, { kind: "stream-cache-ready", key: active.key, snapshot: result.snapshot });
    } catch (error) {
      if (!this.isActive(active)) return;
      const failure = this.ports.failures.classify(error);
      if (failure.kind === "aborted") return;
      this.publishCacheEvent(active, { kind: "stream-cache-failed", key: active.key, message: failure.message });
    }
  }

  private handleFailure(active: ActivePreviewSession, error: unknown): FailureOutcome {
    if (!this.isActive(active)) {
      return { kind: "superseded" };
    }
    const failure = this.ports.failures.classify(error);
    if (failure.kind === "aborted") {
      this.retireActive();
      return { kind: "superseded" };
    }
    if (!this.publishFailure(active, failure)) {
      return { kind: "superseded" };
    }
    if (failure.kind === "session-terminal") {
      this.retireActive();
      return { kind: "session-terminated", reason: failure.reason };
    }
    return { kind: "recoverable", failure };
  }

  private apply(active: ActivePreviewSession, state: PreviewSessionState, acquisition: PreviewAcquisition): boolean {
    if (!this.isActive(active)) {
      return false;
    }
    const next = acquisition.material ? this.ports.resources.apply(acquisition.material) : undefined;
    if (!this.publish(active, state, next)) {
      if (next) this.ports.resources.release(next);
      return false;
    }
    const previous = active.applied;
    active.applied = next;
    if (previous && previous !== next) {
      this.ports.resources.release(previous);
    }
    return true;
  }

  private publish(active: ActivePreviewSession, state: PreviewSessionState, resource = active.applied): boolean {
    if (!this.isActive(active)) {
      return false;
    }
    const accepted = this.ports.publication.publish(createPreviewSessionState(state), resource);
    if (accepted && this.isActive(active)) {
      return true;
    }
    this.retireActive();
    return false;
  }

  private publishCacheSnapshot(active: ActivePreviewSession, snapshot: PreviewCacheSnapshot): boolean {
    if (!this.isActive(active)) {
      return false;
    }
    const accepted = this.ports.cachePublication.publishSnapshot(active.key, snapshot);
    if (accepted && this.isActive(active)) {
      return true;
    }
    this.retireActive();
    return false;
  }

  private publishCacheEvent(active: ActivePreviewSession, event: Parameters<PreviewSessionPorts["cachePublication"]["publishEvent"]>[0]): boolean {
    if (!this.isActive(active)) {
      return false;
    }
    const accepted = this.ports.cachePublication.publishEvent(event);
    if (accepted && this.isActive(active)) {
      return true;
    }
    this.retireActive();
    return false;
  }

  private publishFailure(active: ActivePreviewSession, failure: Exclude<PreviewFailure, { readonly kind: "aborted" }>): boolean {
    if (!this.isActive(active)) return false;
    const accepted = this.ports.failurePublication.publishFailure(active.key, failure);
    if (accepted && this.isActive(active)) return true;
    this.retireActive();
    return false;
  }

  private isActive(active: ActivePreviewSession): boolean {
    return this.active === active && !active.retired && this.ports.current.isCurrent(active.key);
  }

  private retireActive(): void {
    const active = this.active;
    if (!active || active.retired) {
      return;
    }
    active.retired = true;
    active.abort.abort();
    if (active.applied) {
      this.ports.resources.release(active.applied);
      active.applied = undefined;
    }
    active.pending = undefined;
    if (this.active === active) {
      this.active = undefined;
    }
  }
}
