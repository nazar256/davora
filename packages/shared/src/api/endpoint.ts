import { z, type ZodType } from "zod";

export type EndpointMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type EndpointAuth = "public" | "browser" | "session";
export type EndpointMatchPolicy = "path-only" | "method";

export const apiErrorCodeSchema = z.enum([
  "invalid_request",
  "not_found",
  "conflict",
  "delete_confirmation_required",
  "permission_denied",
  "account_reconnect_required",
  "mutation_failed",
  "config_error",
  "local_state_error",
  "unsupported_account_type",
  "account_revoked",
  "internal_error",
  "account_validation_failed",
  "account_required",
  "invalid_unlock_code",
  "session_creation_failed",
  "session_mismatch",
  "unauthorized",
  "bad_request",
  "unexpected_error"
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

interface EndpointDescriptorBase {
  id: string;
  /** Canonical method clients should use. */
  method: EndpointMethod;
  canonicalMethod: EndpointMethod;
  /** Current runtime matching policy; path-only routes intentionally accept other methods. */
  matchPolicy: EndpointMatchPolicy;
  path: `/api/${string}`;
  auth: EndpointAuth;
  requestSchema: ZodType;
}

export interface JsonEndpointContract<
  RequestSchema extends ZodType = ZodType,
  SuccessSchema extends ZodType = ZodType,
  ErrorSchema extends ZodType = ZodType
> extends EndpointDescriptorBase {
  responseKind: "json";
  requestSchema: RequestSchema;
  successSchema: SuccessSchema;
  errorSchema: ErrorSchema;
}

export interface BinaryEndpointContract<
  RequestSchema extends ZodType = ZodType,
  ErrorSchema extends ZodType = ZodType
> extends EndpointDescriptorBase {
  responseKind: "binary";
  requestSchema: RequestSchema;
  errorSchema: ErrorSchema;
}

export type EndpointContract<
  RequestSchema extends ZodType = ZodType,
  SuccessSchema extends ZodType = ZodType,
  ErrorSchema extends ZodType = ZodType
> = JsonEndpointContract<RequestSchema, SuccessSchema, ErrorSchema> | EmptyEndpointContract<RequestSchema, ErrorSchema>;

export interface EmptyEndpointContract<
  RequestSchema extends ZodType = ZodType,
  ErrorSchema extends ZodType = ZodType
> extends EndpointDescriptorBase {
  responseKind: "empty";
  requestSchema: RequestSchema;
  errorSchema: ErrorSchema;
  readonly buildPath?: (value: string) => string;
  readonly parsePath?: (pathname: string) => string | undefined;
}

export const apiEnvelopeSchema = <Schema extends ZodType>(data: Schema) => z.strictObject({ data });

export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: z.string().optional()
});

export const apiErrorEnvelopeSchema = apiEnvelopeSchema(apiErrorSchema);
