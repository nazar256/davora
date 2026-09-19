import { z } from "zod";

import { connectedAccountSchema } from "../accountSchemas";
import { apiEnvelopeSchema, apiErrorEnvelopeSchema, type EmptyEndpointContract, type EndpointContract } from "./endpoint";

// The legacy Worker ignored unknown request fields after its TypeScript cast.
// Strip them at the contract boundary while keeping the accepted public fields typed.
export const connectAccountRequestSchema = z.object({
  type: z.literal("nextcloud"),
  accountId: z.string().optional(),
  cacheNamespace: z.string().optional(),
  baseUrl: z.string(),
  username: z.string(),
  appPassword: z.string(),
  rootPath: z.string().optional(),
  label: z.string().optional()
});

export type ConnectAccountRequest = z.infer<typeof connectAccountRequestSchema>;

export const connectAccountResponseSchema = z.strictObject({
  account: connectedAccountSchema
});

export type ConnectAccountResponse = z.infer<typeof connectAccountResponseSchema>;

export const connectAccountSuccessSchema = apiEnvelopeSchema(connectAccountResponseSchema);

export const connectAccountEndpoint = {
  id: "connect-account",
  method: "POST",
  canonicalMethod: "POST",
  matchPolicy: "method",
  path: "/api/accounts",
  auth: "browser",
  responseKind: "json",
  requestSchema: connectAccountRequestSchema,
  successSchema: connectAccountSuccessSchema,
  errorSchema: apiErrorEnvelopeSchema
} satisfies EndpointContract<typeof connectAccountRequestSchema, typeof connectAccountSuccessSchema>;

const accountIdSchema = z.string().min(1);

export const deleteAccountEndpoint = {
  id: "delete-account",
  method: "DELETE",
  canonicalMethod: "DELETE",
  matchPolicy: "method",
  path: "/api/accounts",
  auth: "browser",
  responseKind: "empty",
  requestSchema: z.undefined(),
  errorSchema: apiErrorEnvelopeSchema,
  buildPath(accountId: string): string {
    return `${this.path}/${encodeURIComponent(accountId)}`;
  },
  parsePath(pathname: string): string | undefined {
    const prefix = `${this.path}/`;
    if (!pathname.startsWith(prefix) || pathname.length === prefix.length || pathname.slice(prefix.length).includes("/")) {
      return undefined;
    }
    try {
      const accountId = decodeURIComponent(pathname.slice(prefix.length));
      return accountIdSchema.safeParse(accountId).success ? accountId : undefined;
    } catch {
      return undefined;
    }
  }
} satisfies EmptyEndpointContract;
