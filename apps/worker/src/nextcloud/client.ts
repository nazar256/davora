import {
  basename,
  dirname,
  getViewerKind,
  resolveSandboxPath,
  stripSandboxRoot,
  type CreateFolderRequest,
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

import { parseMultiStatusXml } from "./xml";

interface NextcloudCredentials {
  baseUrl: string;
  username: string;
  appPassword: string;
  rootPath: string;
  maxFileBytes: number;
  maxTextFileBytes: number;
}

function createBasicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function encodeDavPath(baseUrl: string, username: string, fullPath: string): string {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const basePath = url.pathname.replace(/\/+$/, "");
  const encodedPath = fullPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  url.pathname = `${basePath}/remote.php/dav/files/${encodeURIComponent(username)}${encodedPath ? `/${encodedPath}` : ""}`.replace(/\/+/g, "/");
  return url.toString();
}

function decodeDavHref(baseUrl: string, username: string, href: string, rootPath: string): string {
  const url = new URL(href, baseUrl);
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  const relativePath = basePath && url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname;
  const segments = relativePath
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length < 4 || segments[0] !== "remote.php" || segments[1] !== "dav" || segments[2] !== "files") {
    throw new Error("Unexpected DAV href returned by upstream.");
  }
  if (segments[3] !== username) {
    throw new Error("DAV href username mismatch.");
  }

  return stripSandboxRoot(rootPath, segments.slice(4).join("/"));
}

function isInlineTextViewer(viewer: ViewerKind): boolean {
  return viewer === "text" || viewer === "markdown";
}

function metadataFromItem(
  path: string,
  item: {
    isFolder: boolean;
    displayName?: string;
    size?: number;
    contentType?: string;
    etag?: string;
    lastModified?: string;
    permissions?: string;
    ownerDisplayName?: string;
  }
): FileMetadata {
  return {
    path,
    name: item.displayName || basename(path) || "/",
    isFolder: item.isFolder,
    ...(item.size !== undefined ? { size: item.size } : {}),
    ...(item.contentType ? { mimeType: item.contentType } : {}),
    ...(item.etag ? { etag: item.etag } : {}),
    ...(item.lastModified ? { lastModified: item.lastModified } : {}),
    ...(item.permissions ? { permissions: item.permissions } : {}),
    ...(item.ownerDisplayName ? { ownerDisplayName: item.ownerDisplayName } : {})
  };
}

function scoreMatch(query: string, path: string, name: string): number {
  if (name.toLowerCase() === query) {
    return 100;
  }
  if (name.toLowerCase().includes(query)) {
    return 75;
  }
  if (path.toLowerCase().includes(query)) {
    return 50;
  }
  return 0;
}

function metadataOnly(metadata: FileMetadata, reason: string, truncated: boolean, viewer: ViewerKind = "unsupported", requiresOriginalBlob = false): FilePreview {
  return {
    ...metadata,
    viewer,
    content: "",
    encoding: "none",
    truncated,
    bytesRead: 0,
    unsupportedReason: reason,
    ...(requiresOriginalBlob ? { requiresOriginalBlob: true } : {})
  };
}

function ensureDeleteConfirmation(path: string, confirmName: string): void {
  const expected = basename(path);
  if (confirmName.trim() !== expected) {
    throw new Error("Delete confirmation does not match the target name.");
  }
}

export class NextcloudClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly credentials: NextcloudCredentials,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  private async request(path: string, init: RequestInit & { headers?: Record<string, string> }, allowedStatuses: number[] = []): Promise<Response> {
    const response = await this.fetchImpl(encodeDavPath(this.credentials.baseUrl, this.credentials.username, path), {
      ...init,
      redirect: "manual",
      headers: {
        authorization: createBasicAuth(this.credentials.username, this.credentials.appPassword),
        ...init.headers
      }
    });

    if (!response.ok && response.status !== 207 && response.status !== 206 && !allowedStatuses.includes(response.status)) {
      throw new Error(`Nextcloud request failed with ${response.status}.`);
    }

