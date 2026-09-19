import { describe, expect, it, vi } from "vitest";

import { createBrowserClipboardPort } from "./browserClipboardPort";

describe("createBrowserClipboardPort", () => {
  it("writes text through navigator.clipboard and reports success", async () => {
    const writeText = vi.fn(async () => undefined);
    const port = createBrowserClipboardPort(() => ({ clipboard: { writeText } }));

    await expect(port.writeText("https://davora.test/?path=Plans&account=a1")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://davora.test/?path=Plans&account=a1");
  });

  it("reports failure when the clipboard API is missing", async () => {
    const port = createBrowserClipboardPort(() => ({}));

    await expect(port.writeText("anything")).resolves.toBe(false);
  });

  it("reports failure instead of throwing when clipboard.writeText rejects", async () => {
    const writeText = vi.fn(async () => Promise.reject(new Error("denied")));
    const port = createBrowserClipboardPort(() => ({ clipboard: { writeText } }));

    await expect(port.writeText("anything")).resolves.toBe(false);
  });
});
