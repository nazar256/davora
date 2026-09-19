import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  dirname,
  normalizeRootPath,
  type FileEntry
} from "@davora/shared";

import {
  addConflictSuffix,
  destinationNameExists,
  planDestination,
  resolveDestinationListingPath,
  suggestDestinationName
} from "./planner";
import type {
  BatchDestinationPlanInput,
  DestinationOperation,
  DestinationPlanInput,
  SingleDestinationPlanInput
} from "./model";

const PROPERTY_OPTIONS = { numRuns: 250, seed: 20260831 } as const;

const SPECIAL_NAMES = [
  "report.txt",
  "archive.tar.gz",
  ".env",
  "report.",
  "資料 100%.txt",
  "README",
  "photo 2.png",
  "draft%20.txt"
] as const;
const SUFFIX_CASES = [
  { original: "report.txt", stem: "report", extension: ".txt" },
  { original: "archive.tar.gz", stem: "archive.tar", extension: ".gz" },
  { original: ".env", stem: ".env", extension: "" },
  { original: "report.", stem: "report.", extension: "" },
  { original: "資料 100%.txt", stem: "資料 100%", extension: ".txt" },
  { original: "README", stem: "README", extension: "" },
  { original: "photo 2.png", stem: "photo 2", extension: ".png" },
  { original: "draft%20.txt", stem: "draft%20", extension: ".txt" }
] as const;
const PATH_SEGMENTS = [
  "Archive",
  "Shared",
  "Projects",
  "Destination",
  "資料",
  "Part 2",
  "Percent%"
] as const;

const nameArb = fc.constantFrom(...SPECIAL_NAMES);
const suffixCaseArb = fc.constantFrom(...SUFFIX_CASES);
const pathSegmentArb = fc.constantFrom(...PATH_SEGMENTS);
const operationArb = fc.constantFrom<DestinationOperation>("copy", "move");
const paddedNameArb = fc.tuple(
  fc.constantFrom("", " ", "  "),
  nameArb,
  fc.constantFrom("", " ", "  ")
).map(([leading, name, trailing]) => `${leading}${name}${trailing}`);
const destinationFolderArb = fc.array(pathSegmentArb, { maxLength: 3 })
  .map((segments) => ["Destination", ...segments].join("/"));

function entry(name: string, path = name, isFolder = false): FileEntry {
  return { name, path, isFolder };
}

function decorateCanonicalPath(path: string): string {
  return path ? ` /${path.split("/").join("//")}/ ` : " / ";
}

function expectedSuffixName(name: string, suffix: number): string {
  const parts = SUFFIX_CASES.find((candidate) => candidate.original === name);
  if (!parts) {
    throw new Error(`Missing independent suffix partition for ${name}`);
  }
  return `${parts.stem} (${suffix})${parts.extension}`;
}

function sourceEntry(index: number, name: string, isFolder = false): FileEntry {
  return entry(name, `Input/${index}/${name}`, isFolder);
}

