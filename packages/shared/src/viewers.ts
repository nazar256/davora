import type { BackendKind, CapabilitySet, ViewerKind } from "./contracts";

export function getViewerKind(mimeType: string | undefined): ViewerKind {
  const normalizedMimeType = mimeType?.split(";", 1)[0]?.trim().toLowerCase();

  if (!normalizedMimeType) {
    return "text";
  }
  if (normalizedMimeType === "application/pdf") {
    return "pdf";
  }
  if (normalizedMimeType === "text/markdown" || normalizedMimeType.includes("markdown")) {
    return "markdown";
  }
  if (normalizedMimeType.startsWith("text/")) {
    return "text";
  }
  if (["json", "xml", "javascript"].some((part) => normalizedMimeType.includes(part))) {
    return "text";
  }
  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }
  if (normalizedMimeType.startsWith("audio/")) {
    return "audio";
  }
  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }
  return "unsupported";
}

export function buildCapabilitySet(backend: BackendKind, options: { readOnly?: boolean } = {}): CapabilitySet {
  const readOnly = options.readOnly ?? false;
  return {
    backend,
    readOnly,
    search: true,
    preview: true,
    download: true,
    offlineCache: true,
    createFolder: !readOnly,
    upload: !readOnly,
    move: !readOnly,
    copy: !readOnly,
    delete: !readOnly,
    mediaPreview: true,
    markdownPreview: true,
    openedFileCache: true
  };
}
