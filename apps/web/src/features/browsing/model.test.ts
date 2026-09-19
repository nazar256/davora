import { describe, expect, it } from "vitest";

import { isSortMode, SORT_MODES } from "./model";

describe("browsing sort model", () => {
  it("defines the persisted values and desktop/mobile labels in display order", () => {
    expect(SORT_MODES).toEqual([
      { value: "name-asc", label: "Name A-Z", compactLabel: "A-Z" },
      { value: "name-desc", label: "Name Z-A", compactLabel: "Z-A" },
      { value: "modified-desc", label: "Modified newest", compactLabel: "New" },
      { value: "modified-asc", label: "Modified oldest", compactLabel: "Old" },
      { value: "size-desc", label: "Size largest", compactLabel: "Big" },
      { value: "size-asc", label: "Size smallest", compactLabel: "Small" }
    ]);
  });

  it("recognizes only declared persisted sort values", () => {
    for (const mode of SORT_MODES) {
      expect(isSortMode(mode.value)).toBe(true);
    }
    expect(isSortMode("newest")).toBe(false);
    expect(isSortMode(null)).toBe(false);
  });
});
