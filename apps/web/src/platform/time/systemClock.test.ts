import { describe, expect, it } from "vitest";

import { createSystemClock } from "./systemClock";

describe("system clock", () => {
  it("exposes ISO time without domain knowledge", () => {
    const clock = createSystemClock(() => new Date("2026-07-16T20:00:00.000Z"));

    expect(clock.nowIso()).toBe("2026-07-16T20:00:00.000Z");
  });
});
