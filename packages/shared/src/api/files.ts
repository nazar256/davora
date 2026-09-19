import { z } from "zod";

import { parseNormalizedPath } from "../paths";
import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";

export const normalizedPathSchema = z.string().refine((path) => {
  try {
    return parseNormalizedPath(path) === path;
  } catch {
    return false;
  }
}, "Path must be canonical and normalized.");

export const fileEntrySchema = z.strictObject({
  path: normalizedPathSchema,
  name: z.string(),
  isFolder: z.boolean(),
  size: z.number().nonnegative().optional(),
  mimeType: z.string().optional(),
  lastModified: z.string().optional(),
  etag: z.string().optional(),
  permissions: z.string().optional(),
  ownerDisplayName: z.string().optional()
});

export type FileEntry = z.infer<typeof fileEntrySchema>;

export const filesResponseSchema = z.strictObject({
  path: normalizedPathSchema,
  items: z.array(fileEntrySchema)
});

export type FilesResponse = z.infer<typeof filesResponseSchema>;

export const filesSuccessSchema = apiEnvelopeSchema(filesResponseSchema);

export const filesEndpoint = {
  id: "files",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/files",
  auth: "session",
  responseKind: "json",
  requestSchema: z.strictObject({ path: normalizedPathSchema }),
  successSchema: filesSuccessSchema,
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
