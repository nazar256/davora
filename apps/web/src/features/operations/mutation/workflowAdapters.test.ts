import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../../lib/api";
import { createOperationContextToken } from "../policy";
import {
  executeBatchMutationTarget,
  mapFolderLoadResult,
  mapMutationExecutionError
} from "./workflowAdapters";
import {
  isMutationReconnectRequired,
  isMutationSessionTerminated,
  isMutationUnauthorized
} from "./sessionErrors";

describe("mutation workflow adapters", () => {
  it("classifies unauthorized and reconnect-required session errors", () => {
    expect(isMutationUnauthorized(new ApiRequestError("expired", 401))).toBe(true);
    expect(isMutationReconnectRequired(new ApiRequestError("reconnect", 403, "account_reconnect_required"))).toBe(true);
    expect(isMutationSessionTerminated(new ApiRequestError("reconnect", 403, "account_reconnect_required"))).toBe(true);
    expect(isMutationSessionTerminated(new Error("other"))).toBe(false);
  });

  it("maps folder refresh results", () => {
    expect(mapFolderLoadResult(undefined)).toEqual({ kind: "completed" });
    expect(mapFolderLoadResult("session-terminated")).toEqual({ kind: "sessionTerminated" });
  });

  it("maps mutation execution errors", () => {
    expect(mapMutationExecutionError(new ApiRequestError("expired", 401), "fallback"))
      .toEqual({ kind: "sessionTerminated" });
    expect(mapMutationExecutionError(new Error("boom"), "fallback"))
      .toEqual({ kind: "failed", message: "boom" });
  });

  it("returns sessionTerminated without executing when session is missing", async () => {
    const execute = vi.fn();
    await expect(executeBatchMutationTarget(
      false,
      { execute },
      async () => ({ action: "delete", parentPath: "", path: "a.txt" }),
      createOperationContextToken(),
      { kind: "delete", count: 1 },
      "fallback"
    )).resolves.toEqual({ kind: "sessionTerminated" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns completed when batch mutation execution succeeds", async () => {
    const execute = vi.fn(async () => ({ action: "delete" as const, parentPath: "", path: "a.txt" }));
    await expect(executeBatchMutationTarget(
      true,
      { execute },
      async () => ({ action: "delete" as const, parentPath: "", path: "a.txt" }),
      createOperationContextToken(),
      { kind: "delete", count: 1 },
      "fallback"
    )).resolves.toEqual({ kind: "completed" });
    expect(execute).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      manageBusy: false,
      refreshFolder: false,
      syncSelection: false,
      successStatus: false
    }));
  });
});
