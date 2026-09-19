import { describe, expect, it } from "vitest";

import { hasFileDrag, isInternalDragLeave } from "./dropInteraction";

describe("upload drop interaction policy", () => {
  it("accepts only file drags and tolerates synthetic file drops without types", () => {
    expect(hasFileDrag({ types: ["Files"], files: [] })).toBe(true);
    expect(hasFileDrag({ types: ["text/plain"], files: [] })).toBe(false);
    expect(hasFileDrag({ types: [], files: [new File(["x"], "x.txt")] })).toBe(true);
    expect(hasFileDrag(undefined)).toBe(false);
  });

  it("keeps a drag active while moving between descendants", () => {
    const parent = document.createElement("section");
    const child = document.createElement("span");
    parent.appendChild(child);

    expect(isInternalDragLeave(parent, child)).toBe(true);
    expect(isInternalDragLeave(parent, document.createElement("span"))).toBe(false);
    expect(isInternalDragLeave(parent, null)).toBe(false);
  });
});
