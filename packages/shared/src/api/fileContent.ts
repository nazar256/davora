import { z } from "zod";

import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";
import { fileEntrySchema, normalizedPathSchema } from "./files";

export const filePathRequestSchema = z.strictObject({ path: normalizedPathSchema });
export type FilePathRequest = z.infer<typeof filePathRequestSchema>;

export const metadataResponseSchema = z.strictObject({
  metadata: fileEntrySchema
});
export type MetadataEndpointResponse = z.infer<typeof metadataResponseSchema>;

export const metadataEndpoint = {
  id: "metadata",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/metadata",
  auth: "session",
  responseKind: "json",
  requestSchema: filePathRequestSchema,
  successSchema: apiEnvelopeSchema(metadataResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;

export const filePreviewSchema = z.strictObject({
  ...fileEntrySchema.shape,
  viewer: z.enum(["text", "markdown", "image", "audio", "video", "pdf", "unsupported"]),
  content: z.string(),
  encoding: z.enum(["utf8", "none"]),
  truncated: z.boolean(),
  bytesRead: z.number().nonnegative(),
  unsupportedReason: z.string().optional(),
  requiresOriginalBlob: z.boolean().optional()
});

export const previewResponseSchema = z.strictObject({ file: filePreviewSchema });
export type PreviewResponse = z.infer<typeof previewResponseSchema>;

export const previewEndpoint = {
  id: "preview",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/file",
  auth: "session",
  responseKind: "json",
  requestSchema: filePathRequestSchema,
  successSchema: apiEnvelopeSchema(previewResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;

export const streamTokenResponseSchema = z.strictObject({
  token: z.string().min(1),
  path: normalizedPathSchema,
  expiresAt: z.string().datetime()
});
export type StreamTokenEndpointResponse = z.infer<typeof streamTokenResponseSchema>;

export const streamTokenEndpoint = {
  id: "streamToken",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/file/stream-token",
  auth: "session",
  responseKind: "json",
  requestSchema: filePathRequestSchema,
  successSchema: apiEnvelopeSchema(streamTokenResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