    return response;
  }

  private async propfind(path: string, depth: 0 | 1, limit?: number): Promise<Array<{ path: string; item: ReturnType<typeof parseMultiStatusXml>[number] }>> {
    const response = await this.request(
      path,
      {
        method: "PROPFIND",
        headers: {
          depth: String(depth),
          "content-type": "application/xml; charset=utf-8"
        },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:prop><d:displayname/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:getetag/><d:resourcetype/><oc:permissions/><oc:owner-display-name/></d:prop></d:propfind>'
      },
      [404]
    );

    if (response.status === 404) {
      return [];
    }

    const xml = await response.text();
    const items = parseMultiStatusXml(xml).map((item) => ({
      path: decodeDavHref(this.credentials.baseUrl, this.credentials.username, item.href, this.credentials.rootPath),
      item
    }));

    return limit === undefined ? items : items.slice(0, limit);
  }

  private async getRequiredMetadata(path: string): Promise<FileMetadata> {
    const metadata = await this.getMetadata(path);
    if (!metadata) {
      throw new Error("Resource not found.");
    }
    return metadata;
  }

  private async pathExists(path: string): Promise<boolean> {
    const response = await this.request(
      path,
      {
        method: "PROPFIND",
        headers: {
          depth: "0",
          "content-type": "application/xml; charset=utf-8"
        },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:prop><d:displayname/></d:prop></d:propfind>'
      },
      [404]
    );

    return response.status !== 404;
  }

  private async ensureRootExists(): Promise<void> {
    const segments = this.credentials.rootPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (await this.pathExists(currentPath)) {
        continue;
      }
      await this.request(currentPath, { method: "MKCOL" }, [405]);
    }
  }

  async validateRoot(): Promise<FileMetadata> {
    let items = await this.propfind(this.credentials.rootPath, 0);
    if (items.length === 0) {
      await this.ensureRootExists();
      items = await this.propfind(this.credentials.rootPath, 0);
    }
    if (items.length === 0) {
      throw new Error("Configured root path was not found.");
    }
    return metadataFromItem(items[0]!.path, items[0]!.item);
  }

  async listFolder(path = ""): Promise<FileEntry[]> {
    const target = resolveSandboxPath(this.credentials.rootPath, path);
    const folderPath = stripSandboxRoot(this.credentials.rootPath, target);
    const items = await this.propfind(target, 1, 201);

    return items
      .filter((entry) => entry.path !== folderPath)
      .map(({ path: itemPath, item }) => metadataFromItem(itemPath, item))
      .slice(0, 200)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async getMetadata(path = ""): Promise<FileMetadata | undefined> {
    const target = resolveSandboxPath(this.credentials.rootPath, path);
    const expectedPath = stripSandboxRoot(this.credentials.rootPath, target);
    const items = await this.propfind(target, 0);
    const match = items.find((item) => item.path === expectedPath) ?? items[0];
    return match ? metadataFromItem(match.path, match.item) : undefined;
  }

  async readFile(path: string): Promise<FilePreview> {
    const metadata = await this.getRequiredMetadata(path);
    if (metadata.isFolder) {
      throw new Error("Cannot read a folder.");
    }

    const viewer = getViewerKind(metadata.mimeType);
    if (!isInlineTextViewer(viewer)) {
      if (viewer === "image" || viewer === "audio" || viewer === "video" || viewer === "pdf") {
        return metadataOnly(
          metadata,
          viewer === "pdf" ? "Open the original PDF in a new tab or download it if embed preview is unavailable." : "Open the original file content for media preview.",
          false,
          viewer,
          true
        );
      }
      return metadataOnly(metadata, "This file type is not previewable in v1. Open the original file in a new tab or download it instead.", false, "unsupported", false);
    }

    if (metadata.size !== undefined && metadata.size > this.credentials.maxTextFileBytes) {
      return metadataOnly(metadata, `Text extraction is limited to files up to ${this.credentials.maxTextFileBytes} bytes.`, true, viewer);
    }

    const readLimit = Math.min(this.credentials.maxFileBytes, this.credentials.maxTextFileBytes);
    const target = resolveSandboxPath(this.credentials.rootPath, path);
    const response = await this.request(target, {
      method: "GET",
      headers: {
        range: `bytes=0-${Math.max(readLimit - 1, 0)}`
      }
    });

    const responseContentType = response.headers.get("content-type") ?? metadata.mimeType;
    const responseViewer = getViewerKind(responseContentType ?? metadata.mimeType);
    if (!isInlineTextViewer(responseViewer)) {
      await response.body?.cancel();
      return metadataOnly(
        { ...metadata, ...(responseContentType ? { mimeType: responseContentType } : {}) },
        responseViewer === "image" || responseViewer === "audio" || responseViewer === "video" || responseViewer === "pdf"
          ? responseViewer === "pdf"
            ? "Open the original PDF in a new tab or download it if embed preview is unavailable."
            : "Open the original file content for media preview."
          : "This file type is not previewable in v1. Open the original file in a new tab or download it instead.",
        false,
        responseViewer,
        responseViewer === "image" || responseViewer === "audio" || responseViewer === "video" || responseViewer === "pdf"
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ...metadata,
      ...(responseContentType ? { mimeType: responseContentType } : {}),
      viewer: responseViewer,
      content: new TextDecoder().decode(bytes),
      encoding: "utf8",
      truncated: response.status === 206 || bytes.byteLength >= readLimit,
      bytesRead: bytes.byteLength
    };
  }

  async readOriginal(path: string): Promise<{ body: Uint8Array; metadata: FileMetadata }> {
    const metadata = await this.getRequiredMetadata(path);
    if (metadata.isFolder) {
      throw new Error("Cannot open a folder as a file.");
    }

    const target = resolveSandboxPath(this.credentials.rootPath, path);
    const response = await this.request(target, { method: "GET" });
    return {
      body: new Uint8Array(await response.arrayBuffer()),
      metadata
    };
  }

  async streamOriginal(path: string, rangeHeader?: string | null): Promise<{ response: Response; metadata: FileMetadata }> {
    const metadata = await this.getRequiredMetadata(path);
    if (metadata.isFolder) {
      throw new Error("Cannot open a folder as a file.");
    }

    const target = resolveSandboxPath(this.credentials.rootPath, path);
    const response = await this.request(
      target,
      {
        method: "GET",
        headers: {
          ...(rangeHeader ? { range: rangeHeader } : {})
        }
      },
      [416]
    );
    return { response, metadata };
  }

  async searchFiles(query: string, path = ""): Promise<SearchResult[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const queue: Array<{ path: string; depth: number }> = [{ path, depth: 0 }];
    const visited = new Set<string>();
    const results: SearchResult[] = [];

    while (queue.length > 0 && visited.size < 64 && results.length < 20) {
      const current = queue.shift();
      if (!current || visited.has(current.path)) {
        continue;
      }
      visited.add(current.path);

      const items = await this.listFolder(current.path);
      for (const item of items) {
        const score = scoreMatch(normalizedQuery, item.path, item.name);
        if (score > 0) {
          results.push({ ...item, score });
        }
        if (item.isFolder && current.depth < 3) {
          queue.push({ path: item.path, depth: current.depth + 1 });
        }
        if (results.length >= 20) {
          break;
        }
      }
    }

    return results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  }

  async download(path: string): Promise<{ body: Uint8Array; metadata: FileMetadata }> {
    return this.readOriginal(path);
  }

  async createFolder(request: CreateFolderRequest): Promise<MutationResult> {
    const parentPath = request.path;
    const fullTargetPath = resolveSandboxPath(this.credentials.rootPath, resolveSandboxPath(parentPath, request.name));
    const relativeTargetPath = stripSandboxRoot(this.credentials.rootPath, fullTargetPath);
    const response = await this.request(fullTargetPath, { method: "MKCOL" }, [405]);
    if (response.status === 405) {
      throw new Error("Folder already exists.");
    }
    return {
      action: "createFolder",
      parentPath,
      path: relativeTargetPath,
      item: await this.getMetadata(relativeTargetPath)
    };
  }

  async uploadFile(request: UploadFileRequest): Promise<MutationResult> {
    const fullTargetPath = resolveSandboxPath(this.credentials.rootPath, resolveSandboxPath(request.path, request.name));
    const relativeTargetPath = stripSandboxRoot(this.credentials.rootPath, fullTargetPath);
    const body = Buffer.from(request.contentBase64, "base64");
    await this.request(fullTargetPath, {
      method: "PUT",
      headers: {
        "content-type": request.mimeType?.trim() || "application/octet-stream"
      },
      body
    });
    return {
      action: "upload",
      parentPath: request.path,
      path: relativeTargetPath,
      item: await this.getMetadata(relativeTargetPath)
    };
  }

  async moveResource(request: MoveCopyRequest): Promise<MutationResult> {
    const sourceFullPath = resolveSandboxPath(this.credentials.rootPath, request.path);
    const destinationFullPath = resolveSandboxPath(this.credentials.rootPath, request.destinationPath);
    const sourcePath = stripSandboxRoot(this.credentials.rootPath, sourceFullPath);
    const destinationPath = stripSandboxRoot(this.credentials.rootPath, destinationFullPath);
    await this.request(sourceFullPath, {
      method: "MOVE",
      headers: {
        Destination: encodeDavPath(this.credentials.baseUrl, this.credentials.username, destinationFullPath),
        Overwrite: request.overwrite ? "T" : "F"
      }
    });
    return {
      action: "move",
      parentPath: dirname(destinationPath),
      path: sourcePath,
      destinationPath,
      item: await this.getMetadata(destinationPath)
    };
  }

  async copyResource(request: MoveCopyRequest): Promise<MutationResult> {
    const sourceFullPath = resolveSandboxPath(this.credentials.rootPath, request.path);
    const destinationFullPath = resolveSandboxPath(this.credentials.rootPath, request.destinationPath);
    const sourcePath = stripSandboxRoot(this.credentials.rootPath, sourceFullPath);
    const destinationPath = stripSandboxRoot(this.credentials.rootPath, destinationFullPath);
    await this.request(sourceFullPath, {
      method: "COPY",
      headers: {
        Destination: encodeDavPath(this.credentials.baseUrl, this.credentials.username, destinationFullPath),
        Overwrite: request.overwrite ? "T" : "F"
      }
    });
    return {
      action: "copy",
      parentPath: dirname(destinationPath),
      path: sourcePath,
      destinationPath,
      item: await this.getMetadata(destinationPath)
    };
  }

  async deleteResource(request: DeleteRequest): Promise<MutationResult> {
    ensureDeleteConfirmation(request.path, request.confirmName);
    const fullTargetPath = resolveSandboxPath(this.credentials.rootPath, request.path);
    const targetPath = stripSandboxRoot(this.credentials.rootPath, fullTargetPath);
    await this.request(fullTargetPath, { method: "DELETE" });
    return {
      action: "delete",
      parentPath: dirname(targetPath),
      path: targetPath
    };
  }
}
