import type { FileEntry } from "@davora/shared";
import { basename, dirname, normalizeRootPath } from "@davora/shared";

import type {
  BatchDestinationPlanInput,
  DestinationListingInput,
  DestinationListingPath,
  DestinationOperation,
  DestinationPlan,
  DestinationTarget,
  SingleDestinationPlanInput
} from "./model";

function splitNameForConflictSuffix(name: string): { stem: string; extension: string } {
  const finalDot = name.lastIndexOf(".");
  if (finalDot > 0 && finalDot < name.length - 1) {
    return { stem: name.slice(0, finalDot), extension: name.slice(finalDot) };
  }
  return { stem: name, extension: "" };
}

export function addConflictSuffix(name: string, suffix: number): string {
  const { stem, extension } = splitNameForConflictSuffix(name);
  return `${stem} (${suffix})${extension}`;
}

export function destinationNameExists(
  entries: readonly FileEntry[],
  name: string,
  selectedEntry: FileEntry,
  operation: DestinationOperation
): boolean {
  return entries.some((entry) => entry.name === name && (operation === "copy" || entry.path !== selectedEntry.path));
}

export function suggestDestinationName(
  entries: readonly FileEntry[],
  name: string,
  selectedEntry: FileEntry,
  operation: DestinationOperation
): string {
  const trimmedName = name.trim();
  if (!destinationNameExists(entries, trimmedName, selectedEntry, operation)) {
    return trimmedName;
  }

  for (let suffix = 1; ; suffix += 1) {
    const candidate = addConflictSuffix(trimmedName, suffix);
    if (!destinationNameExists(entries, candidate, selectedEntry, operation)) {
      return candidate;
    }
  }
}

function joinCanonicalPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function buildDestinationDraftPath(parentPath: string, name: string): string {
  const trimmedParent = parentPath.trim().replace(/^\/+|\/+$/g, "");
  const trimmedName = name.trim();
  return joinCanonicalPath(trimmedParent, trimmedName);
}

function invalid(destinationPath: string, message: string): DestinationPlan {
  return { kind: "invalid", destinationPath, message };
}

function normalizeName(name: string): string | undefined {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return undefined;
  }
  const normalizedName = normalizeRootPath(trimmedName);
  return normalizedName && !normalizedName.includes("/") ? normalizedName : undefined;
}

function isSameOrDescendantPath(path: string, possibleAncestor: string): boolean {
  return path === possibleAncestor || path.startsWith(`${possibleAncestor}/`);
}

function normalizedSourcePath(source: FileEntry): string {
  return normalizeRootPath(source.path);
}

export function resolveDestinationListingPath(input: DestinationListingInput): DestinationListingPath {
  try {
    if (!input.manualMode) {
      return { kind: "valid", path: normalizeRootPath(input.folderPath) };
    }

    const manualPath = normalizeRootPath(input.manualPath);
    return { kind: "valid", path: input.batch ? manualPath : dirname(manualPath) };
  } catch (error) {
    return {
      kind: "invalid",
      message: input.batch && error instanceof Error ? error.message : "Enter a valid destination path."
    };
  }
}

