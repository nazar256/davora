import { z } from "zod";

import { dirname } from "../paths";
import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";
import { fileEntrySchema, normalizedPathSchema } from "./files";

export type MoveCopyOperation = "move" | "copy";

export const moveCopyRequestSchema = z.strictObject({
  path: normalizedPathSchema,
  destinationPath: normalizedPathSchema,
  overwrite: z.boolean().optional()
});

export type MoveCopyRequestInput = z.infer<typeof moveCopyRequestSchema>;

function moveCopyResponseSchema(operation: MoveCopyOperation) {
  return z.strictObject({
    result: z.strictObject({
      action: z.literal(operation),
      parentPath: normalizedPathSchema,
      path: normalizedPathSchema,
      destinationPath: normalizedPathSchema,
      item: fileEntrySchema.optional()
    })
  });
}

export const moveResponseSchema = moveCopyResponseSchema("move");
export const copyResponseSchema = moveCopyResponseSchema("copy");

export type MoveCopyResponseData = z.infer<typeof moveResponseSchema> | z.infer<typeof copyResponseSchema>;

export function assertMoveCopyResponseIdentity(
  operation: MoveCopyOperation,
  request: MoveCopyRequestInput,
  response: MoveCopyResponseData
): MoveCopyResponseData {
  const { result } = response;
  const identityMatches = result.action === operation
    && result.path === request.path
    && result.destinationPath === request.destinationPath
    && result.parentPath === dirname(request.destinationPath)
    && (!result.item || result.item.path === request.destinationPath);
  if (!identityMatches) {
    throw new Error("Move/copy response identity does not match its request.");
  }
  return response;
}

export const moveEndpoint = {
  id: "move",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/move",
  auth: "session",
  responseKind: "json",
  requestSchema: moveCopyRequestSchema,
  successSchema: apiEnvelopeSchema(moveResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;

export const copyEndpoint = {
  id: "copy",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/copy",
  auth: "session",
  responseKind: "json",
  requestSchema: moveCopyRequestSchema,
  successSchema: apiEnvelopeSchema(copyResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
