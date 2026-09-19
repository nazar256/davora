import { describe, expect, it, vi } from "vitest";

import { createBrowserStringStorage } from "./browserStringStorage";

describe("browser string storage", () => {
  it("delegates raw string operations without feature knowledge", () => {
    const values = new Map<string, string>();
    const rawStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key))
    };
    const storage = createBrowserStringStorage(() => rawStorage);

    storage.setItem("key", "value");
    expect(storage.getItem("key")).toBe("value");
    storage.removeItem("key");
    expect(storage.getItem("key")).toBeNull();
  });

  it("becomes a no-op when browser storage is unavailable", () => {
    const unavailable = createBrowserStringStorage(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(unavailable.getItem("key")).toBeNull();
    expect(() => unavailable.setItem("key", "value")).not.toThrow();
    expect(() => unavailable.removeItem("key")).not.toThrow();
    expect(unavailable.readItem("key").ok).toBe(false);
    expect(unavailable.writeItem("key", "value").ok).toBe(false);
    expect(unavailable.deleteItem("key").ok).toBe(false);
  });

  it("contains operation-time storage failures", () => {
    const failing = createBrowserStringStorage(() => ({
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
      removeItem: () => { throw new DOMException("blocked", "SecurityError"); }
    }));

    expect(failing.getItem("key")).toBeNull();
    expect(() => failing.setItem("key", "value")).not.toThrow();
    expect(() => failing.removeItem("key")).not.toThrow();
    expect(failing.readItem("key").ok).toBe(false);
    expect(failing.writeItem("key", "value").ok).toBe(false);
    expect(failing.deleteItem("key").ok).toBe(false);
  });

  it("enumerates storage keys without exposing feature policy", () => {
    const values = new Map([["alpha", "one"], ["beta", "two"]]);
    const rawStorage = {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    };
    const storage = createBrowserStringStorage(() => rawStorage);
    expect(storage.keys()).toEqual(["alpha", "beta"]);
    expect(storage.listKeys()).toEqual({ ok: true, value: ["alpha", "beta"] });
  });

  it("contains enumeration failures", () => {
    const storage = createBrowserStringStorage(() => ({
      get length(): number { throw new DOMException("blocked", "SecurityError"); },
      key: () => null,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    }));
    expect(storage.keys()).toEqual([]);
    expect(storage.listKeys().ok).toBe(false);
  });
});
