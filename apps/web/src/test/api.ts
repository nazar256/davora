import type { HealthResponse } from "@davora/shared";

export const buildHealthResponse = (
  overrides: Partial<HealthResponse> = {}
): HealthResponse => ({
  app: "davora",
  configLoaded: true,
  backend: "mock",
  rootPath: ".davora-agent-test",
  unlockRequired: false,
  connectionMode: "in_app",
  supportedAccountTypes: ["nextcloud"],
  ...overrides
});
