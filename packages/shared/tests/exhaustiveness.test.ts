import { describe, expect, it } from "vitest";

import { assertNever } from "../src/exhaustiveness";

describe("assertNever", () => {
  it("throws with boundary context and the unexpected value", () => {
    expect(() => assertNever("unexpected" as never, "session transition"))
      .toThrow('Unexpected value in session transition: "unexpected"');
  });
});
