import { apiErrorEnvelopeSchema, type BinaryEndpointContract } from "./endpoint";
import { filePathRequestSchema } from "./fileContent";

export const originalEndpoint = {
  id: "original",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/file/original",
  auth: "session",
  responseKind: "binary",
  requestSchema: filePathRequestSchema,
  errorSchema: apiErrorEnvelopeSchema
} satisfies BinaryEndpointContract;

export const streamEndpoint = {
  id: "stream",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/file/stream",
  auth: "session",
  responseKind: "binary",
  requestSchema: filePathRequestSchema,
  errorSchema: apiErrorEnvelopeSchema
} satisfies BinaryEndpointContract;

export const downloadEndpoint = {
  id: "download",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/download",
  auth: "session",
  responseKind: "binary",
  requestSchema: filePathRequestSchema,
  errorSchema: apiErrorEnvelopeSchema
} satisfies BinaryEndpointContract;
