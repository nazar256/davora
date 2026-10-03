import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateBrowserStorage } from "./browserStorageEstimate";

afterEach(() => vi.unstubAllGlobals());
describe("browser storage estimate", () => {
  it("omits unsupported environments", async () => {
    vi.stubGlobal("navigator", {});
    expect(await estimateBrowserStorage()).toBeUndefined();
  });
  it("uses only the read-only estimate capability and preserves zero usage", async () => {
    const persist = vi.fn();
    const storage = { estimate: vi.fn(async function (this: unknown) { expect(this).toBe(storage); return { usage: 0, quota: 32 }; }), persist };
    vi.stubGlobal("navigator", { storage });
    expect(await estimateBrowserStorage()).toEqual({ usage: 0, quota: 32 });
    expect(persist).not.toHaveBeenCalled();
  });
});
