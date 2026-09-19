import { resolve } from "node:path";

export interface RealValidationWorkerEnvironmentInput {
  readonly baseEnvironment: NodeJS.ProcessEnv;
  readonly repoRoot: string;
  readonly processId: number;
  readonly runId: string;
  readonly workerPort: number;
  readonly sessionSecret: string;
  readonly rootPath: string;
  readonly unlockCode: string | undefined;
}

export function buildRealValidationWorkerEnvironment(
  input: RealValidationWorkerEnvironmentInput
): NodeJS.ProcessEnv {
  if (!Number.isSafeInteger(input.processId) || input.processId < 1) {
    throw new Error("Real validation process id must be a positive integer.");
  }
  if (!/^[A-Za-z0-9-]+$/.test(input.runId)) {
    throw new Error("Real validation run id contains unsafe path characters.");
  }

  const {
    ALLOWED_ORIGINS: _allowedOrigins,
    APP_UNLOCK_CODE: _appUnlockCode,
    LOCAL_DEV_STATE_PATH: _localDevStatePath,
    MOCK_BACKEND: _mockBackend,
    NEXTCLOUD_ROOT_PATH: _nextcloudRootPath,
    PORT: _port,
    SESSION_SECRET: _sessionSecret,
    ...baseEnvironment
  } = input.baseEnvironment;

  return {
    ...baseEnvironment,
    PORT: String(input.workerPort),
    SESSION_SECRET: input.sessionSecret,
    MOCK_BACKEND: "false",
    ALLOWED_ORIGINS: "http://127.0.0.1:4173",
    NEXTCLOUD_ROOT_PATH: input.rootPath,
    LOCAL_DEV_STATE_PATH: resolve(
      input.repoRoot,
      ".tmp/real-validation",
      `worker-state-${input.processId}-${input.runId}.json`
    ),
    ...(input.unlockCode ? { APP_UNLOCK_CODE: input.unlockCode } : {})
  };
}
