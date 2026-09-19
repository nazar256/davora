import { z } from "zod";

const isFiniteCalendarDateTime = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const parts = [Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second)];
  const candidate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  return Number.isFinite(candidate.getTime())
    && candidate.getUTCFullYear() === parts[0]
    && candidate.getUTCMonth() === parts[1] - 1
    && candidate.getUTCDate() === parts[2]
    && candidate.getUTCHours() === parts[3]
    && candidate.getUTCMinutes() === parts[4]
    && candidate.getUTCSeconds() === parts[5];
};

export const safeHttpBaseUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}, "Expected an absolute HTTP(S) URL without credentials, query, or fragment.");

export const finiteDateTimeSchema = z.string().datetime({ offset: true }).refine(isFiniteCalendarDateTime, "Expected a valid calendar timestamp.");

export const capabilitySetSchema = z.strictObject({
  backend: z.enum(["mock", "nextcloud"]),
  readOnly: z.boolean(),
  search: z.boolean(),
  preview: z.boolean(),
  download: z.boolean(),
  offlineCache: z.boolean(),
  createFolder: z.boolean(),
  upload: z.boolean(),
  move: z.boolean(),
  copy: z.boolean(),
  delete: z.boolean(),
  mediaPreview: z.boolean(),
  markdownPreview: z.boolean(),
  openedFileCache: z.boolean()
});

export const connectedAccountSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal("nextcloud"),
  label: z.string().optional(),
  displayName: z.string().min(1),
  baseUrl: safeHttpBaseUrlSchema,
  username: z.string().min(1),
  rootPath: z.string(),
  backend: z.enum(["mock", "nextcloud"]),
  connectionState: z.enum(["connected", "reconnect_required"]),
  lastValidatedAt: finiteDateTimeSchema,
  cacheNamespace: z.string().min(1)
});

export const appSessionSchema = z.strictObject({
  token: z.string().min(1),
  expiresAt: finiteDateTimeSchema,
  rootPath: z.string(),
  capabilities: capabilitySetSchema,
  account: connectedAccountSchema
});
