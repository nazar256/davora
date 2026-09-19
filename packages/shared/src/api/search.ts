import { z } from "zod";

import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";
import { fileEntrySchema, normalizedPathSchema } from "./files";

export const searchResultSchema = z.strictObject({
  ...fileEntrySchema.shape,
  score: z.number()
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.strictObject({
  query: z.string(),
  path: normalizedPathSchema,
  items: z.array(searchResultSchema)
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const searchEndpoint = {
  id: "search",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/search",
  auth: "session",
  responseKind: "json",
  requestSchema: z.strictObject({ path: normalizedPathSchema, query: z.string() }),
  successSchema: apiEnvelopeSchema(searchResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
