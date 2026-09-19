import type { FileEntry, FilePreview } from "@davora/shared";

export const buildFileEntry = (
  path: string,
  overrides: Partial<FileEntry> = {}
): FileEntry => ({
  path,
  name: path.split("/").at(-1) ?? path,
  isFolder: false,
  mimeType: "text/plain",
  ...overrides
});

export const buildFilePreview = (
  path: string,
  overrides: Partial<FilePreview> = {}
): FilePreview => ({
  ...buildFileEntry(path),
  viewer: "text",
  content: "fixture preview",
  encoding: "utf8",
  truncated: false,
  bytesRead: 15,
  ...overrides
});