function planSingle(input: SingleDestinationPlanInput): DestinationPlan {
  let destinationPath = input.manualMode
    ? input.manualPath.trim()
    : buildDestinationDraftPath(input.folderPath, input.name);
  let destinationName: string;
  let destinationParentPath: string;

  if (!input.manualMode && input.name.includes("/")) {
    return invalid(destinationPath, "Destination name cannot contain slashes. Use Manual path for a full destination path.");
  }

  try {
    if (input.manualMode) {
      destinationPath = normalizeRootPath(input.manualPath);
      destinationName = basename(destinationPath);
      destinationParentPath = dirname(destinationPath);
    } else {
      destinationParentPath = normalizeRootPath(input.folderPath);
      const normalizedName = normalizeName(input.name);
      if (!normalizedName) {
        return invalid(destinationParentPath, "Choose a destination name before continuing.");
      }
      destinationName = normalizedName;
      destinationPath = joinCanonicalPath(destinationParentPath, destinationName);
    }
  } catch {
    return invalid(
      destinationPath,
      input.manualMode ? "Enter a valid destination path." : "Enter a valid destination name."
    );
  }

  if (!destinationPath || !destinationName) {
    return invalid(destinationPath, "Choose a destination name before continuing.");
  }

  let sourcePath: string;
  try {
    sourcePath = normalizedSourcePath(input.source);
  } catch {
    return invalid(destinationPath, "Enter a valid destination path.");
  }

  if (destinationPath === sourcePath) {
    return invalid(
      destinationPath,
      input.operation === "copy"
        ? `Destination already contains ${destinationName}. Use ${suggestDestinationName(input.destinationEntries, destinationName, input.source, "copy")} or choose a different folder.`
        : "Choose a different destination folder or name."
    );
  }

  if (input.source.isFolder && isSameOrDescendantPath(destinationParentPath, sourcePath)) {
    return invalid(destinationPath, "Folders cannot be moved or copied into themselves or their descendants.");
  }

  if (destinationNameExists(input.destinationEntries, destinationName, input.source, input.operation)) {
    const suggestedName = input.operation === "copy"
      ? suggestDestinationName(input.destinationEntries, destinationName, input.source, "copy")
      : undefined;
    return invalid(
      destinationPath,
      suggestedName
        ? `Destination already contains ${destinationName}. Use ${suggestedName} or choose a different folder.`
        : `Destination already contains ${destinationName}. Choose a different name or folder.`
    );
  }

  return {
    kind: "valid",
    destinationPath,
    targets: [{ source: input.source, destinationPath }]
  };
}

function planBatch(input: BatchDestinationPlanInput): DestinationPlan {
  let destinationFolderPath: string;
  try {
    destinationFolderPath = normalizeRootPath(input.manualMode ? input.manualPath : input.folderPath);
  } catch (error) {
    return invalid(
      input.manualPath.trim(),
      error instanceof Error ? error.message : "Enter a valid destination folder path."
    );
  }

  const plannedEntries = [...input.destinationEntries];
  const targets: DestinationTarget[] = [];

  for (const source of input.sources) {
    let sourcePath: string;
    let destinationName: string;
    try {
      sourcePath = normalizedSourcePath(source);
      const normalizedName = normalizeName(source.name);
      if (!normalizedName) {
        return invalid(destinationFolderPath, "Enter a valid destination name.");
      }
      destinationName = normalizedName;
    } catch {
      return invalid(destinationFolderPath, "Enter a valid destination name.");
    }

    if (source.isFolder && isSameOrDescendantPath(destinationFolderPath, sourcePath)) {
      return invalid(
        destinationFolderPath,
        "Selected folders cannot be moved or copied into themselves or their descendants."
      );
    }

    const directDestinationPath = joinCanonicalPath(destinationFolderPath, destinationName);
    const hasConflict = directDestinationPath === sourcePath
      || destinationNameExists(plannedEntries, destinationName, source, input.operation);
    if (hasConflict) {
      if (input.operation === "move") {
        return invalid(
          directDestinationPath,
          `Destination already contains ${destinationName}. Choose a different folder.`
        );
      }
      destinationName = suggestDestinationName(plannedEntries, destinationName, source, "copy");
    }

    const destinationPath = joinCanonicalPath(destinationFolderPath, destinationName);
    targets.push({ source, destinationPath });
    plannedEntries.push({ ...source, path: destinationPath, name: destinationName });
  }

  return { kind: "valid", destinationPath: destinationFolderPath, targets };
}

export function planDestination(input: SingleDestinationPlanInput | BatchDestinationPlanInput): DestinationPlan {
  return input.kind === "single" ? planSingle(input) : planBatch(input);
}
