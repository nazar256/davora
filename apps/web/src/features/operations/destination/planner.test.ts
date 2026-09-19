import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { FileEntry } from "@davora/shared";

import {
  addConflictSuffix,
  planDestination,
  resolveDestinationListingPath,
  suggestDestinationName
} from "./planner";

function entry(name: string, path = name, isFolder = false): FileEntry {
  return { name, path, isFolder };
}

const source = entry("report.txt", "Projects/report.txt");

describe("destination planning", () => {
  it("plans one canonical picker target without mutating its inputs", () => {
    const destinationEntries = Object.freeze([entry("existing.txt", "Archive/existing.txt")]);
    const frozenSource = Object.freeze({ ...source });

    const plan = planDestination({
      kind: "single",
      operation: "copy",
      source: frozenSource,
      destinationEntries,
      manualMode: false,
      folderPath: "Archive",
      name: " report final.txt ",
      manualPath: "ignored"
    });

    expect(plan).toEqual({
      kind: "valid",
      destinationPath: "Archive/report final.txt",
      targets: [{ source: frozenSource, destinationPath: "Archive/report final.txt" }]
    });
    expect(destinationEntries).toEqual([entry("existing.txt", "Archive/existing.txt")]);
  });

  it("rejects an empty picker name instead of resolving it as its parent folder", () => {
    expect(planDestination({
      kind: "single",
      operation: "move",
      source,
      destinationEntries: [],
      manualMode: false,
      folderPath: "Archive",
      name: "   ",
      manualPath: "ignored"
    })).toEqual({
      kind: "invalid",
      destinationPath: "Archive",
      message: "Choose a destination name before continuing."
    });
  });

  it("canonicalizes manual paths before same-path and conflict checks", () => {
    const destinationEntries = [source];
    const base = {
      kind: "single" as const,
      source,
      destinationEntries,
      manualMode: true,
      folderPath: "Projects",
      name: source.name,
      manualPath: " /Projects//report.txt/ "
    };

    expect(planDestination({ ...base, operation: "move" })).toEqual({
      kind: "invalid",
      destinationPath: "Projects/report.txt",
      message: "Choose a different destination folder or name."
    });
    expect(planDestination({ ...base, operation: "copy" })).toEqual({
      kind: "invalid",
      destinationPath: "Projects/report.txt",
      message: "Destination already contains report.txt. Use report (1).txt or choose a different folder."
    });
  });

  it("checks conflicts for canonical manual paths", () => {
    const existing = entry("report.txt", "Archive/report.txt");
    const plan = planDestination({
      kind: "single",
      operation: "move",
      source,
      destinationEntries: [existing],
      manualMode: true,
      folderPath: "Projects",
      name: source.name,
      manualPath: "/Archive//report.txt"
    });

    expect(plan).toEqual({
      kind: "invalid",
      destinationPath: "Archive/report.txt",
      message: "Destination already contains report.txt. Choose a different name or folder."
    });
  });

  it.each([
    ["bad/name.txt", "Destination name cannot contain slashes. Use Manual path for a full destination path."],
    ["bad\\name.txt", "Enter a valid destination name."],
    ["bad%2Fname.txt", "Enter a valid destination name."],
    ["..", "Enter a valid destination name."]
  ])("rejects invalid picker name %s with the established message", (name, message) => {
    const plan = planDestination({
      kind: "single",
      operation: "copy",
      source,
      destinationEntries: [],
      manualMode: false,
      folderPath: "Archive",
      name,
      manualPath: "ignored"
    });

    expect(plan).toMatchObject({ kind: "invalid", message });
    expect(plan).not.toHaveProperty("targets");
  });

  it.each(["Archive/../report.txt", "Archive/bad\\name.txt", "Archive/bad%2fname.txt"])(
    "rejects invalid manual path %s without throwing",
    (manualPath) => {
      expect(planDestination({
        kind: "single",
        operation: "copy",
        source,
        destinationEntries: [],
        manualMode: true,
        folderPath: "Projects",
        name: source.name,
        manualPath
      })).toMatchObject({ kind: "invalid", message: "Enter a valid destination path." });
    }
  );

  it("rejects true folder descendants but permits prefix siblings", () => {
    const folder = entry("Project", "Project", true);
    const descendant = planDestination({
      kind: "single",
      operation: "copy",
      source: folder,
      destinationEntries: [],
      manualMode: true,
      folderPath: "",
      name: folder.name,
      manualPath: "Project/Sub/Project"
    });
    const sibling = planDestination({
      kind: "single",
      operation: "copy",
      source: folder,
      destinationEntries: [],
      manualMode: true,
      folderPath: "",
      name: folder.name,
      manualPath: "Project-archive/Project"
    });

    expect(descendant).toMatchObject({
      kind: "invalid",
      message: "Folders cannot be moved or copied into themselves or their descendants."
    });
    expect(sibling).toMatchObject({ kind: "valid", destinationPath: "Project-archive/Project" });
  });

  it("plans batch copies in source order and accounts for earlier planned conflicts", () => {
    const sources = [
      entry("notes.txt", "One/notes.txt"),
      entry("notes.txt", "Two/notes.txt"),
      entry("photo.png", "photo.png")
    ];
    const plan = planDestination({
      kind: "batch",
      operation: "copy",
      sources,
      destinationEntries: [entry("notes.txt", "Archive/notes.txt")],
      manualMode: true,
      folderPath: "",
      manualPath: " /Archive// "
    });

    expect(plan).toEqual({
      kind: "valid",
      destinationPath: "Archive",
      targets: [
        { source: sources[0], destinationPath: "Archive/notes (1).txt" },
        { source: sources[1], destinationPath: "Archive/notes (2).txt" },
        { source: sources[2], destinationPath: "Archive/photo.png" }
      ]
    });
  });

  it("invalidates an entire batch move on its first conflict", () => {
    const plan = planDestination({
      kind: "batch",
      operation: "move",
      sources: [entry("first.txt", "One/first.txt"), entry("second.txt", "Two/second.txt")],
      destinationEntries: [entry("second.txt", "Archive/second.txt")],
      manualMode: false,
      folderPath: "Archive",
      manualPath: "ignored"
    });

    expect(plan).toEqual({
      kind: "invalid",
      destinationPath: "Archive/second.txt",
      message: "Destination already contains second.txt. Choose a different folder."
    });
    expect(plan).not.toHaveProperty("targets");
  });

  it("resolves the folder whose entries must back the plan", () => {
    expect(resolveDestinationListingPath({ batch: false, manualMode: true, folderPath: "Projects", manualPath: "/Archive//report.txt" }))
      .toEqual({ kind: "valid", path: "Archive" });
    expect(resolveDestinationListingPath({ batch: true, manualMode: true, folderPath: "Projects", manualPath: "/Archive//" }))
      .toEqual({ kind: "valid", path: "Archive" });
    expect(resolveDestinationListingPath({ batch: false, manualMode: false, folderPath: "/Projects//", manualPath: "ignored" }))
      .toEqual({ kind: "valid", path: "Projects" });
  });

  it("always emits canonical and unique batch destinations", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 25 }), fc.integer({ min: 0, max: 1000 }), (count, segment) => {
      const sources = Array.from({ length: count }, (_, index) => entry("same.txt", `Source-${index}/same.txt`));
      const plan = planDestination({
        kind: "batch",
        operation: "copy",
        sources,
        destinationEntries: [],
        manualMode: true,
        folderPath: "",
        manualPath: ` /Archive//Part-${segment}/ `
      });

      expect(plan.kind).toBe("valid");
      if (plan.kind === "valid") {
        const destinations = plan.targets.map((target) => target.destinationPath);
        expect(new Set(destinations).size).toBe(destinations.length);
        expect(destinations.every((path) => path.startsWith(`Archive/Part-${segment}/`) && !path.includes("//"))).toBe(true);
      }
    }), { numRuns: 100, seed: 424246 });
  });
});

