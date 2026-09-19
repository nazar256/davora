import {
  fireEvent, render, screen, waitFor, within
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  App, buildAccount, buildSession, mockedApi, seedAccounts, setMatchMediaMatches,
} from "../../../../test/appIntegrationHarness";

describe("App operations integration", () => {
  it("confirms single-item delete without asking the user to type the target name", async () => {
    setMatchMediaMatches(true);
    const account = buildAccount("alpha", { displayName: "Delete confirmation workspace" });
    const targetName = "Документи-and-a-very-long-delete-target-name-100%.txt";
    const targetPath = `Projects/${targetName}`;
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({
      path: "",
      items: [{ path: targetPath, name: targetName, isFolder: false, size: 70, mimeType: "text/plain" }]
    });
    mockedApi.deleteFile.mockResolvedValue({ result: { action: "delete", parentPath: "Projects", path: targetPath } });

    render(<App />);

    await screen.findByRole("button", { name: `Open actions for ${targetName}` });
    fireEvent.click(screen.getByRole("button", { name: `Open actions for ${targetName}` }));
    fireEvent.click(within(await screen.findByRole("region", { name: `Details for ${targetName}` })).getByRole("button", { name: /^Delete$/i }));

    const dialog = await screen.findByRole("dialog", { name: /Delete item/i });
    expect(within(dialog).getByText("This permanently deletes the selected item from the server.")).toBeInTheDocument();
    expect(within(dialog).getByText(targetPath)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Name to confirm/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Cancel", "Delete"]);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));

    await waitFor(() => expect(mockedApi.deleteFile).toHaveBeenCalledWith({ path: targetPath, confirmName: targetName }, "token-alpha"));
  });

  it("derives operation surfaces from exact capabilities while preserving download-based offline retention", async () => {
    const account = buildAccount("alpha", { displayName: "Limited capability workspace" });
    const session = buildSession(account);
    session.capabilities = {
      ...session.capabilities,
      createFolder: false,
      upload: false,
      download: false,
      offlineCache: true,
      copy: true,
      move: false
    };
    seedAccounts([{ account, session }], account.id);

    render(<App />);
    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Select roadmap.txt file/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    expect(screen.queryByRole("button", { name: /^Download$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Keep offline$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Copy or move/i })).toBeDisabled();
  });

});
