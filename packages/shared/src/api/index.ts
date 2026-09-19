export * from "./delete";
export * from "./endpoint";
export * from "./accounts";
export * from "./session";
export * from "./fileBinary";
export * from "./fileContent";
export * from "./files";
export * from "./folderUpload";
export * from "./health";
export * from "./moveCopy";
export * from "./search";

import { deleteEndpoint } from "./delete";
import { connectAccountEndpoint, deleteAccountEndpoint } from "./accounts";
import { filesEndpoint } from "./files";
import { createFolderEndpoint, uploadEndpoint } from "./folderUpload";
import { healthEndpoint } from "./health";
import { copyEndpoint, moveEndpoint } from "./moveCopy";
import { searchEndpoint } from "./search";
import { metadataEndpoint, previewEndpoint, streamTokenEndpoint } from "./fileContent";
import { downloadEndpoint, originalEndpoint, streamEndpoint } from "./fileBinary";
import { sessionEndpoint } from "./session";

export const apiEndpoints = {
  connectAccount: connectAccountEndpoint,
  copy: copyEndpoint,
  createFolder: createFolderEndpoint,
  delete: deleteEndpoint,
  deleteAccount: deleteAccountEndpoint,
  files: filesEndpoint,
  metadata: metadataEndpoint,
  preview: previewEndpoint,
  original: originalEndpoint,
  streamToken: streamTokenEndpoint,
  stream: streamEndpoint,
  health: healthEndpoint,
  move: moveEndpoint,
  search: searchEndpoint,
  session: sessionEndpoint,
  download: downloadEndpoint,
  upload: uploadEndpoint
} as const;
