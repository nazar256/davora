import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  App,
  appShellCapture,
  buildAccount,
  buildSession,
  createObjectUrlMock,
  dispatchAppBack,
  seedAccounts
} from "../../test/appIntegrationHarness";

const UI_SETTINGS_STORAGE_KEY = "davora-ui-settings";

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("FileReader produced a non-text result"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function seedFolderAppShortcuts(enabled: boolean): void {
  localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({ experimentalFolderAppShortcutsEnabled: enabled }));
}

function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

function dispatchBeforeInstallPrompt(outcome: "accepted" | "dismissed") {
  const prompt = vi.fn(async () => undefined);
  const event = Object.assign(new Event("beforeinstallprompt"), {
    preventDefault: vi.fn(),
    prompt,
    userChoice: Promise.resolve({ outcome })
  });
  window.dispatchEvent(event);
  return { prompt };
}

async function openFolderShortcutDialog() {
  fireEvent.click(await screen.findByRole("button", { name: /Open actions for Projects/i }));
  fireEvent.click(await screen.findByRole("button", { name: /Folder shortcut/i }));
  return screen.findByRole("dialog", { name: "Folder shortcut" });
}

describe("Folder shortcut App integration", () => {
  it("opens a folder-only shortcut dialog with an account-aware deep link and copies it", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha Cloud" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const writeText = stubClipboard();

    render(<App />);
    const dialog = await openFolderShortcutDialog();

    const linkInput = within(dialog).getByLabelText("Folder link");
    expect(linkInput).toHaveDisplayValue(/\?path=Projects&account=alpha/);
    expect(linkInput).not.toHaveDisplayValue(/token-alpha/);
    expect(within(dialog).getByText("Alpha Cloud")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Shortcut as app" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy folder link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("account=alpha")));
    await within(dialog).findByText("Link copied to the clipboard.");
  });

  it("does not offer the shortcut action for files", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha Cloud" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Open actions for roadmap\.txt/i }));
    await screen.findByRole("region", { name: /Details for roadmap\.txt/i });

    expect(screen.queryByRole("button", { name: /Folder shortcut/i })).not.toBeInTheDocument();
  });

  it("dismisses the dialog through the history Back surface", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha Cloud" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);
    await openFolderShortcutDialog();

    dispatchAppBack("");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Folder shortcut" })).not.toBeInTheDocument());
  });

  it("restores the folder and account from a deep link at startup", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha Cloud" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    window.history.replaceState(null, "", "/?path=Projects&account=alpha");

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for roadmap\.txt/i });
    expect(window.location.search).toContain("path=Projects");
    expect(window.location.search).toContain("account=alpha");
  });

  it("suppresses the folder path and warns when the linked account is unavailable", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha Cloud" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    window.history.replaceState(null, "", "/?path=Projects&account=beta");

    render(<App />);

    // Root listing (Projects folder row) means the deep-linked path was NOT applied under alpha.
    await screen.findByRole("button", { name: /Open folder Projects/i });
    const announcedStatuses = appShellCapture.history
      .filter((props): props is Extract<typeof props, { kind: "workspace" }> => props.kind === "workspace")
      .map((props) => props.workspace.browseHeader.status);
    expect(announcedStatuses.some((status) => status?.includes("linked account is unavailable"))).toBe(true);
  });

  it("runs the experimental app install through a folder manifest and restores the link", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha Cloud" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    seedFolderAppShortcuts(true);

    render(<App />);
    await screen.findByRole("button", { name: /Open actions for Projects/i });
    const { prompt } = dispatchBeforeInstallPrompt("accepted");
    const dialog = await openFolderShortcutDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Shortcut as app" }));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await within(dialog).findByText("Folder app installed.");
    await screen.findByText(/Home screen app for Projects installed\./i);

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    const manifestBlob = createObjectUrlMock.mock.calls[0][0];
    const manifest: unknown = JSON.parse(await readBlobText(manifestBlob));
    const deepLink = `${window.location.origin}/?path=Projects&account=alpha`;
    expect(manifest).toMatchObject({
      id: deepLink,
      start_url: deepLink,
      short_name: "Projects",
      display: "standalone"
    });

    // The temporary manifest link is removed once the prompt resolves.
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull();
  });

  it("falls back to the manual link flow when the browser cannot install the folder app", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha Cloud" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    seedFolderAppShortcuts(true);
    // No beforeinstallprompt captured: the folder install is unavailable.

    render(<App />);
    const dialog = await openFolderShortcutDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Shortcut as app" }));

    await within(dialog).findByText("Install is not available in this browser.");
    await screen.findByText(/cannot install a folder app/i);
    const linkInput = within(dialog).getByLabelText("Folder link");
    expect(linkInput).toHaveDisplayValue(/\?path=Projects&account=alpha/);
  });

  it("keeps the app install affordance app-owned until the folder claims it", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha Cloud" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    seedFolderAppShortcuts(true);

    render(<App />);
    await screen.findByRole("button", { name: /Open actions for Projects/i });
    const { prompt } = dispatchBeforeInstallPrompt("dismissed");

    const installAppButton = await screen.findByRole("button", { name: /Install app/i });
    const dialog = await openFolderShortcutDialog();
    // Opening the dialog does not steal the captured install prompt.
    expect(installAppButton).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Shortcut as app" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await within(dialog).findByText("Install was dismissed.");
    // The consumed capture no longer advertises the app install affordance.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Install app/i })).not.toBeInTheDocument());
  });
});