function expectedAvailableSuffix(name: string, occupied: ReadonlySet<string>): string {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = expectedSuffixName(name, suffix);
    if (!occupied.has(candidate)) {
      return candidate;
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function expectInvalidPlan(input: DestinationPlanInput): void {
  const plan = planDestination(input);
  expect(plan.kind).toBe("invalid");
  expect(plan).not.toHaveProperty("targets");
}

function pathErrorFor(rawPath: string): string {
  if (rawPath.includes("\\")) {
    return "Path contains forbidden characters.";
  }
  if (rawPath.toLowerCase().includes("%2f")) {
    return "Encoded path separators are not allowed.";
  }
  return "Path traversal is not allowed.";
}

describe("destination planner property characterization", () => {
  if (process.env.DAVORA_DESTINATION_PLANNER_FAILING_FIRST === "1") {
    it("failing-first sentinel isolates suffix allocation", () => {
      expect(addConflictSuffix("report.txt", 1)).toBe("report (2).txt");
    });
  }

  it("preserves final-dot suffixing, names, and supplied positive suffixes", () => {
    fc.assert(fc.property(suffixCaseArb, fc.integer({ min: 1, max: 1_002 }), ({ original, stem, extension }, suffix) => {
      expect(addConflictSuffix(original, suffix)).toBe(`${stem} (${suffix})${extension}`);
    }), PROPERTY_OPTIONS);

    expect(addConflictSuffix("report.txt", 1)).toBe("report (1).txt");
    expect(addConflictSuffix("archive.tar.gz", 2)).toBe("archive.tar (2).gz");
    expect(addConflictSuffix(".env", 1)).toBe(".env (1)");
    expect(addConflictSuffix("report.", 1)).toBe("report. (1)");
    expect(addConflictSuffix("資料 100%.txt", 1_002)).toBe("資料 100% (1002).txt");
  });

  it("preserves exact conflicts and the selected-entry copy/move exception", () => {
    const entriesArb = fc.array(fc.record({ name: nameArb, index: fc.integer({ min: 0, max: 12 }) }), { maxLength: 8 })
      .map((rows) => rows.map(({ name, index }) => entry(name, `Listing/${index}/${name}`)));

    fc.assert(fc.property(nameArb, nameArb, entriesArb, operationArb, (selectedName, candidate, entries, operation) => {
      const selected = entry(selectedName, `Input/selected/${selectedName}`);
      const copyNames = new Set(entries.map(({ name }) => name));
      const moveNames = new Set(entries
        .filter(({ path }) => path !== selected.path)
        .map(({ name }) => name));
      const expected = (operation === "copy" ? copyNames : moveNames).has(candidate);
      expect(destinationNameExists(entries, candidate, selected, operation)).toBe(expected);
    }), PROPERTY_OPTIONS);

    const selected = entry("report.txt", "Projects/report.txt");
    expect(destinationNameExists([selected], "report.txt", selected, "move")).toBe(false);
    expect(destinationNameExists([selected], "report.txt", selected, "copy")).toBe(true);
    expect(destinationNameExists([entry("Report.txt")], "report.txt", selected, "copy")).toBe(false);
  });

  it("trims once and chooses the deterministic smallest available suffix", () => {
    const suggestionArb = fc.record({
      name: paddedNameArb,
      hasBaseConflict: fc.boolean(),
      occupiedSuffixes: fc.uniqueArray(fc.integer({ min: 1, max: 1_200 }), { maxLength: 24 }),
      operation: operationArb
    });

    fc.assert(fc.property(suggestionArb, ({ name, hasBaseConflict, occupiedSuffixes, operation }) => {
      const baseName = name.trim();
      const entries = [
        ...(hasBaseConflict ? [entry(baseName, `Destination/${baseName}`)] : []),
        ...occupiedSuffixes.map((suffix) => {
          const candidate = expectedSuffixName(baseName, suffix);
          return entry(candidate, `Destination/${candidate}`);
        })
      ];
      const usedNames = new Set(entries.map((listed) => listed.name));
      const expected = hasBaseConflict ? expectedAvailableSuffix(baseName, usedNames) : baseName;
      expect(suggestDestinationName(entries, name, entry(baseName, `Input/${baseName}`), operation)).toBe(expected);
    }), PROPERTY_OPTIONS);

    expect(suggestDestinationName([], " report.txt ", entry("report.txt", "Input/report.txt"), "copy"))
      .toBe("report.txt");
    expect(suggestDestinationName([entry("report.txt")], " report.txt ", entry("report.txt", "Input/report.txt"), "copy"))
      .toBe("report (1).txt");
    expect(suggestDestinationName(
      [entry("report.txt"), entry("report (1).txt")],
      "report.txt",
      entry("report.txt", "Input/report.txt"),
      "copy"
    )).toBe("report (2).txt");
    expect(suggestDestinationName(
      [entry("report.txt"), ...Array.from({ length: 998 }, (_, index) => {
        const suffix = index + 1;
        return entry(expectedSuffixName("report.txt", suffix));
      })],
      "report.txt",
      entry("report.txt", "Input/report.txt"),
      "copy"
    )).toBe("report (999).txt");
    expect(suggestDestinationName(
      [entry("report.txt"), ...Array.from({ length: 1_001 }, (_, index) => {
        const suffix = index + 1;
        return entry(expectedSuffixName("report.txt", suffix));
      })],
      "report.txt",
      entry("report.txt", "Input/report.txt"),
      "copy"
    )).toBe("report (1002).txt");
  });

  it("canonicalizes valid single targets, preserves source identity, and leaves inputs unchanged", () => {
    fc.assert(fc.property(
      operationArb,
      destinationFolderArb,
      nameArb,
      fc.boolean(),
      fc.boolean(),
      (operation, destinationFolder, targetName, manualMode, sourceIsFolder) => {
        const source = entry("source.txt", "Input/source.txt", sourceIsFolder);
        const destinationEntries: readonly FileEntry[] = [];
        const input: SingleDestinationPlanInput = {
          kind: "single",
          operation,
          source,
          destinationEntries,
          manualMode,
          folderPath: decorateCanonicalPath(destinationFolder),
          name: targetName,
          manualPath: decorateCanonicalPath(`${destinationFolder}/${targetName}`)
        };
        const before = cloneValue(input);
        const plan = planDestination(input);
        const canonicalFolder = normalizeRootPath(input.folderPath);
        const expectedDestinationPath = manualMode
          ? normalizeRootPath(input.manualPath)
          : canonicalFolder
            ? `${canonicalFolder}/${targetName}`
            : targetName;

        expect(plan).toEqual({
          kind: "valid",
          destinationPath: expectedDestinationPath,
          targets: [{ source, destinationPath: expectedDestinationPath }]
        });
        expect(input).toEqual(before);
        if (plan.kind === "valid") {
          expect(plan.targets[0]?.source).toBe(source);
        }
      }
    ), PROPERTY_OPTIONS);
  });

  it("distinguishes same-path copy/move outcomes and true descendants from prefix siblings", () => {
    fc.assert(fc.property(nameArb, (name) => {
      const source = entry(name, `Input/${name}`);
      const samePath = decorateCanonicalPath(source.path);
      const copyPlan = planDestination({
        kind: "single",
        operation: "copy",
        source,
        destinationEntries: [source],
        manualMode: true,
        folderPath: "ignored",
        name,
        manualPath: samePath
      });
      const movePlan = planDestination({
        kind: "single",
        operation: "move",
        source,
        destinationEntries: [source],
        manualMode: true,
        folderPath: "ignored",
        name,
        manualPath: samePath
      });
      expect(copyPlan).toEqual({
        kind: "invalid",
        destinationPath: source.path,
        message: `Destination already contains ${name}. Use ${expectedSuffixName(name, 1)} or choose a different folder.`
      });
      expect(movePlan).toEqual({
        kind: "invalid",
        destinationPath: source.path,
        message: "Choose a different destination folder or name."
      });

      const folder = entry(name, `Input/folder/${name}`, true);
      const descendantPath = `${folder.path}/child/${name}`;
      expect(planDestination({
        kind: "single",
        operation: "copy",
        source: folder,
        destinationEntries: [],
        manualMode: true,
        folderPath: "ignored",
        name,
        manualPath: decorateCanonicalPath(descendantPath)
      })).toEqual({
        kind: "invalid",
        destinationPath: normalizeRootPath(descendantPath),
        message: "Folders cannot be moved or copied into themselves or their descendants."
      });

      const siblingPath = `Input/folder/${name}-archive/${name}`;
      expect(planDestination({
        kind: "single",
        operation: "copy",
        source: folder,
        destinationEntries: [],
        manualMode: true,
        folderPath: "ignored",
        name,
        manualPath: decorateCanonicalPath(siblingPath)
      })).toMatchObject({ kind: "valid", destinationPath: normalizeRootPath(siblingPath) });
    }), PROPERTY_OPTIONS);

    const rootSource = entry("report.txt", "report.txt");
    expect(planDestination({
      kind: "single",
      operation: "move",
      source: rootSource,
      destinationEntries: [rootSource],
      manualMode: true,
      folderPath: "ignored",
      name: rootSource.name,
      manualPath: " /report.txt/ "
    })).toMatchObject({ kind: "invalid", message: "Choose a different destination folder or name." });
    const rootFolder = entry("Project", "Project", true);
    expect(planDestination({
      kind: "single",
      operation: "copy",
      source: rootFolder,
      destinationEntries: [],
      manualMode: true,
      folderPath: "ignored",
      name: rootFolder.name,
      manualPath: "Project/Sub/Project"
    })).toMatchObject({ kind: "invalid" });
    expect(planDestination({
      kind: "single",
      operation: "copy",
      source: rootFolder,
      destinationEntries: [],
      manualMode: true,
      folderPath: "ignored",
      name: rootFolder.name,
      manualPath: "Project-archive/Project"
    })).toMatchObject({ kind: "valid" });
  });

  it("preserves batch source order, cardinality, canonical paths, and uniqueness", () => {
    fc.assert(fc.property(fc.array(nameArb, { maxLength: 10 }), destinationFolderArb, fc.boolean(), (names, destinationFolder, manualMode) => {
      const sources = names.map((name, index) => sourceEntry(index, name, index % 3 === 0));
      const folderDraft = decorateCanonicalPath(destinationFolder);
      const plan = planDestination({
        kind: "batch",
        operation: "copy",
        sources,
        destinationEntries: [],
        manualMode,
        folderPath: folderDraft,
        manualPath: folderDraft
      });

      expect(plan.kind).toBe("valid");
      if (plan.kind === "valid") {
        const destinations = plan.targets.map((target) => target.destinationPath);
        expect(plan.destinationPath).toBe(normalizeRootPath(folderDraft));
        expect(plan.targets).toHaveLength(sources.length);
        expect(plan.targets.map((target) => target.source)).toEqual(sources);
        expect(new Set(destinations).size).toBe(destinations.length);
        expect(destinations.every((path) => normalizeRootPath(path) === path)).toBe(true);
        expect(destinations.every((path) => path.startsWith(plan.destinationPath ? `${plan.destinationPath}/` : ""))).toBe(true);
      }
    }), PROPERTY_OPTIONS);

    expect(planDestination({
      kind: "batch",
      operation: "copy",
      sources: [],
      destinationEntries: [],
      manualMode: true,
      folderPath: "ignored",
      manualPath: " / "
    })).toEqual({ kind: "valid", destinationPath: "", targets: [] });
  });

  it("accounts for pre-existing and earlier planned copy conflicts with the smallest gaps", () => {
    fc.assert(fc.property(
      fc.array(nameArb, { minLength: 1, maxLength: 8 }),
      fc.array(nameArb, { maxLength: 8 }),
      destinationFolderArb,
      (sourceNames, existingNames, destinationFolder) => {
        const sources = sourceNames.map((name, index) => sourceEntry(index, name));
        const destinationEntries = existingNames.map((name, index) => entry(name, `${destinationFolder}/${index}/${name}`));
        const usedNames: Set<string> = new Set(existingNames);
        const expectedNames: string[] = [];
        for (const name of sourceNames) {
          const candidate = usedNames.has(name) ? expectedAvailableSuffix(name, usedNames) : name;
          expectedNames.push(candidate);
          usedNames.add(candidate);
        }
        const plan = planDestination({
          kind: "batch",
          operation: "copy",
          sources,
          destinationEntries,
          manualMode: true,
          folderPath: "ignored",
          manualPath: decorateCanonicalPath(destinationFolder)
        });

        expect(plan).toEqual({
          kind: "valid",
          destinationPath: destinationFolder,
          targets: expectedNames.map((name, index) => ({
            source: sources[index],
            destinationPath: `${destinationFolder}/${name}`
          }))
        });
      }
    ), PROPERTY_OPTIONS);

    const sources = [sourceEntry(0, "report.txt"), sourceEntry(1, "report.txt")];
    expect(planDestination({
      kind: "batch",
      operation: "copy",
      sources,
      destinationEntries: [
        entry("report.txt", "Destination/report.txt"),
        entry("report (1).txt", "Destination/report (1).txt"),
        entry("report (3).txt", "Destination/report (3).txt")
      ],
      manualMode: true,
      folderPath: "ignored",
      manualPath: "Destination"
    })).toMatchObject({
      kind: "valid",
      targets: [
        { destinationPath: "Destination/report (2).txt" },
        { destinationPath: "Destination/report (4).txt" }
      ]
    });
  });

  it("rejects the first batch-move conflict atomically and returns typed invalid shapes", () => {
    const invalidKindArb = fc.constantFrom("empty-name", "bad-manual-path", "bad-source-path");
    fc.assert(fc.property(
      fc.uniqueArray(nameArb, { minLength: 1, maxLength: 6 }),
      fc.integer({ min: 0, max: 100 }),
      invalidKindArb,
      (sourceNames, conflictSelector, invalidKind) => {
        const sources = sourceNames.map((name, index) => sourceEntry(index, name));
        const conflictIndex = conflictSelector % sourceNames.length;
        const conflictName = sourceNames[conflictIndex];
        if (!conflictName) {
          throw new Error("The generated conflict source must exist.");
        }
        const plan = planDestination({
          kind: "batch",
          operation: "move",
          sources,
          destinationEntries: [entry(conflictName, `Destination/${conflictName}`)],
          manualMode: false,
          folderPath: " /Destination// ",
          manualPath: "ignored"
        });
        expect(plan).toEqual({
          kind: "invalid",
          destinationPath: `Destination/${conflictName}`,
          message: `Destination already contains ${conflictName}. Choose a different folder.`
        });
        expect(plan).not.toHaveProperty("targets");

        if (invalidKind === "empty-name") {
          expectInvalidPlan({
            kind: "single",
            operation: "copy",
            source: entry("source.txt", "Input/source.txt"),
            destinationEntries: [],
            manualMode: false,
            folderPath: "Destination",
            name: "   ",
            manualPath: "ignored"
          });
        } else if (invalidKind === "bad-manual-path") {
          expectInvalidPlan({
            kind: "single",
            operation: "copy",
            source: entry("source.txt", "Input/source.txt"),
            destinationEntries: [],
            manualMode: true,
            folderPath: "Destination",
            name: "source.txt",
            manualPath: "Destination/bad%2Fname.txt"
          });
        } else {
          expectInvalidPlan({
            kind: "batch",
            operation: "move",
            sources: [entry("bad", "Input/bad\\name")],
            destinationEntries: [],
            manualMode: false,
            folderPath: "Destination",
            manualPath: "ignored"
          });
        }
      }
    ), PROPERTY_OPTIONS);

    expectInvalidPlan({
      kind: "single",
      operation: "copy",
      source: entry("source.txt", "Input/source.txt"),
      destinationEntries: [],
      manualMode: true,
      folderPath: "Destination",
      name: "source.txt",
      manualPath: "Destination/../source.txt"
    });
    expectInvalidPlan({
      kind: "batch",
      operation: "move",
      sources: [entry("bad", "Input/bad\\name")],
      destinationEntries: [],
      manualMode: false,
      folderPath: "Destination",
      manualPath: "ignored"
    });
  });

  it("selects single manual parents, batch manual folders, and preserves invalid messages", () => {
    const invalidPathArb = fc.constantFrom("Destination/../bad", "Destination/bad%2Fname", "Destination/bad\\name");
    fc.assert(fc.property(
      fc.array(pathSegmentArb, { maxLength: 3 }),
      nameArb,
      fc.boolean(),
      fc.boolean(),
      invalidPathArb,
      (segments, leaf, batch, manualMode, invalidPath) => {
        const folder = segments.join("/");
        const manualTarget = folder ? `${folder}/${leaf}` : leaf;
        const valid = resolveDestinationListingPath({
          batch,
          manualMode,
          folderPath: decorateCanonicalPath(folder),
          manualPath: decorateCanonicalPath(manualTarget)
        });
        const expectedValidPath = !manualMode
          ? normalizeRootPath(decorateCanonicalPath(folder))
          : batch
            ? normalizeRootPath(decorateCanonicalPath(manualTarget))
            : dirname(normalizeRootPath(decorateCanonicalPath(manualTarget)));
        expect(valid).toEqual({ kind: "valid", path: expectedValidPath });

        const invalidBatch = resolveDestinationListingPath({
          batch: true,
          manualMode: true,
          folderPath: "ignored",
          manualPath: invalidPath
        });
        expect(invalidBatch).toEqual({ kind: "invalid", message: pathErrorFor(invalidPath) });
        expect(resolveDestinationListingPath({
          batch: false,
          manualMode: true,
          folderPath: "ignored",
          manualPath: invalidPath
        })).toEqual({ kind: "invalid", message: "Enter a valid destination path." });
      }
    ), PROPERTY_OPTIONS);

    expect(resolveDestinationListingPath({
      batch: false,
      manualMode: true,
      folderPath: "Projects",
      manualPath: "/Archive//report.txt"
    })).toEqual({ kind: "valid", path: "Archive" });
    expect(resolveDestinationListingPath({
      batch: true,
      manualMode: true,
      folderPath: "Projects",
      manualPath: "/Archive//"
    })).toEqual({ kind: "valid", path: "Archive" });
    expect(resolveDestinationListingPath({
      batch: false,
      manualMode: false,
      folderPath: "/Projects//",
      manualPath: "ignored"
    })).toEqual({ kind: "valid", path: "Projects" });
  });

  it("is deterministic and deeply preserves caller-owned plan inputs", () => {
    const generatedEntryArb: fc.Arbitrary<FileEntry> = fc.record({
      name: nameArb,
      tail: fc.array(pathSegmentArb, { maxLength: 2 }),
      isFolder: fc.boolean()
    }).map(({ name, tail, isFolder }) => entry(name, ["Input", ...tail, name].join("/"), isFolder));
    const destinationEntriesArb = fc.array(generatedEntryArb, { maxLength: 5 });
    const singleInputArb: fc.Arbitrary<SingleDestinationPlanInput> = fc.record({
      operation: operationArb,
      source: generatedEntryArb,
      destinationEntries: destinationEntriesArb,
      destinationFolder: destinationFolderArb,
      targetName: nameArb,
      manualMode: fc.boolean()
    }).map(({ operation, source, destinationEntries, destinationFolder, targetName, manualMode }) => ({
      kind: "single" as const,
      operation,
      source,
      destinationEntries,
      manualMode,
      folderPath: decorateCanonicalPath(destinationFolder),
      name: targetName,
      manualPath: decorateCanonicalPath(`${destinationFolder}/${targetName}`)
    }));
    const batchInputArb: fc.Arbitrary<BatchDestinationPlanInput> = fc.record({
      operation: operationArb,
      sources: fc.array(generatedEntryArb, { maxLength: 6 }),
      destinationEntries: destinationEntriesArb,
      destinationFolder: destinationFolderArb,
      manualMode: fc.boolean()
    }).map(({ operation, sources, destinationEntries, destinationFolder, manualMode }) => ({
      kind: "batch" as const,
      operation,
      sources,
      destinationEntries,
      manualMode,
      folderPath: decorateCanonicalPath(destinationFolder),
      manualPath: decorateCanonicalPath(destinationFolder)
    }));
    const planInputArb: fc.Arbitrary<DestinationPlanInput> = fc.oneof(singleInputArb, batchInputArb);

    fc.assert(fc.property(planInputArb, (input) => {
      const original = cloneValue(input);
      const firstInput = deepFreeze(cloneValue(input));
      const firstInputSnapshot = cloneValue(firstInput);
      const first = planDestination(firstInput);
      const secondInput = deepFreeze(cloneValue(input));
      const secondInputSnapshot = cloneValue(secondInput);
      const second = planDestination(secondInput);

      expect(firstInput).toEqual(firstInputSnapshot);
      expect(secondInput).toEqual(secondInputSnapshot);
      expect(input).toEqual(original);
      expect(second).toEqual(first);
    }), PROPERTY_OPTIONS);

    const explicitInput: SingleDestinationPlanInput = {
      kind: "single",
      operation: "copy",
      source: entry("資料 100%.txt", "Input/資料 100%.txt"),
      destinationEntries: [entry("existing.txt", "Destination/existing.txt")],
      manualMode: false,
      folderPath: " /Destination// ",
      name: "資料 100%.txt",
      manualPath: "ignored"
    };
    const explicitSnapshot = cloneValue(explicitInput);
    const explicitPlan = planDestination(deepFreeze(explicitInput));
    expect(explicitInput).toEqual(explicitSnapshot);
    expect(explicitPlan).toMatchObject({ kind: "valid", destinationPath: "Destination/資料 100%.txt" });
  });
});
