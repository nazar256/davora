import {
  fireEvent, render, screen, waitFor, within
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  App, buildAccount, buildSession, mockedApi, seedAccounts,
  ApiRequestError, appShellCapture, healthResponse, retainedFileFixture, seedRetentionSnapshot,
} from "../../../test/appIntegrationHarness";

describe("App accounts integration", () => {
  it("opens account management from the main workspace and can switch accounts", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace", label: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace", label: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);

    seedRetentionSnapshot(alpha, { normalCache: { itemCount: 1, totalBytes: 1536, limitBytes: 24 * 1024 * 1024 }, roots: [], files: [retainedFileFixture("cached.txt", { blobSize: 1536, normalCacheOwnership: "owned" })], memberships: [] });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    const alphaAppBar = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!alphaAppBar || alphaAppBar.kind !== "workspace") throw new Error("Expected Alpha AppBar capture");
    const oldAppBarSearch = alphaAppBar.common.appBar.onSearchQueryChange;

    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));

    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByLabelText(/Active account/i)).toHaveValue(alpha.id);
    fireEvent.change(within(settingsDialog).getByLabelText(/Active account/i), { target: { value: beta.id } });

    await waitFor(() => expect(within(settingsDialog).getByLabelText(/Active account/i)).toHaveValue(beta.id));
    const betaAppBar = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    if (!betaAppBar || betaAppBar.kind !== "workspace") throw new Error("Expected Beta AppBar capture");
    expect(betaAppBar.common.appBar).not.toBe(alphaAppBar.common.appBar);
    expect(betaAppBar.common.appBar.hasSession).toBe(true);
    oldAppBarSearch("replacement-owner-search");
    await waitFor(() => {
      const current = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      expect(current?.kind).toBe("workspace");
      if (current?.kind === "workspace") expect(current.common.appBar.searchQuery).toBe("replacement-owner-search");
    });
  });

  it("shows unlock guidance when APP_UNLOCK_CODE is required", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    seedAccounts([{ account }], account.id);
    mockedApi.getHealth.mockResolvedValue({ ...healthResponse, unlockRequired: true });

    render(<App />);

    expect(await screen.findByRole("heading", { name: /Unlock required/i })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: /Unlock and connect/i }).closest("form")!);
    expect(await screen.findByText(/Enter the deployment unlock code/i)).toBeInTheDocument();
  });

  it("keeps a failed unlock secret out of status, errors, persistence, and console sinks", async () => {
    const account = buildAccount("alpha", { displayName: "Unlock boundary workspace" });
    const sentinel = "sentinel-unlock-secret";
    seedAccounts([{ account }], account.id);
    mockedApi.getHealth.mockResolvedValue({ ...healthResponse, unlockRequired: true });
    mockedApi.createSession.mockRejectedValue(new ApiRequestError("invalid unlock", 401, "invalid_unlock_code"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(<App />);
      const input = await screen.findByLabelText("Unlock code");
      fireEvent.change(input, { target: { value: sentinel } });
      fireEvent.submit(input.closest("form")!);

      await waitFor(() => expect(mockedApi.createSession).toHaveBeenCalledWith({ accountId: account.id, unlockCode: sentinel }));
      expect(document.body.textContent).not.toContain(sentinel);
      expect(JSON.stringify(localStorage)).not.toContain(sentinel);
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining(sentinel));
    } finally {
      consoleError.mockRestore();
    }
  });

});
