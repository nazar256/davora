import { z } from "zod";

import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EndpointContract } from "./endpoint";

export const diagnosticReportMetadataSchema = z.strictObject({
  reportId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime({ offset: true }),
  diagnosticsSchema: z.number().int().positive(),
  webBuild: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)
});

export type DiagnosticReportMetadata = z.infer<typeof diagnosticReportMetadataSchema>;

export const diagnosticReportReceiptSchema = z.strictObject({
  reportId: z.string().uuid(),
  acceptedAt: z.string().datetime({ offset: true }),
  expiresAfterDays: z.literal(30),
  duplicate: z.boolean()
});

export type DiagnosticReportReceipt = z.infer<typeof diagnosticReportReceiptSchema>;

export const diagnosticReportEndpoint = {
  id: "diagnosticReport",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/diagnostic-reports",
  auth: "session",
  responseKind: "json",
  requestSchema: diagnosticReportMetadataSchema,
  successSchema: apiEnvelopeSchema(diagnosticReportReceiptSchema),
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract;
