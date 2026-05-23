import { describe, expect, it } from "vitest";

import { shouldShowUpdatePrompt } from "./ReloadPrompt";

describe("shouldShowUpdatePrompt", () => {
  it("suppresses dev-server update prompts", () => {
    expect(shouldShowUpdatePrompt(true, "development")).toBe(false);
  });

  it("preserves preview and production update prompts", () => {
    expect(shouldShowUpdatePrompt(true, "production")).toBe(true);
    expect(shouldShowUpdatePrompt(true, "test")).toBe(true);
    expect(shouldShowUpdatePrompt(false, "production")).toBe(false);
  });
});
