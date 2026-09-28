import { assertNever, getViewerKind, type ViewerKind } from "@davora/shared";

export interface PreviewCacheState {
  source: "none" | "live" | "cache";
  cachedAt?: string;
  refreshing: boolean;
  stale: boolean;
  updateReady: boolean;
}

const MEDIA_GALLERY_VIEWERS = new Set<ViewerKind>(["image", "audio", "video"]);

export function viewerHeading(viewer: ViewerKind | undefined): string {
  switch (viewer) {
    case "markdown":
      return "Markdown preview";
    case "image":
      return "Image preview";
    case "audio":
      return "Audio preview";
    case "video":
      return "Video preview";
    case "pdf":
      return "PDF preview";
    case "unsupported":
      return "Unsupported preview";
    case "text":
    case undefined:
      return "Text preview";
    default:
      return assertNever(viewer, "viewer heading");
  }
}

export function requiresOriginalBlobViewer(viewer: ViewerKind | undefined): boolean {
  return viewer === "image" || viewer === "audio" || viewer === "video" || viewer === "pdf";
}

export function isStreamingMediaViewer(viewer: ViewerKind | undefined): boolean {
  return viewer === "audio" || viewer === "video";
}

export function isMediaGalleryViewer(viewer: ViewerKind | undefined): boolean {
  return viewer ? MEDIA_GALLERY_VIEWERS.has(viewer) : false;
}

export function normalizePreviewMimeType(mimeType: string | undefined): string | undefined {
  return mimeType?.split(";", 1)[0]?.trim();
}

export function formatPreviewFileTimestamp(value: string | undefined, variant: "compact" | "full" = "full"): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getUTCMonth()];
  const day = date.getUTCDate();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");

  if (variant === "compact") {
    return `${month} ${day}, ${hour}:${minute}`;
  }

  return `${month} ${day}, ${date.getUTCFullYear()}, ${hour}:${minute}`;
}

export function resolvePreviewViewer(
  fileViewer: ViewerKind | undefined,
  entryMimeType: string | undefined
): ViewerKind | undefined {
  return fileViewer ?? getViewerKind(entryMimeType);
}
