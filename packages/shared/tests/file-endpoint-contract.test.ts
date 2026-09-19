import { describe, expect, it } from "vitest";
import { apiEndpoints, apiErrorCodeSchema } from "../src/api";

describe("authorized file endpoint catalog", () => {
  it("declares every authorized file identity exactly once", () => {
    const ids = ["files", "metadata", "preview", "original", "streamToken", "stream", "search", "download", "createFolder", "upload", "move", "copy", "delete"];
    expect(ids.every((id) => id in apiEndpoints)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps read matching permissive and mutation matching method-specific", () => {
    expect(apiEndpoints.files.matchPolicy).toBe("path-only");
    expect(apiEndpoints.metadata.matchPolicy).toBe("path-only");
    expect(apiEndpoints.preview.matchPolicy).toBe("path-only");
    expect(apiEndpoints.original.matchPolicy).toBe("path-only");
    expect(apiEndpoints.stream.matchPolicy).toBe("path-only");
    expect(apiEndpoints.download.matchPolicy).toBe("path-only");
    for (const id of ["streamToken", "createFolder", "upload", "move", "copy", "delete"] as const) {
      expect(apiEndpoints[id].matchPolicy).toBe("method");
    }
  });

  it("separates binary descriptors from strict JSON success schemas", () => {
    expect(apiEndpoints.original.responseKind).toBe("binary");
    expect(apiEndpoints.stream.responseKind).toBe("binary");
    expect(apiEndpoints.download.responseKind).toBe("binary");
    expect(apiEndpoints.metadata.successSchema.safeParse({ data: { metadata: { path: "", name: "", isFolder: true } } }).success).toBe(true);
  });

  it("closes Worker error code coverage", () => {
    for (const code of ["invalid_request", "not_found", "conflict", "delete_confirmation_required", "permission_denied", "account_reconnect_required", "mutation_failed"] as const) {
      expect(apiErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(apiErrorCodeSchema.safeParse("invalid_response").success).toBe(false);
  });
});
