import { describe, expect, it } from "vitest";

import { createBrowserAccountRegistryClock } from "./browserAccountRegistryClock";

describe("browser account registry clock", () => {
  it("classifies expiry through injected browser time primitives", () => {
    const parse = (value: string) => ({ expired: 10, future: 30 }[value] ?? Number.NaN);
    const clock = createBrowserAccountRegistryClock(() => 20, parse);

    expect(clock.isExpired("expired")).toBe(true);
    expect(clock.isExpired("future")).toBe(false);
  });
});
