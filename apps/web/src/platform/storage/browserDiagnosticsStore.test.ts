import { beforeEach, describe, expect, it } from "vitest";

import { createBrowserDiagnosticsStore } from "./browserDiagnosticsStore";

const record = (id: string, startedAt: string, eventBytes = 16) => ({
  meta: { id, startedAt },
  events: [{ kind: "x".repeat(eventBytes) }]
});

const listIds = async (store: ReturnType<typeof createBrowserDiagnosticsStore>) => {
  const result = await store.listSessions();
  return result.ok ? result.value.map((summary) => summary.id) : [];
};

describe("browserDiagnosticsStore", () => {
  beforeEach(async () => {
    await createBrowserDiagnosticsStore().clear();
  });

  it("writes, lists newest-first, and reads sessions back", async () => {
    const store = createBrowserDiagnosticsStore();
    await store.writeSession(record("s1", "2026-01-01T00:00:00.000Z"));
    await store.writeSession(record("s2", "2026-01-02T00:00:00.000Z"));

    expect(await listIds(store)).toEqual(["s2", "s1"]);

    const read = await store.readSession("s1");
    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toMatchObject({ meta: { id: "s1" } });
  });

  it("prunes to the kept-session cap, dropping the oldest first", async () => {
    const store = createBrowserDiagnosticsStore();
    for (let index = 0; index < 6; index += 1) {
      await store.writeSession(record(`s${index}`, `2026-01-0${index + 1}T00:00:00.000Z`));
    }
    const prune = await store.prune();
    expect(prune.ok).toBe(true);
    expect(await listIds(store)).toEqual(["s5", "s4", "s3", "s2"]);
    const dropped = await store.readSession("s0");
    expect(dropped.ok && dropped.value).toBeUndefined();
  });

  it("drops sessions exceeding the total byte cap", async () => {
    const store = createBrowserDiagnosticsStore();
    // Each record is ~1.2MB serialized; two exceed the 2MB total budget.
    const big = { kind: "x".repeat(1_200_000) };
    const bigRecord = (id: string, startedAt: string) => ({ meta: { id, startedAt }, events: [big] });
    await store.writeSession(bigRecord("old", "2026-01-01T00:00:00.000Z"));
    await store.writeSession(bigRecord("new", "2026-01-02T00:00:00.000Z"));
    await store.prune();

    expect(await listIds(store)).toEqual(["new"]);
  });

  it("clear removes index and session records", async () => {
    const store = createBrowserDiagnosticsStore();
    await store.writeSession(record("s1", "2026-01-01T00:00:00.000Z"));
    await store.clear();

    expect(await listIds(store)).toEqual([]);
    const read = await store.readSession("s1");
    expect(read.ok && read.value).toBeUndefined();
  });

  it("recovers from a corrupt index instead of throwing", async () => {
    const store = createBrowserDiagnosticsStore();
    // Poison the index with an invalid shape, then verify reads degrade gracefully.
    const { set } = await import("idb-keyval");
    await set("davora-diagnostics:index", "not-an-index");

    const list = await store.listSessions();
    expect(list).toEqual({ ok: true, value: [] });
  });
});
