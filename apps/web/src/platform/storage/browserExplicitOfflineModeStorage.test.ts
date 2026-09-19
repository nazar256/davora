import { describe, expect, it } from "vitest";

import { createBrowserStringStorage } from "./browserStringStorage";
import {
  EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY,
  createBrowserExplicitOfflineModeStorage
} from "./browserExplicitOfflineModeStorage";

function storage(values = new Map<string, string>()) {
  return createBrowserStringStorage(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }
  }));
}

describe("browser explicit offline mode storage", () => {
  it("stores independent account choices in sorted canonical form", () => {
    const values = new Map<string, string>();
    const mode = createBrowserExplicitOfflineModeStorage(storage(values));

    expect(mode.commit("beta", true)).toEqual({ kind: "committed" });
    expect(mode.commit("alpha", true)).toEqual({ kind: "committed" });
    expect(values.get(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe('["alpha","beta"]');
    expect(mode.read("alpha")).toMatchObject({ kind: "ready", enabled: true });
    expect(mode.commit("alpha", false)).toEqual({ kind: "committed" });
    expect(mode.read("alpha")).toMatchObject({ kind: "ready", enabled: false });
    expect(mode.read("beta")).toMatchObject({ kind: "ready", enabled: true });
  });

  it("fails closed on malformed persisted values without mutating during read", () => {
    const values = new Map([[EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, "not-json"]]);
    const mode = createBrowserExplicitOfflineModeStorage(storage(values));

    expect(mode.read("alpha")).toMatchObject({ kind: "failed" });
    expect(values.get(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe("not-json");
    expect(mode.reset()).toEqual({ kind: "committed" });
    expect(values.has(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe(false);
  });

  it("defers valid noncanonical repair until committed layout work", () => {
    const values = new Map([[EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, '["beta","beta"]']]);
    const mode = createBrowserExplicitOfflineModeStorage(storage(values));

    const snapshot = mode.read("beta");
    expect(snapshot).toMatchObject({ kind: "ready", enabled: true, repair: { kind: "write", value: '["beta"]' } });
    expect(values.get(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe('["beta","beta"]');
    expect(mode.repair(snapshot.kind === "ready" ? snapshot.repair! : { kind: "delete" })).toEqual({ kind: "repaired" });
    expect(values.get(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe('["beta"]');
  });

  it("fails a read without mutating, then preserves other accounts on a later successful commit", () => {
    const values = new Map([[EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, '["alpha","beta"]']]);
    let failRead = true;
    const rawStorage = createBrowserStringStorage(() => ({
      getItem: (key) => {
        if (failRead) {
          throw new Error("temporarily unavailable");
        }
        return values.get(key) ?? null;
      },
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); }
    }));
    const mode = createBrowserExplicitOfflineModeStorage(rawStorage);

    expect(mode.commit("alpha", false)).toMatchObject({ kind: "failed" });
    expect(values.get(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe('["alpha","beta"]');
    failRead = false;
    expect(mode.commit("beta", false)).toEqual({ kind: "committed" });
    expect(values.get(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe('["alpha"]');
  });

  it("reports write and delete failures without claiming a commit", () => {
    const values = new Map([[EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY, '["alpha"]']]);
    let failWrites = true;
    const mode = createBrowserExplicitOfflineModeStorage(createBrowserStringStorage(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: () => { if (failWrites) throw new Error("quota"); },
      removeItem: () => { if (failWrites) throw new Error("blocked"); values.delete(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY); }
    })));

    expect(mode.commit("beta", true)).toMatchObject({ kind: "failed" });
    expect(values.get(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe('["alpha"]');
    expect(mode.commit("alpha", false)).toMatchObject({ kind: "failed" });
    expect(values.get(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe('["alpha"]');
  });
});
