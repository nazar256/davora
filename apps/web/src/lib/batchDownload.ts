import type { FileEntry } from "@davora/shared";
import { basename } from "@davora/shared";
import JSZip from "jszip";

export interface BatchDownloadFile {
  sourcePath: string;
  archivePath: string;
  size?: number;
}

export interface BatchDownloadFailure {
  sourcePath: string;
  error: string;
}

export interface BatchDownloadPlan {
  archiveName: string;
  selectedCount: number;
  selectedFileCount: number;
  selectedDirectoryCount: number;
  directories: string[];
  files: BatchDownloadFile[];
  failedFiles: BatchDownloadFailure[];
  totalBytes?: number;
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function isDescendantPath(path: string, ancestor: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedAncestor = normalizePath(ancestor);
  if (!normalizedAncestor) {
    return false;
  }
  return normalizedPath === normalizedAncestor || normalizedPath.startsWith(`${normalizedAncestor}/`);
}

function sanitizeArchiveLabel(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "download";
}

function resolveArchiveRoot(entry: FileEntry, currentPath: string, searchActive: boolean): string {
  if (searchActive) {
    return normalizePath(entry.path || entry.name);
  }
  const normalizedCurrentPath = normalizePath(currentPath);
  if (!normalizedCurrentPath) {
    return normalizePath(entry.path || entry.name);
  }
  const normalizedEntryPath = normalizePath(entry.path);
  const prefix = `${normalizedCurrentPath}/`;
  return normalizedEntryPath.startsWith(prefix) ? normalizedEntryPath.slice(prefix.length) : normalizePath(entry.name);
}

function dedupeRootSelections(entries: FileEntry[]): FileEntry[] {
  const uniqueEntries = Array.from(new Map(entries.map((entry) => [entry.path, entry])).values());
  const sortedEntries = [...uniqueEntries].sort((left, right) => left.path.length - right.path.length);
  const roots: FileEntry[] = [];

  for (const entry of sortedEntries) {
    const coveredByFolder = roots.some((root) => root.isFolder && isDescendantPath(entry.path, root.path));
    if (!coveredByFolder) {
      roots.push(entry);
    }
  }

  return roots;
}

export function createBatchDownloadArchiveName(currentPath: string, searchActive: boolean): string {
  const label = searchActive ? "search-results" : basename(normalizePath(currentPath)) || "home";
  return `davora-${sanitizeArchiveLabel(label)}-download.zip`;
}

export async function buildBatchDownloadPlan(options: {
  entries: FileEntry[];
  currentPath: string;
  searchActive: boolean;
  listFiles: (path: string) => Promise<{ items: FileEntry[] }>;
  archiveName?: string;
}): Promise<BatchDownloadPlan> {
  const roots = dedupeRootSelections(options.entries);
  const directories = new Set<string>();
  const files: BatchDownloadFile[] = [];
  const archiveRoots = roots.map((root) => resolveArchiveRoot(root, options.currentPath, options.searchActive)).filter(Boolean);

  const collect = async (entry: FileEntry, archivePath: string): Promise<void> => {
    if (entry.isFolder) {
      directories.add(archivePath);
      const response = await options.listFiles(entry.path);
      const children = Array.isArray(response.items) ? response.items : [];
      for (const child of children) {
        await collect(child, `${archivePath}/${child.name}`);
      }
      return;
    }

    files.push({
      sourcePath: entry.path,
      archivePath,
      size: entry.size
    });
  };

  for (const root of roots) {
    const archiveRoot = resolveArchiveRoot(root, options.currentPath, options.searchActive);
    await collect(root, archiveRoot);
  }

  const totalBytes = files.every((file) => typeof file.size === "number" && Number.isFinite(file.size))
    ? files.reduce((sum, file) => sum + (file.size ?? 0), 0)
    : undefined;

  return {
    archiveName: options.archiveName ?? (archiveRoots.length === 1
      ? `${sanitizeArchiveLabel(archiveRoots[0] ?? "download")}.zip`
      : createBatchDownloadArchiveName(options.currentPath, options.searchActive)),
    selectedCount: options.entries.length,
    selectedFileCount: options.entries.filter((entry) => !entry.isFolder).length,
    selectedDirectoryCount: options.entries.filter((entry) => entry.isFolder).length,
    directories: Array.from(directories).sort((left, right) => left.split("/").length - right.split("/").length),
    files,
    failedFiles: [],
    totalBytes
  };
}

export async function downloadSelectionAsZip(options: {
  entries: FileEntry[];
  currentPath: string;
  searchActive: boolean;
  listFiles: (path: string) => Promise<{ items: FileEntry[] }>;
  fetchFile: (path: string, callbacks?: { onProgress?: (loadedBytes: number, totalBytes?: number) => void }) => Promise<{ blob: Blob; filename?: string }>;
  archiveName?: string;
  onPlanReady?: (plan: BatchDownloadPlan) => void;
  onFileProgress?: (loadedBytes: number, totalBytes?: number) => void;
  onArchiveProgress?: (percent: number) => void;
  onFileFailed?: (failure: BatchDownloadFailure) => void;
}): Promise<{ blob: Blob; plan: BatchDownloadPlan }> {
  const plan = await buildBatchDownloadPlan(options);
  options.onPlanReady?.(plan);

  const zip = new JSZip();
  for (const directory of plan.directories) {
    if (directory) {
      zip.folder(directory);
    }
  }

  const failedFiles: BatchDownloadFailure[] = [];
  let completedBytes = 0;
  for (const file of plan.files) {
    try {
      const { blob } = await options.fetchFile(file.sourcePath, {
        onProgress: (loadedBytes, totalBytes) => {
          options.onFileProgress?.(completedBytes + loadedBytes, plan.totalBytes);
        }
      });
      zip.file(file.archivePath, blob);
      completedBytes += file.size ?? blob.size;
      options.onFileProgress?.(completedBytes, plan.totalBytes);
    } catch (error) {
      const failure: BatchDownloadFailure = {
        sourcePath: file.sourcePath,
        error: error instanceof Error ? error.message : "Unable to download file."
      };
      failedFiles.push(failure);
      options.onFileFailed?.(failure);
    }
  }

  plan.failedFiles = failedFiles;

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE"
  }, (metadata) => {
    options.onArchiveProgress?.(metadata.percent);
  });

  return { blob, plan };
}
