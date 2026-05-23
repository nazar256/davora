import {
  basename,
  dirname,
  resolveSandboxPath,
  type DeleteRequest,
  type FileEntry,
  type FileMetadata,
  type FilePreview,
  type MoveCopyRequest,
  type MutationResult,
  type SearchResult,
  type UploadFileRequest,
  type ViewerKind
} from "@davora/shared";

interface MockNode extends FileMetadata {
  content?: string;
  binaryContent?: Uint8Array;
}

function createTimestamp(offsetMinutes = 0): string {
  return new Date(Date.UTC(2026, 4, 19, 9, offsetMinutes, 0)).toISOString();
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

const INITIAL_ENTRIES: MockNode[] = [
  { path: "", name: "Mock Root", isFolder: true, lastModified: createTimestamp(0), etag: "root" },
  { path: "Projects", name: "Projects", isFolder: true, lastModified: createTimestamp(10), etag: "projects" },
  {
    path: "Projects/roadmap.txt",
    name: "roadmap.txt",
    isFolder: false,
    size: 70,
    mimeType: "text/plain",
    lastModified: createTimestamp(11),
    etag: "roadmap",
    content: "Davora v1 roadmap\n- normalized API\n- offline cache\n- safe validation"
  },
  {
    path: "Projects/demo.json",
    name: "demo.json",
    isFolder: false,
    size: 38,
    mimeType: "application/json",
    lastModified: createTimestamp(12),
    etag: "demo-json",
    content: "{\n  \"status\": \"ok\",\n  \"mode\": \"mock\"\n}"
  },
  {
    path: "Projects/song.mp3",
    name: "song.mp3",
    isFolder: false,
    size: 12,
    mimeType: "audio/mpeg",
    lastModified: createTimestamp(13),
    etag: "song-binary",
    binaryContent: new Uint8Array([0x49, 0x44, 0x33, 0x00])
  },
  {
    path: "Projects/clip.mp4",
    name: "clip.mp4",
    isFolder: false,
    size: 16,
    mimeType: "video/mp4",
    lastModified: createTimestamp(14),
    etag: "clip-binary",
    binaryContent: new Uint8Array([0x00, 0x00, 0x00, 0x18])
  },
  { path: "Design", name: "Design", isFolder: true, lastModified: createTimestamp(18), etag: "design" },
  {
    path: "Design/spec.md",
    name: "spec.md",
    isFolder: false,
    size: 62,
    mimeType: "text/markdown;charset=UTF-8",
    lastModified: createTimestamp(19),
    etag: "spec-md",
    content: "# Mock spec\n\nOffline state should keep recent folders visible."
  },
  { path: "Archive", name: "Archive", isFolder: true, lastModified: createTimestamp(20), etag: "archive" },
  {
    path: "Archive/photo.png",
    name: "photo.png",
    isFolder: false,
    size: 68,
    mimeType: "image/png",
    lastModified: createTimestamp(21),
    etag: "photo-png",
    binaryContent: base64Bytes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAAABytg0AAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7vGjAAAAAASUVORK5CYII=")
  },
  {
    path: "Archive/guide.pdf",
    name: "guide.pdf",
    isFolder: false,
    size: 455,
    mimeType: "application/pdf",
    lastModified: createTimestamp(22),
    etag: "guide-pdf",
    binaryContent: textBytes("%PDF-1.1\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n4 0 obj<< /Length 44 >>stream\nBT /F1 18 Tf 36 120 Td (Davora PDF preview) Tj ET\nendstream endobj\n5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\nxref\n0 6\n0000000000 65535 f \ntrailer<< /Root 1 0 R /Size 6 >>\nstartxref\n0\n%%EOF")
  },
  {
    path: "Archive/image.bin",
    name: "image.bin",
    isFolder: false,
    size: 4,
    mimeType: "application/octet-stream",
    lastModified: createTimestamp(22),
    etag: "image-bin",
    binaryContent: new Uint8Array([0xde, 0xad, 0xbe, 0xef])
  }
];

const entriesByAccount = new Map<string, MockNode[]>();

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/^\/+|\/+$/g, "");
}

