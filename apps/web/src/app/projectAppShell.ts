import type { AppShellCommonBindings, AppShellProps } from "./AppShell";

export type AppBootstrapBindings = Extract<AppShellProps, { readonly kind: "bootstrap" }>["bootstrap"];
export type AppWorkspaceStatusBindings = Extract<AppShellProps, { readonly kind: "workspace" }>["status"];
export type AppWorkspaceBindings = Extract<AppShellProps, { readonly kind: "workspace" }>["workspace"];
export type AppWorkspaceOverlayBindings = Extract<AppShellProps, { readonly kind: "workspace" }>["overlays"];

export interface AppShellProjectionInput {
  readonly common: AppShellCommonBindings;
  readonly bootstrap: AppBootstrapBindings;
  readonly status: AppWorkspaceStatusBindings;
  readonly workspace: AppWorkspaceBindings;
  readonly overlays: AppWorkspaceOverlayBindings;
}

export function projectAppShell(input: AppShellProjectionInput): AppShellProps {
  if (input.bootstrap.gate.kind !== "continue") {
    return {
      kind: "bootstrap",
      common: input.common,
      bootstrap: input.bootstrap
    };
  }

  return {
    kind: "workspace",
    common: input.common,
    status: input.status,
    workspace: input.workspace,
    overlays: input.overlays
  };
}
