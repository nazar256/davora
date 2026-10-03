import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import {
  App, appShellCapture, buildAccount, buildSession, createBrowserAppServices, dispatchAppBack, seedAccounts
} from "../../../test/appIntegrationHarness";
import { createFakeDiagnosticsRuntimePorts } from "../testing/fakes";

async function renderWorkspace() {
  const account = buildAccount("report-navigation");
  seedAccounts([{ account, session: buildSession(account) }], account.id);
  window.history.replaceState(null, "", `?path=Projects&account=${account.id}`);
  const services = createBrowserAppServices();
  render(<App services={{ ...services, diagnostics: createFakeDiagnosticsRuntimePorts() }} />);
  await screen.findByRole("button", { name: /Profile & settings/i });
  return window.location.href;
}

async function openReport() {
  fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
  const settings = screen.getByRole("dialog", { name: /Profile and settings/i });
  const logging = within(settings).getByLabelText("Diagnostic logging");
  if (logging instanceof HTMLInputElement && !logging.checked) fireEvent.click(logging);
  fireEvent.click(await within(settings).findByRole("button", { name: /Create bug report/i }));
  const report = await screen.findByRole("dialog", { name: /Report a bug/i });
  expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toEqual([report]);
  fireEvent.change(within(report).getByLabelText("Bug summary"), { target: { value: "Synthetic report" } });
  expect(within(report).getByLabelText("Bug summary")).toHaveValue("Synthetic report");
  await waitFor(() => expect(within(report).getByRole("button", { name: /Download report/i })).toBeEnabled());
  return report;
}

describe("Settings to diagnostics navigation", () => {
  it("keeps report creation unavailable while diagnostics are disabled", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = screen.getByRole("dialog", { name: /Profile and settings/i });
    expect(within(settings).getByLabelText("Diagnostic logging")).not.toBeChecked();
    expect(within(settings).queryByRole("button", { name: /Create bug report/i })).not.toBeInTheDocument();
  });

  it.each(["Cancel", "Escape", "Back"])("hands off Settings to the report and preserves account/path after %s and reopening", async (dismissal) => {
    const workspaceUrl = await renderWorkspace();
    const report = await openReport();
    if (dismissal === "Cancel") fireEvent.click(within(report).getByRole("button", { name: "Cancel" }));
    if (dismissal === "Escape") fireEvent.keyDown(report, { key: "Escape" });
    if (dismissal === "Back") act(() => dispatchAppBack("Projects"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.location.href).toBe(workspaceUrl);
    const reopened = await openReport();
    fireEvent.click(within(reopened).getByRole("button", { name: "Close bug report" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.location.href).toBe(workspaceUrl);
  });

  it("keeps the supplied report command usable when Settings is already closed", async () => {
    await renderWorkspace();
    const report = await openReport();
    fireEvent.click(within(report).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const shell = appShellCapture.latest;
    expect(shell?.kind).toBe("workspace");
    if (shell?.kind !== "workspace") throw new Error("Expected the rendered workspace");
    act(() => shell.overlays.settings.diagnostics.onOpenReport());
    expect(await screen.findByRole("dialog", { name: /Report a bug/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument();
  });
});