function cloneNode(node: MockNode): MockNode {
  return {
    ...node,
    ...(node.binaryContent ? { binaryContent: new Uint8Array(node.binaryContent) } : {})
  };
}

function cloneInitialEntries(): MockNode[] {
  return INITIAL_ENTRIES.map((item) => cloneNode(item));
}

function getEntries(accountId: string): MockNode[] {
  if (!entriesByAccount.has(accountId)) {
    entriesByAccount.set(accountId, cloneInitialEntries());
  }
  return entriesByAccount.get(accountId)!;
}

function setEntries(accountId: string, nextEntries: MockNode[]): void {
  entriesByAccount.set(accountId, nextEntries);
}

function refreshNode(node: MockNode): MockNode {
  const now = new Date().toISOString();
  const size = node.content ? Buffer.byteLength(node.content) : node.binaryContent?.byteLength ?? node.size;
  return {
    ...node,
    ...(size !== undefined ? { size } : {}),
    lastModified: now,
    etag: `${node.path || "root"}:${now}`
  };
}

function updateNode(accountId: string, path: string, updater: (node: MockNode) => MockNode) {
  const entries = [...getEntries(accountId)];
  const index = entries.findIndex((item) => item.path === path);
  if (index < 0) {
    throw new Error("Resource not found.");
  }
  entries[index] = updater(entries[index]!);
  setEntries(accountId, entries);
}

function insertNode(accountId: string, node: MockNode) {
  setEntries(accountId, [...getEntries(accountId), refreshNode(node)]);
}

function removePath(accountId: string, path: string) {
  const normalizedPath = normalizePath(path);
  setEntries(accountId, getEntries(accountId).filter((entry) => entry.path !== normalizedPath && !entry.path.startsWith(`${normalizedPath}/`)));
}

function entry(accountId: string, path: string): MockNode | undefined {
  const target = normalizePath(path);
  return getEntries(accountId).find((item) => item.path === target);
}

function ensureParentExists(accountId: string, path: string): void {
  const parentPath = dirname(path);
  const parent = entry(accountId, parentPath);
  if (!parent || !parent.isFolder) {
    throw new Error("Parent folder not found.");
  }
}

function ensureNotExists(accountId: string, path: string): void {
  if (entry(accountId, path)) {
    throw new Error("Destination already exists.");
  }
}

function renameBranch(accountId: string, sourcePath: string, destinationPath: string): void {
  const normalizedSource = normalizePath(sourcePath);
  const normalizedDestination = normalizePath(destinationPath);
  const branch = getEntries(accountId)
    .filter((item) => item.path === normalizedSource || item.path.startsWith(`${normalizedSource}/`))
    .map((item) => cloneNode(item));

  removePath(accountId, normalizedSource);
  branch.forEach((node) => {
    const suffix = node.path === normalizedSource ? "" : node.path.slice(normalizedSource.length + 1);
    insertNode(accountId, {
      ...node,
      path: suffix ? `${normalizedDestination}/${suffix}` : normalizedDestination,
      name: suffix ? basename(suffix) : basename(normalizedDestination)
    });
  });
}

function duplicateBranch(accountId: string, sourcePath: string, destinationPath: string): void {
  const normalizedSource = normalizePath(sourcePath);
  const normalizedDestination = normalizePath(destinationPath);
  const branch = getEntries(accountId)
    .filter((item) => item.path === normalizedSource || item.path.startsWith(`${normalizedSource}/`))
    .map((item) => cloneNode(item));

  branch.forEach((node) => {
    const suffix = node.path === normalizedSource ? "" : node.path.slice(normalizedSource.length + 1);
    insertNode(accountId, {
      ...node,
      path: suffix ? `${normalizedDestination}/${suffix}` : normalizedDestination,
      name: suffix ? basename(suffix) : basename(normalizedDestination)
    });
  });
}

