import { describe, expect, it } from "vitest";

import { applyBrowserDirectoryUploadAttributes } from "./browserDirectoryInput";

describe("browser directory upload input", () => {
  it("applies directory and multi-file attributes", () => {
    const input = document.createElement("input");
    applyBrowserDirectoryUploadAttributes(input);
    expect(input.multiple).toBe(true);
    expect(input.getAttribute("multiple")).toBe("");
    expect(input.getAttribute("webkitdirectory")).toBe("");
    expect(input.getAttribute("directory")).toBe("");
    expect((input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory).toBe(true);
    expect((input as HTMLInputElement & { directory?: boolean }).directory).toBe(true);
  });

  it("leaves a missing input untouched", () => {
    expect(() => applyBrowserDirectoryUploadAttributes(null)).not.toThrow();
  });
});