describe("destination conflict naming", () => {
  it.each([
    ["report.txt", 1, "report (1).txt"],
    ["archive.tar.gz", 2, "archive.tar (2).gz"],
    [".env", 1, ".env (1)"],
    ["report.", 1, "report. (1)"],
    ["資料 100%.txt", 3, "資料 100% (3).txt"]
  ])("adds a suffix without changing extension behavior for %s", (name, suffix, expected) => {
    expect(addConflictSuffix(name, suffix)).toBe(expected);
  });

  it("uses exact case-sensitive conflicts and move-versus-copy semantics", () => {
    expect(suggestDestinationName([source], " report.txt ", source, "move")).toBe("report.txt");
    expect(suggestDestinationName([source], " report.txt ", source, "copy")).toBe("report (1).txt");
    expect(suggestDestinationName([entry("Report.txt")], "report.txt", source, "copy")).toBe("report.txt");
  });

  it("finds the deterministic smallest available suffix beyond 999", () => {
    const entries = [entry("report.txt")];
    for (let suffix = 1; suffix <= 1_005; suffix += 1) {
      if (suffix !== 1_002) {
        entries.push(entry(addConflictSuffix("report.txt", suffix)));
      }
    }

    expect(suggestDestinationName(entries, "report.txt", source, "copy")).toBe("report (1002).txt");
  });
});
