import { z } from "zod";

import { dirname } from "../paths";
import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";
import { normalizedPathSchema } from "./files";

export const deletePathSchema = normalizedPathSchema.refine((path) => path.length > 0, "The account root cannot be deleted.");

export const deleteRequestSchema = z.strictObject({
  path: deletePathSchema,
  confirmName: z.string()
});

export type DeleteRequestInput = z.infer<typeof deleteRequestSchema>;

export const deleteResponseSchema = z.strictObject({
  result: z.strictObject({
    action: z.literal("delete"),
    parentPath: normalizedPathSchema,
    path: normalizedPathSchema
  })
});

export type DeleteResponseData = z.infer<typeof deleteResponseSchema>;

export function assertDeleteResponseIdentity(
  request: DeleteRequestInput,
  response: DeleteResponseData
): DeleteResponseData {
  if (response.result.path !== request.path || response.result.parentPath !== dirname(request.path)) {
    throw new Error("Delete response identity does not match its request.");
  }
  return response;
}

export const deleteEndpoint = {
  id: "delete",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/delete",
  auth: "session",
  responseKind: "json",
  requestSchema: deleteRequestSchema,
  successSchema: apiEnvelopeSchema(deleteResponseSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
