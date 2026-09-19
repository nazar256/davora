import type { CreateFolderRequestInput, DeleteRequestInput, FileMetadata, MoveCopyRequestInput, UploadRequestInput } from "@davora/shared";

import { NextcloudClient } from "../nextcloud/client";
import type { FileBackend, DownloadContent, OriginalFileContent, RangedFileContent } from "./backend";
import { normalizeFileBackendCall } from "./fileBackendError";

function contentMetadata(metadata: FileMetadata, contentType: string | null): FileMetadata {
  return contentType ? { ...metadata, mimeType: contentType } : metadata;
}

export class NextcloudFileBackend implements FileBackend {
  constructor(private readonly client: NextcloudClient) {}

  list(path: string) {
    return normalizeFileBackendCall(() => this.client.listFolder(path));
  }

  metadata(path: string) {
    return normalizeFileBackendCall(() => this.client.getMetadata(path));
  }

  preview(path: string) {
    return normalizeFileBackendCall(() => this.client.readFile(path));
  }

  original(path: string): Promise<OriginalFileContent> {
    return normalizeFileBackendCall(() => this.client.readOriginal(path));
  }

  async stream(path: string, range: string | null): Promise<RangedFileContent> {
    const { response, metadata } = await normalizeFileBackendCall(() => this.client.streamOriginal(path, range));
    const contentType = response.headers.get("content-type");
    const contentLengthHeader = response.headers.get("content-length");
    return {
      body: response.body ?? new Uint8Array(),
      metadata: contentMetadata(metadata, contentType),
      status: response.status,
      ...(response.headers.get("content-range") ? { contentRange: response.headers.get("content-range")! } : {}),
      ...(contentType ? { contentType } : {}),
      ...(contentLengthHeader ? { contentLength: Number(contentLengthHeader) } : {})
    };
  }

  search(path: string, query: string) {
    return normalizeFileBackendCall(() => this.client.searchFiles(query, path));
  }

  async download(path: string): Promise<DownloadContent> {
    const file = await normalizeFileBackendCall(() => this.client.download(path));
    return {
      body: file.body,
      filename: file.metadata.name,
      mimeType: file.metadata.mimeType ?? "application/octet-stream"
    };
  }

  createFolder(input: CreateFolderRequestInput) {
    return normalizeFileBackendCall(() => this.client.createFolder(input));
  }

  upload(input: UploadRequestInput) {
    return normalizeFileBackendCall(() => this.client.uploadFile(input));
  }

  move(input: MoveCopyRequestInput) {
    return normalizeFileBackendCall(() => this.client.moveResource(input));
  }

  copy(input: MoveCopyRequestInput) {
    return normalizeFileBackendCall(() => this.client.copyResource(input));
  }

  delete(input: DeleteRequestInput) {
    return normalizeFileBackendCall(() => this.client.deleteResource(input));
  }
}