function determineViewer(mimeType: string | undefined): ViewerKind {
  if (!mimeType) {
    return "text";
  }
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
  if (normalizedMimeType.includes("json") || normalizedMimeType.includes("xml") || normalizedMimeType.includes("javascript")) {
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

function stripPayload(node: MockNode): FileMetadata {
  const { content: _content, binaryContent: _binaryContent, ...metadata } = node;
  return metadata;
}

function previewFromNode(node: MockNode): FilePreview {
  const viewer = determineViewer(node.mimeType);
  if (viewer === "text" || viewer === "markdown") {
    return {
      ...stripPayload(node),
      viewer,
      content: node.content ?? "",
      encoding: "utf8",
      truncated: false,
      bytesRead: Buffer.byteLength(node.content ?? "")
    };
  }

  if (viewer === "image" || viewer === "audio" || viewer === "video" || viewer === "pdf") {
    return {
      ...stripPayload(node),
      viewer,
      content: "",
      encoding: "none",
      truncated: false,
      bytesRead: 0,
      unsupportedReason: viewer === "pdf"
        ? "Open the original PDF in a new tab or download it if embed preview is unavailable."
        : "Open the original file content for media preview.",
      requiresOriginalBlob: true
    };
  }

  return {
    ...stripPayload(node),
    viewer: "unsupported",
    content: "",
    encoding: "none",
    truncated: false,
    bytesRead: 0,
    unsupportedReason: "This file type is not previewable in v1. Open the original file in a new tab or download it instead."
  };
}

export function resetMockEntries(accountId?: string): void {
  if (!accountId) {
    entriesByAccount.clear();
    return;
  }
  entriesByAccount.set(accountId, cloneInitialEntries());
}

export function listMockFolder(accountId: string, path: string): FileEntry[] {
  const target = normalizePath(path);
  return getEntries(accountId)
    .filter((item) => {
      if (item.path === target) {
        return false;
      }
      const parent = item.path.split("/").slice(0, -1).join("/");
      return parent === target;
    })
    .map((item) => stripPayload(item))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function getMockMetadata(accountId: string, path: string): FileMetadata | undefined {
  const found = entry(accountId, path);
  return found ? stripPayload(found) : undefined;
}

export function readMockFile(accountId: string, path: string): FilePreview | undefined {
  const found = entry(accountId, path);
  if (!found || found.isFolder) {
    return undefined;
  }
  return previewFromNode(found);
}

export function getMockOriginal(accountId: string, path: string): { body: Uint8Array; metadata: FileMetadata } | undefined {
  const found = entry(accountId, path);
  if (!found || found.isFolder) {
    return undefined;
  }
  return {
    body: found.binaryContent ?? textBytes(found.content ?? ""),
    metadata: stripPayload(found)
  };
}

export function searchMockFiles(accountId: string, query: string, path: string): SearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const root = normalizePath(path);
  if (!normalizedQuery) {
    return [];
  }

  return getEntries(accountId)
    .filter((item) => item.path.startsWith(root))
    .map((item) => {
      const lowerPath = item.path.toLowerCase();
      const lowerName = item.name.toLowerCase();
      let score = 0;
      if (lowerName === normalizedQuery) {
        score = 100;
      } else if (lowerName.includes(normalizedQuery)) {
        score = 75;
      } else if (lowerPath.includes(normalizedQuery)) {
        score = 50;
      }
      return score > 0 ? { ...stripPayload(item), score } : undefined;
    })
    .filter((item): item is SearchResult => Boolean(item))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

export function downloadMockFile(accountId: string, path: string): { filename: string; body: Uint8Array; mimeType: string } | undefined {
  const original = getMockOriginal(accountId, path);
  if (!original) {
    return undefined;
  }

  return {
    filename: original.metadata.name,
    body: original.body,
    mimeType: original.metadata.mimeType ?? "application/octet-stream"
  };
}

export function createMockFolder(accountId: string, path: string, name: string): MutationResult {
  const parentPath = normalizePath(path);
  if (name.trim().length === 0) {
    throw new Error("Folder name is required.");
  }
  const nextPath = resolveSandboxPath(parentPath, name);
  ensureParentExists(accountId, nextPath);
  ensureNotExists(accountId, nextPath);
  insertNode(accountId, { path: nextPath, name: basename(nextPath), isFolder: true, mimeType: "httpd/unix-directory" });
  return {
    action: "createFolder",
    parentPath,
    path: nextPath,
    item: getMockMetadata(accountId, nextPath)
  };
}

export function uploadMockFile(accountId: string, request: UploadFileRequest): MutationResult {
  const parentPath = normalizePath(request.path);
  if (request.name.trim().length === 0) {
    throw new Error("File name is required.");
  }
  const nextPath = resolveSandboxPath(parentPath, request.name);
  ensureParentExists(accountId, nextPath);
  const decoded = Uint8Array.from(Buffer.from(request.contentBase64, "base64"));
  const mimeType = request.mimeType?.trim() || "application/octet-stream";
  const viewer = determineViewer(mimeType);
  const node: MockNode = {
    path: nextPath,
    name: basename(nextPath),
    isFolder: false,
    mimeType,
    ...(viewer === "text" || viewer === "markdown" ? { content: new TextDecoder().decode(decoded) } : { binaryContent: decoded })
  };

  if (entry(accountId, nextPath)) {
    updateNode(accountId, nextPath, () => refreshNode(node));
  } else {
    insertNode(accountId, node);
  }

  return {
    action: "upload",
    parentPath,
    path: nextPath,
    item: getMockMetadata(accountId, nextPath)
  };
}

export function moveMockResource(accountId: string, request: MoveCopyRequest): MutationResult {
  const sourcePath = normalizePath(request.path);
  const destinationPath = normalizePath(request.destinationPath);
  if (!entry(accountId, sourcePath)) {
    throw new Error("Resource not found.");
  }
  ensureParentExists(accountId, destinationPath);
  if (!request.overwrite) {
    ensureNotExists(accountId, destinationPath);
  } else if (entry(accountId, destinationPath)) {
    removePath(accountId, destinationPath);
  }
  renameBranch(accountId, sourcePath, destinationPath);
  return {
    action: "move",
    parentPath: dirname(destinationPath),
    path: sourcePath,
    destinationPath,
    item: getMockMetadata(accountId, destinationPath)
  };
}

export function copyMockResource(accountId: string, request: MoveCopyRequest): MutationResult {
  const sourcePath = normalizePath(request.path);
  const destinationPath = normalizePath(request.destinationPath);
  if (!entry(accountId, sourcePath)) {
    throw new Error("Resource not found.");
  }
  ensureParentExists(accountId, destinationPath);
  if (!request.overwrite) {
    ensureNotExists(accountId, destinationPath);
  } else if (entry(accountId, destinationPath)) {
    removePath(accountId, destinationPath);
  }
  duplicateBranch(accountId, sourcePath, destinationPath);
  return {
    action: "copy",
    parentPath: dirname(destinationPath),
    path: sourcePath,
    destinationPath,
    item: getMockMetadata(accountId, destinationPath)
  };
}

export function deleteMockResource(accountId: string, request: DeleteRequest): MutationResult {
  const targetPath = normalizePath(request.path);
  const target = entry(accountId, targetPath);
  if (!target) {
    throw new Error("Resource not found.");
  }
  if (request.confirmName.trim() !== target.name) {
    throw new Error("Delete confirmation does not match the target name.");
  }
  removePath(accountId, targetPath);
  return {
    action: "delete",
    parentPath: dirname(targetPath),
    path: targetPath
  };
}
