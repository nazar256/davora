import type { CreateFolderRequestInput, DeleteRequestInput, MoveCopyRequestInput, UploadRequestInput } from "@davora/shared";
import type { FileBackend, DownloadContent, OriginalFileContent, RangedFileContent } from "./backend";
import {
  copyMockResource,
  createMockFolder,
  deleteMockResource,
  downloadMockFile,
  getMockMetadata,
  getMockOriginal,
  getMockOriginalRange,
  listMockFolder,
  moveMockResource,
  readMockFile,
  uploadMockFile
} from "../mock/data";
import { boundedSearch } from "./boundedSearch";
import { normalizeFileBackendCall } from "./fileBackendError";

export class MockFileBackend implements FileBackend {
  constructor(private readonly accountId: string) {}

  list(path: string) {
    return normalizeFileBackendCall(() => Promise.resolve(listMockFolder(this.accountId, path)));
  }

  metadata(path: string) {
    return normalizeFileBackendCall(() => Promise.resolve(getMockMetadata(this.accountId, path)));
  }

  preview(path: string) {
    return normalizeFileBackendCall(() => Promise.resolve(readMockFile(this.accountId, path)));
  }

  original(path: string): Promise<OriginalFileContent | undefined> {
    return normalizeFileBackendCall(() => Promise.resolve(getMockOriginal(this.accountId, path)));
  }

  stream(path: string, range: string | null): Promise<RangedFileContent | undefined> {
    const content = getMockOriginalRange(this.accountId, path, range);
    return normalizeFileBackendCall(() => Promise.resolve(content ? { ...content, contentLength: content.body.byteLength } : undefined));
  }

  search(path: string, query: string) {
    return normalizeFileBackendCall(() => boundedSearch(path, query, (folderPath) => this.list(folderPath)));
  }

  download(path: string): Promise<DownloadContent | undefined> {
    const content = downloadMockFile(this.accountId, path);
    return normalizeFileBackendCall(() => Promise.resolve(content));
  }

  createFolder(input: CreateFolderRequestInput) {
    return normalizeFileBackendCall(() => Promise.resolve(createMockFolder(this.accountId, input.path, input.name)));
  }

  upload(input: UploadRequestInput) {
    return normalizeFileBackendCall(() => Promise.resolve(uploadMockFile(this.accountId, input)));
  }

  move(input: MoveCopyRequestInput) {
    return normalizeFileBackendCall(() => Promise.resolve(moveMockResource(this.accountId, input)));
  }

  copy(input: MoveCopyRequestInput) {
    return normalizeFileBackendCall(() => Promise.resolve(copyMockResource(this.accountId, input)));
  }

  delete(input: DeleteRequestInput) {
    return normalizeFileBackendCall(() => Promise.resolve(deleteMockResource(this.accountId, input)));
  }
}
