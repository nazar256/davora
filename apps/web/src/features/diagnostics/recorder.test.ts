import { describe, expect, it, vi } from "vitest";

import {
  DIAGNOSTICS_BUFFER_FLUSH_EVENT_COUNT,
  DIAGNOSTICS_MAX_EVENTS_PER_SESSION,
  DIAGNOSTICS_MAX_SESSION_BYTES
} from "./model";
import { createDiagnosticsRecorder } from "./recorder";
import type { DiagnosticsStore, DiagnosticsStoreResult } from "./ports";
import {
  createFakeDiagnosticsClock,
  createFakeDiagnosticsIds,
  createFakeDiagnosticsStore
} from "./testing/fakes";

const recorderInput = (store?: DiagnosticsStore) => ({
  store: store ?? createFakeDiagnosticsStore(),
  clock: createFakeDiagnosticsClock(),
  ids: createFakeDiagnosticsIds(),
  environment: { appBuild: "test", userAgent: "agent" },
  context: { themeMode: "dark" }
});

describe("diagnostics recorder", () => {
  it("stamps events with the injected clock and writes the session record", async () => {
    const store = createFakeDiagnosticsStore();
    const recorder = createDiagnosticsRecorder(recorderInput(store));

    recorder.record({ kind: "app.visibility", state: "visible" });
    recorder.recordAction("create-folder", { depth: 2 });
    recorder.recordActionResult("create-folder", "success", 42);
    await recorder.end("disabled");

    const record = store.records.get(recorder.sessionId);
    expect(record?.version).toBe(2);
    expect(record?.meta.id).toBe(recorder.sessionId);
    expect(record?.meta.endReason).toBe("disabled");
    expect(record?.environment?.appBuild).toBe("test");
    expect(record?.events.map((event) => event.kind)).toEqual([
      "app.visibility",
      "action.invoked",
      "action.result",
      "session.ended"
    ]);
    expect(record?.events.every((event) => typeof event.at === "string")).toBe(true);
  });

  it("requests a scheduled flush when the buffer crosses the threshold", () => {
    const store = createFakeDiagnosticsStore();
    const requestFlush = vi.fn();
    const recorder = createDiagnosticsRecorder({ ...recorderInput(store), requestFlush });

    for (let index = 0; index < DIAGNOSTICS_BUFFER_FLUSH_EVENT_COUNT - 1; index += 1) {
      recorder.record({ kind: "app.visibility", state: "visible" });
    }
    expect(requestFlush).not.toHaveBeenCalled();

    recorder.record({ kind: "app.visibility", state: "hidden" });
    expect(requestFlush).toHaveBeenCalledTimes(1);
  });

  it("drops events at the per-session cap and reports the drop on end", async () => {
    const store = createFakeDiagnosticsStore();
    const recorder = createDiagnosticsRecorder(recorderInput(store));

    for (let index = 0; index < DIAGNOSTICS_MAX_EVENTS_PER_SESSION + 5; index += 1) {
      recorder.record({ kind: "app.visibility", state: "visible" });
    }
    expect(recorder.bufferedEventCount()).toBe(DIAGNOSTICS_MAX_EVENTS_PER_SESSION);

    await recorder.end("disabled");
    const record = store.records.get(recorder.sessionId);
    const dropMarker = record?.events.find((event) =>
      event.kind === "perf.marker" && event.name === "diagnostics.dropped-events");
    expect(dropMarker?.kind === "perf.marker" && dropMarker.detail).toContain("5 event(s) dropped");
  });

  it("drops events at the per-session byte cap", async () => {
    const store = createFakeDiagnosticsStore();
    const recorder = createDiagnosticsRecorder(recorderInput(store));
    const bigDetail = { blob: "x".repeat(1024) };

    while (recorder.bufferedEventCount() < DIAGNOSTICS_MAX_EVENTS_PER_SESSION) {
      const before = recorder.bufferedEventCount();
      recorder.record({ kind: "action.invoked", action: "upload", detail: bigDetail });
      if (recorder.bufferedEventCount() === before) {
        break;
      }
    }
    await recorder.end("disabled");

    const record = store.records.get(recorder.sessionId);
    const size = JSON.stringify(record).length;
    // Loose bound: serialized record stays in the ballpark of the cap.
    expect(size).toBeLessThan(DIAGNOSTICS_MAX_SESSION_BYTES + 64 * 1024);
    const dropMarker = record?.events.find((event) =>
      event.kind === "perf.marker" && event.name === "diagnostics.dropped-events");
    expect(dropMarker).toBeDefined();
  });

  it("degrades instead of throwing when the store fails", async () => {
    const failingStore: DiagnosticsStore = {
      writeSession: async (): Promise<DiagnosticsStoreResult<void>> => ({ ok: false, message: "quota" }),
      readSession: async () => ({ ok: false, message: "quota" }),
      listSessions: async () => ({ ok: false, message: "quota" }),
      prune: async () => ({ ok: false, message: "quota" }),
      clear: async () => ({ ok: false, message: "quota" })
    };
    const recorder = createDiagnosticsRecorder(recorderInput(failingStore));

    recorder.record({ kind: "app.visibility", state: "visible" });
    await recorder.flush();
    expect(recorder.degraded()).toBe(true);
    await expect(recorder.end("disabled")).resolves.toBeUndefined();
  });

  it("becomes a no-op after end", async () => {
    const store = createFakeDiagnosticsStore();
    const recorder = createDiagnosticsRecorder(recorderInput(store));

    await recorder.end("disabled");
    expect(recorder.isActive()).toBe(false);
    recorder.record({ kind: "app.visibility", state: "visible" });
    recorder.recordAction("upload");
    expect(recorder.bufferedEventCount()).toBe(1); // only session.ended
  });

  it("coalesces concurrent flushes into a single write", async () => {
    const store = createFakeDiagnosticsStore();
    const writeSpy = vi.spyOn(store, "writeSession");
    const recorder = createDiagnosticsRecorder(recorderInput(store));
    recorder.record({ kind: "app.visibility", state: "visible" });

    await Promise.all([recorder.flush(), recorder.flush(), recorder.flush()]);
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });
});
