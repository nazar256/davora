import { z } from "zod";

import { resolveSandboxPath } from "../paths";
import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";
import { fileEntrySchema, normalizedPathSchema } from "./files";

export const pathSegmentSchema = normalizedPathSchema.refine(
  (name) => name.length > 0 && !name.includes("/"),
  "Name must be one non-empty canonical path segment."
);

const canonicalBase64Schema = z.string().refine(
  (value) => /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
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
