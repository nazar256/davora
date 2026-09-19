import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRealValidationWorkerEnvironment } from "./real-validation-runtime";

describe("real validation Worker environment", () => {
  it("forces a unique project-local encrypted account store for the spawned Worker", () => {
    const environment = buildRealValidationWorkerEnvironment({
      baseEnvironment: {
        LOCAL_DEV_STATE_PATH: "/outside/project/state.json",
        MOCK_BACKEND: "true",
        NEXTCLOUD_ALLOWED_HOSTS: "cloud.example.com",
        UNRELATED_SETTING: "preserved"
      },
      repoRoot: "/workspace/davora",
      processId: 42,
      runId: "validation-run",
      workerPort: 8788,
      sessionSecret: "session-secret",
      rootPath: ".davora-agent-test",
      unlockCode: undefined
    });

    expect(environment).toMatchObject({
      PORT: "8788",
      SESSION_SECRET: "session-secret",
      MOCK_BACKEND: "false",
      ALLOWED_ORIGINS: "http://127.0.0.1:4173",
      NEXTCLOUD_ROOT_PATH: ".davora-agent-test",
      NEXTCLOUD_ALLOWED_HOSTS: "cloud.example.com",
      UNRELATED_SETTING: "preserved",
      LOCAL_DEV_STATE_PATH: resolve(
        "/workspace/davora",
        ".tmp/real-validation/worker-state-42-validation-run.json"
      )
    });
    expect(environment.APP_UNLOCK_CODE).toBeUndefined();
  });

  it("forwards the configured unlock code", () => {
    const environment = buildRealValidationWorkerEnvironment({
      baseEnvironment: {},
      repoRoot: "/workspace/davora",
      processId: 7,
      runId: "unlock-run",
      workerPort: 8788,
      sessionSecret: "session-secret",
      rootPath: ".davora-agent-test",
      unlockCode: "configured-unlock-code"
    });

    expect(environment.APP_UNLOCK_CODE).toBe("configured-unlock-code");
  });
});
