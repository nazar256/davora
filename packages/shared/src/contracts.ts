export type BackendKind = "mock" | "nextcloud";
export type AccountType = "nextcloud";
export type AccountConnectionMode = "in_app";
export type AccountConnectionState = "connected" | "reconnect_required";
export type ViewerKind = "text" | "markdown" | "image" | "audio" | "video" | "pdf" | "unsupported";
export type CacheState = "fresh" | "stale";
export type MutationAction = "createFolder" | "upload" | "move" | "copy" | "delete";

export interface CapabilitySet {
  backend: BackendKind;
  readOnly: boolean;
  search: boolean;
  preview: boolean;
  download: boolean;
  offlineCache: boolean;
  createFolder: boolean;
  upload: boolean;
  move: boolean;
  copy: boolean;
  delete: boolean;
  mediaPreview: boolean;
  markdownPreview: boolean;
  openedFileCache: boolean;
}

export interface ConnectedAccount {
  id: string;
  type: AccountType;
  label?: string;
  displayName: string;
  baseUrl: string;
  username: string;
  rootPath: string;
  backend: BackendKind;
  connectionState: AccountConnectionState;
  lastValidatedAt: string;
  cacheNamespace: string;
}

export interface AppSession {
  token: string;
  expiresAt: string;
  rootPath: string;
  capabilities: CapabilitySet;
  account: ConnectedAccount;
}

export interface ApiError {
  code: string;
  message: string;
  details?: string;
}

export interface FileEntry {
  path: string;
  name: string;
  isFolder: boolean;
  size?: number;
  mimeType?: string;
  lastModified?: string;
  etag?: string;
}

export interface FileMetadata extends FileEntry {
  permissions?: string;
  ownerDisplayName?: string;
}

export interface FilePreview extends FileMetadata {
  viewer: ViewerKind;
  content: string;
  encoding: "utf8" | "none";
  truncated: boolean;
  bytesRead: number;
  unsupportedReason?: string;
  requiresOriginalBlob?: boolean;
}

export interface SearchResult extends FileEntry {
  score: number;
}

export interface MutationResult {
  action: MutationAction;
  parentPath: string;
  path: string;
  destinationPath?: string;
  item?: FileMetadata;
}

export interface HealthResponse {
  app: "davora";
  configLoaded: boolean;
  backend: BackendKind;
  rootPath: string;
  unlockRequired: boolean;
  connectionMode: AccountConnectionMode;
  supportedAccountTypes: AccountType[];
  missing?: string[];
}

export interface ConnectNextcloudAccountRequest {
  accountId?: string;
  cacheNamespace?: string;
  type: "nextcloud";
  baseUrl: string;
  username: string;
  appPassword: string;
  rootPath?: string;
  label?: string;
}

export type ConnectAccountRequest = ConnectNextcloudAccountRequest;

export interface ConnectAccountResponse {
  account: ConnectedAccount;
}

export interface SessionRequest {
  accountId: string;
  unlockCode?: string;
}

export interface SessionResponse {
  session: AppSession;
}

export interface FilesResponse {
  path: string;
  items: FileEntry[];
}

export interface MetadataResponse {
  metadata: FileMetadata;
}

export interface FileResponse {
  file: FilePreview;
}

export interface SearchResponse {
  query: string;
  path: string;
  items: SearchResult[];
}

export interface CreateFolderRequest {
  path: string;
  name: string;
}

export interface UploadFileRequest {
  path: string;
  name: string;
  mimeType?: string;
  contentBase64: string;
}

export interface MoveCopyRequest {
  path: string;
  destinationPath: string;
  overwrite?: boolean;
}

export interface DeleteRequest {
  path: string;
  confirmName: string;
}

export interface MutationResponse {
  result: MutationResult;
}

export interface ApiEnvelope<T> {
  data: T;
}
