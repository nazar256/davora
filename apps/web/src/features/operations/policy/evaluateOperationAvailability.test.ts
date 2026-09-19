import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { CapabilitySet } from "@davora/shared";

import {
  createOperationContextToken,
  evaluateOperationAvailability,
  isCurrentOperationContext,
  type OperationEnvironment,
  type OperationIntent,
  type OperationMode
} from "./index";

const capabilities: CapabilitySet = {
  backend: "nextcloud",
  readOnly: false,
  search: true,
  preview: true,
  download: true,
  offlineCache: false,
  createFolder: true,
  upload: true,
  move: true,
  copy: true,
  delete: true,
  mediaPreview: true,
  markdownPreview: true,
  openedFileCache: true
};

const online: OperationEnvironment = {
  mode: "online",
  hasSession: true,
  capabilities
};

const intents: readonly OperationIntent[] = [
  { kind: "createFolder" },
  { kind: "upload", requiresFolderCreation: false },
  { kind: "move", count: 1 },
  { kind: "copy", count: 1 },
  { kind: "copyOrMove", count: 1 },
  { kind: "delete", count: 1 },
  { kind: "downloadFocused", present: true, isFolder: false },
  { kind: "downloadBatch", count: 1 },
  { kind: "keepOffline", count: 1 },
  { kind: "markBatch" }
];

describe("operation availability", () => {
  it("allows the complete online-session capability baseline", () => {
    for (const intent of intents) {
      expect(evaluateOperationAvailability(online, intent)).toEqual({ kind: "allowed" });
    }
  });

  it.each([
    "browser-offline",
    "server-unavailable",
    "explicit-offline"
  ] satisfies OperationMode[])("denies every server-backed intent in %s mode", (mode) => {
    for (const intent of intents) {
      expect(evaluateOperationAvailability({ ...online, mode }, intent)).toEqual({
        kind: "denied",
        reason: "mode-unavailable"
      });
    }
  });

  it("denies every intent without a session or capabilities", () => {
    for (const intent of intents) {
      expect(evaluateOperationAvailability({ ...online, hasSession: false }, intent)).toEqual({
        kind: "denied",
        reason: "session-unavailable"
      });
      expect(evaluateOperationAvailability({ mode: "online", hasSession: true }, intent)).toEqual({
        kind: "denied",
        reason: "capability-unavailable"
      });
    }
  });

  it.each([
    ["createFolder", { kind: "createFolder" }],
    ["upload", { kind: "upload", requiresFolderCreation: false }],
    ["move", { kind: "move", count: 1 }],
    ["copy", { kind: "copy", count: 1 }],
    ["delete", { kind: "delete", count: 1 }],
    ["download", { kind: "downloadFocused", present: true, isFolder: false }]
  ] satisfies Array<[keyof CapabilitySet, OperationIntent]>)("denies %s independently when its exact capability is absent", (capability, intent) => {
    expect(evaluateOperationAvailability({
      ...online,
      capabilities: { ...capabilities, [capability]: false }
    }, intent)).toEqual({ kind: "denied", reason: "capability-unavailable" });
  });

  it("requires both capabilities for the combined copy-or-move surface", () => {
    for (const capability of ["copy", "move"] as const) {
      expect(evaluateOperationAvailability({
        ...online,
        capabilities: { ...capabilities, [capability]: false }
      }, { kind: "copyOrMove", count: 1 })).toEqual({
        kind: "denied",
        reason: "capability-unavailable"
      });
    }
  });

  it("requires create-folder capability only for directory uploads", () => {
    const withoutCreateFolder = {
      ...online,
      capabilities: { ...capabilities, createFolder: false }
    };
    expect(evaluateOperationAvailability(withoutCreateFolder, { kind: "upload", requiresFolderCreation: false }))
      .toEqual({ kind: "allowed" });
    expect(evaluateOperationAvailability(withoutCreateFolder, { kind: "upload", requiresFolderCreation: true }))
      .toEqual({ kind: "denied", reason: "capability-unavailable" });
  });

  it("preserves download-based keep-offline authorization instead of using offlineCache", () => {
    expect(evaluateOperationAvailability({
      ...online,
      capabilities: { ...capabilities, offlineCache: false }
    }, { kind: "keepOffline", count: 1 })).toEqual({ kind: "allowed" });
    expect(evaluateOperationAvailability({
      ...online,
      capabilities: { ...capabilities, download: false, offlineCache: true }
    }, { kind: "keepOffline", count: 1 })).toEqual({ kind: "denied", reason: "capability-unavailable" });
  });

  it("requires subjects and restricts direct download to a focused file", () => {
    expect(evaluateOperationAvailability(online, { kind: "move", count: 0 }))
      .toEqual({ kind: "denied", reason: "subject-required" });
    expect(evaluateOperationAvailability(online, { kind: "downloadFocused", present: false, isFolder: false }))
      .toEqual({ kind: "denied", reason: "subject-required" });
    expect(evaluateOperationAvailability(online, { kind: "downloadFocused", present: true, isFolder: true }))
      .toEqual({ kind: "denied", reason: "file-required" });
    expect(evaluateOperationAvailability(online, { kind: "downloadBatch", count: 0 }))
      .toEqual({ kind: "denied", reason: "subject-required" });
    expect(evaluateOperationAvailability(online, { kind: "downloadBatch", count: 1 }))
      .toEqual({ kind: "allowed" });
  });

  it("never admits a mutation outside online mode or without its required capability", () => {
    fc.assert(fc.property(
      fc.constantFrom<Exclude<OperationMode, "online">>("browser-offline", "server-unavailable", "explicit-offline"),
      fc.constantFrom<OperationIntent>(
        { kind: "createFolder" },
        { kind: "upload", requiresFolderCreation: false },
        { kind: "move", count: 1 },
        { kind: "copy", count: 1 },
        { kind: "delete", count: 1 }
      ),
      (mode, intent) => {
        expect(evaluateOperationAvailability({ ...online, mode }, intent).kind).toBe("denied");
      }
    ), { numRuns: 100, seed: 424247 });
  });
});

describe("operation context tokens", () => {
  it("uses opaque identity so replacement sessions and modes cannot reactivate stale dialogs", () => {
    const first = createOperationContextToken();
    const same = first;
    const replacement = createOperationContextToken();

    expect(isCurrentOperationContext(first, same)).toBe(true);
    expect(isCurrentOperationContext(first, replacement)).toBe(false);
  });
});
