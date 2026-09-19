import { basename, dirname, parseNormalizedPath, resolveSandboxPath, toDisplayPath } from "@davora/shared";

export interface UploadCandidate {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly webkitRelativePath?: string;
}

export interface UploadFolderTarget {
  readonly path: string;
  readonly parentPath: string;
  readonly name: string;
}

export interface PlannedUploadFile<TFile extends UploadCandidate = UploadCandidate> {
  readonly index: number;
  readonly file: TFile;
  readonly relativeParentPath: string;
  readonly destinationParentPath: string;
  readonly destinationPath: string;
  readonly transferLabel: string;
}

export interface UploadPlan<TFile extends UploadCandidate = UploadCandidate> {
  readonly basePath: string;
  readonly files: readonly PlannedUploadFile<TFile>[];
  readonly folders: readonly UploadFolderTarget[];
  readonly includesDirectories: boolean;
  readonly directoryRoots: readonly string[];
}

function canonicalSingleSegment(value: string, description: string): string {
  const path = parseNormalizedPath(value);
  if (!path || path !== value || basename(path) !== path) {
    throw new Error(`${description} must be one canonical path segment.`);
  }
  return path;
}

function relativeParentPathForFile(file: UploadCandidate): string {
  const rawRelativePath = file.webkitRelativePath?.trim();
  if (!rawRelativePath) {
    return "";
  }
  const normalizedRelativePath = resolveSandboxPath("", rawRelativePath);
  if (normalizedRelativePath !== rawRelativePath) {
    throw new Error("Relative upload paths must be canonical.");
  }
  const segments = normalizedRelativePath.split("/").filter(Boolean);
  return segments.length <= 1 ? "" : segments.slice(0, -1).join("/");
}

export type UploadSource = "picker" | "drop";

export const UPLOAD_CONTEXT_CHANGED_MESSAGE = "Upload stopped because its account or connection context changed.";

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildUploadSuccessMessage(
  fileCount: number,
  directoryCount: number,
  currentLocationLabel: string,
  source: UploadSource
): string {
  const directorySuffix = directoryCount > 0 ? ` from ${pluralize(directoryCount, "folder")}` : "";
  const sourceSuffix = source === "drop" ? " via drag and drop" : "";
  return `Uploaded ${pluralize(fileCount, "file")}${directorySuffix} into ${currentLocationLabel}${sourceSuffix}`;
}

export function buildUploadPartialFailureMessage(
  completedFileCount: number,
  totalFileCount: number,
  currentLocationLabel: string
): string {
  return `Upload stopped after ${pluralize(completedFileCount, "file")} of ${totalFileCount} into ${currentLocationLabel}`;
}

export function buildUploadPlan<TFile extends UploadCandidate>(basePath: string, inputFiles: readonly TFile[]): UploadPlan<TFile> {
  const canonicalBasePath = parseNormalizedPath(basePath);
  if (canonicalBasePath !== basePath) {
    throw new Error("Upload base path must be canonical.");
  }

  const files = inputFiles.map((file, index) => {
    const name = canonicalSingleSegment(file.name, "Upload file name");
    const relativeParentPath = relativeParentPathForFile(file);
    const destinationParentPath = resolveSandboxPath(canonicalBasePath, relativeParentPath);
    const destinationPath = resolveSandboxPath(destinationParentPath, name);
    return Object.freeze({
      index,
      file,
      relativeParentPath,
      destinationParentPath,
      destinationPath,
      transferLabel: toDisplayPath(destinationPath)
    });
  });

  const folderPaths: string[] = [];
  const seenFolders = new Set<string>();
  const directoryRoots: string[] = [];
  const seenRoots = new Set<string>();
  for (const plannedFile of files) {
    if (!plannedFile.relativeParentPath) {
      continue;
    }
    const segments = plannedFile.relativeParentPath.split("/");
    const root = segments[0];
    if (root && !seenRoots.has(root)) {
      seenRoots.add(root);
      directoryRoots.push(root);
    }
    for (let length = 1; length <= segments.length; length += 1) {
      const path = resolveSandboxPath(canonicalBasePath, segments.slice(0, length).join("/"));
      if (!seenFolders.has(path)) {
        seenFolders.add(path);
        folderPaths.push(path);
      }
    }
  }
  const folders = folderPaths.map((path) => Object.freeze({ path, parentPath: dirname(path), name: basename(path) }));

  return Object.freeze({
    basePath: canonicalBasePath,
    files: Object.freeze(files),
    folders: Object.freeze(folders),
    includesDirectories: directoryRoots.length > 0,
    directoryRoots: Object.freeze(directoryRoots)
  });
}
