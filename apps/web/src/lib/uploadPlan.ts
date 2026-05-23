import { resolveSandboxPath, toDisplayPath } from "@davora/shared";

export interface UploadCandidate {
  name: string;
  size: number;
  type: string;
  webkitRelativePath?: string;
}

export interface PlannedUploadFile<TFile extends UploadCandidate = UploadCandidate> {
  file: TFile;
  relativeParentPath: string;
  destinationParentPath: string;
  destinationPath: string;
  transferLabel: string;
}

export interface UploadSelectionPlan<TFile extends UploadCandidate = UploadCandidate> {
  files: PlannedUploadFile<TFile>[];
  foldersToCreate: string[];
  includesDirectories: boolean;
  directoryRoots: string[];
}

function relativeParentPathForFile(file: UploadCandidate): string {
  const rawRelativePath = file.webkitRelativePath?.trim();
  if (!rawRelativePath) {
    return "";
  }

  const normalizedRelativePath = resolveSandboxPath("", rawRelativePath);
  const segments = normalizedRelativePath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "";
  }

  return segments.slice(0, -1).join("/");
}

export function buildUploadSelectionPlan<TFile extends UploadCandidate>(currentPath: string, files: readonly TFile[]): UploadSelectionPlan<TFile> {
  const plannedFiles = files.map((file) => {
    const relativeParentPath = relativeParentPathForFile(file);
    const destinationParentPath = resolveSandboxPath(currentPath, relativeParentPath);
    const destinationPath = resolveSandboxPath(destinationParentPath, file.name);
    return {
      file,
      relativeParentPath,
      destinationParentPath,
      destinationPath,
      transferLabel: toDisplayPath(destinationPath)
    } satisfies PlannedUploadFile<TFile>;
  });

  const folderSet = new Set<string>();
  const folderPaths: string[] = [];
  const directoryRootSet = new Set<string>();

  for (const plannedFile of plannedFiles) {
    if (!plannedFile.relativeParentPath) {
      continue;
    }

    const segments = plannedFile.relativeParentPath.split("/").filter(Boolean);
    if (segments[0]) {
      directoryRootSet.add(segments[0]);
    }

    for (let index = 1; index <= segments.length; index += 1) {
      const nextFolderPath = resolveSandboxPath(currentPath, segments.slice(0, index).join("/"));
      if (!folderSet.has(nextFolderPath)) {
        folderSet.add(nextFolderPath);
        folderPaths.push(nextFolderPath);
      }
    }
  }

  return {
    files: plannedFiles,
    foldersToCreate: folderPaths,
    includesDirectories: directoryRootSet.size > 0,
    directoryRoots: Array.from(directoryRootSet)
  };
}
