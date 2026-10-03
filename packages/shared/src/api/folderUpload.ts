import { z } from "zod";

import { resolveSandboxPath } from "../paths";
import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";
import { fileEntrySchema, normalizedPathSchema } from "./files";

export const pathSegmentSchema = normalizedPathSchema.refine(
  (name) => name.length > 0 && !name.includes("/"),
  "Name must be one non-empty canonical path segment."
);

function isCanonicalBase64(value: string): boolean {
  const length = value.length;
  if (length % 4 !== 0) return false;

  let dataLength = length;
  let paddingLength = 0;
  if (length > 0 && value.charCodeAt(length - 1) === 61) {
    paddingLength = 1;
    dataLength -= 1;
    if (dataLength > 0 && value.charCodeAt(length - 2) === 61) {
      paddingLength = 2;
      dataLength -= 1;
    }
  }

  if (paddingLength === 1 && (dataLength < 3 || dataLength % 4 !== 3)) return false;
  if (paddingLength === 2 && (dataLength < 2 || dataLength % 4 !== 2)) return false;

  for (let index = 0; index < dataLength; index += 1) {
    const code = value.charCodeAt(index);
    const isUppercase = code >= 65 && code <= 90;
    const isLowercase = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (!isUppercase && !isLowercase && !isDigit && code !== 43 && code !== 47) return false;
  }
  return true;
}

const canonicalBase64Schema = z.string().refine(
  isCanonicalBase64,
  "Content must be canonical base64."
);

export const createFolderRequestSchema = z.strictObject({
  path: normalizedPathSchema,
  name: pathSegmentSchema
});
export type CreateFolderRequestInput = z.infer<typeof createFolderRequestSchema>;

const folderItemSchema = z.strictObject({ ...fileEntrySchema.shape, isFolder: z.literal(true) });
export const createFolderResponseSchema = z.strictObject({
  result: z.strictObject({
    action: z.literal("createFolder"),
    parentPath: normalizedPathSchema,
    path: normalizedPathSchema,
    item: folderItemSchema
  })
});
export type CreateFolderResponseData = z.infer<typeof createFolderResponseSchema>;

export function assertCreateFolderResponseIdentity(
  request: CreateFolderRequestInput,
  response: CreateFolderResponseData
): CreateFolderResponseData {
  const expectedPath = resolveSandboxPath(request.path, request.name);
  const { result } = response;
  if (result.parentPath !== request.path
    || result.path !== expectedPath
    || result.item.path !== expectedPath
    || result.item.name !== request.name) {
    throw new Error("Create-folder response identity does not match its request.");
  }
  return response;
}

export const uploadRequestSchema = z.strictObject({
  path: normalizedPathSchema,
  name: pathSegmentSchema,
  mimeType: z.string().optional(),
  contentBase64: canonicalBase64Schema
});
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

const uploadedItemSchema = z.strictObject({ ...fileEntrySchema.shape, isFolder: z.literal(false) });
export const uploadResponseSchema = z.strictObject({
  result: z.strictObject({
    action: z.literal("upload"),
    parentPath: normalizedPathSchema,
    path: normalizedPathSchema,
    item: uploadedItemSchema
  })
});
export type UploadResponseData = z.infer<typeof uploadResponseSchema>;

export function assertUploadResponseIdentity(
  request: UploadRequestInput,
  response: UploadResponseData
): UploadResponseData {
  const expectedPath = resolveSandboxPath(request.path, request.name);
  const { result } = response;
  if (result.parentPath !== request.path
    || result.path !== expectedPath
    || result.item.path !== expectedPath
    || result.item.name !== request.name) {
    throw new Error("Upload response identity does not match its request.");
  }
  return response;
}

export const createFolderEndpoint = {
  id: "createFolder",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/folders",
  auth: "session",
  responseKind: "json",
  requestSchema: createFolderRequestSchema,
  successSchema: apiEnvelopeSchema(createFolderResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;

export const uploadEndpoint = {
  id: "upload",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/upload",
  auth: "session",
  responseKind: "json",
  requestSchema: uploadRequestSchema,
  successSchema: apiEnvelopeSchema(uploadResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
