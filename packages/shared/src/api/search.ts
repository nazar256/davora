import { z } from "zod";

import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";
import { fileEntrySchema, normalizedPathSchema } from "./files";

export const searchResultSchema = z.strictObject({
  ...fileEntrySchema.shape,
  score: z.number()
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.strictObject({
  completeness: z.enum(["complete", "partial"]),
  query: z.string(),
  path: normalizedPathSchema,
  items: z.array(searchResultSchema)
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const legacySearchSuccessSchema = apiEnvelopeSchema(searchResponseSchema.omit({ completeness: true }));

export const searchRequestSchema = z.strictObject({
  path: normalizedPathSchema,
  query: z.string(),
  coverage: z.literal("bounded-v1").optional()
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const searchEndpoint = {
  id: "search",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/search",
  auth: "session",
  responseKind: "json",
  requestSchema: searchRequestSchema,
  successSchema: apiEnvelopeSchema(searchResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
