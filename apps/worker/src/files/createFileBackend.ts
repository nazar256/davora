import { NextcloudClient } from "../nextcloud/client";
import type { AuthorizedAccountContext, WorkerEnv } from "../types";
import type { FileBackend } from "./backend";
import { MockFileBackend } from "./mockFileBackend";
import { NextcloudFileBackend } from "./nextcloudFileBackend";
import { createNextcloudDestinationPolicy } from "../security/nextcloudDestinationPolicy";

export function createFileBackend(context: AuthorizedAccountContext, env: WorkerEnv): FileBackend {
  if (context.account.backend === "mock") {
    return new MockFileBackend(context.account.id);
  }
  if (!context.credentials) {
    throw new Error("Reconnect this account before browsing files.");
  }
  const destinationPolicy = createNextcloudDestinationPolicy({
    runtimeMode: env.RUNTIME_MODE,
    allowLocalNextcloud: env.ALLOW_LOCAL_NEXTCLOUD,
    allowedHosts: env.NEXTCLOUD_ALLOWED_HOSTS,
    allowAnyHost: env.RUNTIME_MODE === "production" && env.NEXTCLOUD_ALLOWED_HOSTS.length === 0
  });
  return new NextcloudFileBackend(new NextcloudClient({
    baseUrl: context.credentials.baseUrl,
    username: context.credentials.username,
    appPassword: context.credentials.appPassword,
    rootPath: context.account.rootPath,
    maxFileBytes: env.NEXTCLOUD_MAX_FILE_BYTES,
    maxTextFileBytes: env.NEXTCLOUD_MAX_TEXT_FILE_BYTES
  }, undefined, destinationPolicy));
}
