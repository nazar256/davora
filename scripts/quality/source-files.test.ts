import { describe, expect, it } from "vitest";

import { isProductionSourcePath } from "./source-files";

describe("production source selection", () => {
  it("includes runtime modules and excludes tests, declarations, and test helpers", () => {
    expect(isProductionSourcePath("apps/web/src/features/browsing/model.ts")).toBe(true);
    expect(isProductionSourcePath("apps/web/src/App.test.tsx")).toBe(false);
    expect(isProductionSourcePath("apps/web/src/test/builders.ts")).toBe(false);
    expect(isProductionSourcePath("apps/web/src/vite-env.d.ts")).toBe(false);
  });
});
