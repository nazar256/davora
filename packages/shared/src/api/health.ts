import { z } from "zod";

import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";

export const healthResponseSchema = z.strictObject({
  app: z.literal("davora"),
  configLoaded: z.boolean(),
  backend: z.enum(["mock", "nextcloud"]),
  rootPath: z.string(),
  unlockRequired: z.boolean(),
  connectionMode: z.literal("in_app"),
  supportedAccountTypes: z.array(z.literal("nextcloud")),
  missing: z.array(z.string()).optional()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthSuccessSchema = apiEnvelopeSchema(healthResponseSchema);

export const healthEndpoint = {
  id: "health",
  method: "GET",
  canonicalMethod: "GET",
  matchPolicy: "path-only",
  path: "/api/health",
  auth: "public",
  responseKind: "json",
  requestSchema: z.undefined(),
  successSchema: healthSuccessSchema,
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
