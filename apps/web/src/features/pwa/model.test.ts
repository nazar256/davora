import { describe, expect, it } from "vitest";

import {
  isInstallAvailable,
  nextInstallStateAfterChoice,
  shouldClearNeedRefreshInDev,
  shouldShowUpdatePrompt
} from "./model";

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

describe("shouldClearNeedRefreshInDev", () => {
  it("clears hidden dev refresh state", () => {
    expect(shouldClearNeedRefreshInDev(true, "development")).toBe(true);
    expect(shouldClearNeedRefreshInDev(true, "production")).toBe(false);
  });
});

describe("isInstallAvailable", () => {
  it("requires a live prompt, no dismissal, and non-standalone mode", () => {
    expect(isInstallAvailable(true, false, false)).toBe(true);
    expect(isInstallAvailable(false, false, false)).toBe(false);
    expect(isInstallAvailable(true, true, false)).toBe(false);
    expect(isInstallAvailable(true, false, true)).toBe(false);
  });
});

describe("nextInstallStateAfterChoice", () => {
  it("clears the prompt on acceptance and hides it on dismissal", () => {
    expect(nextInstallStateAfterChoice("accepted")).toEqual({ clearPrompt: true, dismissed: false });
    expect(nextInstallStateAfterChoice("dismissed")).toEqual({ clearPrompt: false, dismissed: true });
  });
});
