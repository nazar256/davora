import { describe, expect, it } from "vitest";

import { projectAppShell, type AppShellProjectionInput } from "./projectAppShell";

const mockedBindings = null!;

function input(gate: AppShellProjectionInput["bootstrap"]["gate"]): AppShellProjectionInput {
  return {
    common: {
      reloadPrompt: mockedBindings,
      appBar: mockedBindings,
      removeAccount: mockedBindings
    },
    bootstrap: { gate },
    status: mockedBindings,
    workspace: mockedBindings,
    overlays: mockedBindings
  };
}

describe("projectAppShell", () => {
  it.each([
    "unavailable",
    "healthChecking",
    "noAccounts",
    "connect",
    "reconnect",
    "unlock",
    "restore"
  ] as const)("projects the %s gate to the bootstrap shell without changing bindings", (kind) => {
    const source = input({ kind });
    const projection = projectAppShell(source);

    expect(projection.kind).toBe("bootstrap");
    if (projection.kind !== "bootstrap") {
      throw new Error("Expected bootstrap projection.");
    }
    expect(projection.common).toBe(source.common);
    expect(projection.bootstrap).toBe(source.bootstrap);
    expect(projection.bootstrap.gate).toBe(source.bootstrap.gate);
  });

  it("projects the continue gate to the workspace shell without changing bindings", () => {
    const source = input({ kind: "continue" });
    const projection = projectAppShell(source);

    expect(projection.kind).toBe("workspace");
    if (projection.kind !== "workspace") {
      throw new Error("Expected workspace projection.");
    }
    expect(projection.common).toBe(source.common);
    expect(projection.status).toBe(source.status);
    expect(projection.workspace).toBe(source.workspace);
    expect(projection.overlays).toBe(source.overlays);
  });
});
