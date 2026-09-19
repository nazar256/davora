import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const cssPath = resolve(sourceRoot, "features/accounts/accountSurfaces.css");
const entryPath = resolve(sourceRoot, "css-system.css");

describe("account surface CSS ownership", () => {
  it("keeps account and unlock selectors in the account feature owner", () => {
    const css = readFileSync(cssPath, "utf8");
    for (const selector of [".bootstrap-panel", ".zero-state-panel", ".account-form", ".account-form-grid", ".unlock-copy", ".unlock-form", ".account-form input"]) {
      expect(css).toContain(selector);
    }
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (max-width: 900px)");
  });

  it("loads through the centralized feature layer", () => {
    const entry = readFileSync(entryPath, "utf8");
    expect(entry).toMatch(/@import\s+["']\.\/features\/accounts\/accountSurfaces\.css["']\s+layer\(features\)/);
    expect(entry).not.toContain("accountSurfaces.css\";");
  });
});
