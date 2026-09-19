import { z } from "zod";

import { appSessionSchema } from "../accountSchemas";
import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";

// Preserve the legacy cast behavior for harmless unknown request fields.
export const sessionRequestSchema = z.object({
  accountId: z.string().min(1),
  unlockCode: z.string().optional()
});

export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export const sessionResponseSchema = z.strictObject({
  session: appSessionSchema
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const sessionSuccessSchema = apiEnvelopeSchema(sessionResponseSchema);

export const sessionEndpoint = {
  id: "session",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/session",
  auth: "browser",
  responseKind: "json",
  requestSchema: sessionRequestSchema,
  successSchema: sessionSuccessSchema,
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract<typeof sessionRequestSchema, typeof sessionSuccessSchema>;
