import type {
  CreateFolderRequestInput,
  DeleteRequestInput,
  FileEntry,
  FileMetadata,
  FilePreview,
  MoveCopyRequestInput,
  MutationResult,
  SearchResult,
  UploadRequestInput
} from "@davora/shared";

export interface SearchListingResult {
  readonly items: SearchResult[];
  readonly completeness: "complete" | "partial";
}

export interface OriginalFileContent {
  body: Uint8Array;
  metadata: FileMetadata;
}

export type FileBody = Uint8Array | ReadableStream<Uint8Array>;

export interface RangedFileContent {
  body: FileBody;
  metadata: FileMetadata;
  status: number;
  contentRange?: string;
  contentType?: string;
  contentLength?: number;
}

export interface DownloadContent {
  body: Uint8Array;
  filename: string;
  mimeType: string;
}

export type FolderListResult = {
  readonly items: readonly FileEntry[];
  readonly completeness: "complete" | "partial";
};

export interface FileBackend {
  list(path: string): Promise<FolderListResult>;
  metadata(path: string): Promise<FileMetadata | undefined>;
  preview(path: string): Promise<FilePreview | undefined>;
  original(path: string): Promise<OriginalFileContent | undefined>;
  stream(path: string, range: string | null): Promise<RangedFileContent | undefined>;
  search(path: string, query: string): Promise<SearchListingResult>;
  download(path: string): Promise<DownloadContent | undefined>;
  createFolder(input: CreateFolderRequestInput): Promise<MutationResult>;
  upload(input: UploadRequestInput): Promise<MutationResult>;
  move(input: MoveCopyRequestInput): Promise<MutationResult>;
  copy(input: MoveCopyRequestInput): Promise<MutationResult>;
  delete(input: DeleteRequestInput): Promise<MutationResult>;
}
