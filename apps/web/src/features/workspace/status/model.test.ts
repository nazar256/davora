import { describe, expect, it } from "vitest";

import { announceWorkspaceStatus, createWorkspaceStatusSnapshot } from "./model";

describe("workspace status model", () => {
  it("replaces only the informational message", () => {
    const previous = createWorkspaceStatusSnapshot("initial");
    const next = announceWorkspaceStatus(previous, "latest");

    expect(next).toEqual({ message: "latest" });
    expect(previous).toEqual({ message: "initial" });
    expect(Object.isFrozen(next)).toBe(true);
  });
});
