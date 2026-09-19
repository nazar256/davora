import {
  act, cleanup, fireEvent, render, screen, waitFor, within
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  App, buildAccount, buildSession, mockedApi, seedAccounts, setMatchMediaMatches,
  NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT, WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT, appShellCapture, createBrowserAppServices, createResponsiveViewportFixture,
} from "../../test/appIntegrationHarness";

describe("App navigation integration", () => {
  it("updates responsive shell surfaces after a post-mount viewport transition", async () => {
    const viewport = createResponsiveViewportFixture(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT);
    const account = buildAccount("alpha", { displayName: "Responsive transition workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App services={{ ...createBrowserAppServices(), responsiveViewport: viewport.port }} />);

    await screen.findByRole("button", { name: /Create folder/i });
    expect(screen.queryByRole("button", { name: /Open search/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    const panel = await screen.findByRole("region", { name: /Details for Projects/i });
    expect(panel).not.toHaveClass("details-panel-sheet-open");

    act(() => viewport.emit(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT));

    expect(await screen.findByRole("button", { name: /Open search/i })).toBeInTheDocument();
    expect(panel).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open sort options/i }));
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();

    act(() => viewport.emit(WIDE_RESPONSIVE_VIEWPORT_SNAPSHOT));

    expect(screen.queryByRole("button", { name: /Open search/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Sort options/i })).not.toBeInTheDocument();
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveClass("details-panel-sheet-open");

    act(() => viewport.emit(NARROW_RESPONSIVE_VIEWPORT_SNAPSHOT));

    expect(await screen.findByRole("button", { name: /Open search/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Sort options/i })).toBeInTheDocument();
    expect(panel).toBeInTheDocument();
  });

  it("characterizes the current App navigation-drawer composition, key, inputs, and selection favourite parity", async () => {
    setMatchMediaMatches(true);
    const alpha = buildAccount("alpha", { displayName: "Composition Alpha", label: "Composition Alpha" });
    const beta = buildAccount("beta", { displayName: "Composition Beta", label: "Composition Beta" });
    seedAccounts([{ account: alpha, session: buildSession(alpha) }, { account: beta, session: buildSession(beta) }], alpha.id);
    localStorage.setItem("davora-favourites:alpha", JSON.stringify([
      { accountId: "alpha", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-alpha", path: "Projects", name: "Projects", isFolder: true, addedAt: "2026-08-05T00:00:00.000Z" }
    ]));
    localStorage.setItem("davora-favourites:beta", JSON.stringify([
      { accountId: "beta", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-beta", path: "Beta", name: "Beta", isFolder: true, addedAt: "2026-08-05T00:00:01.000Z" }
    ]));

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    const workspace = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    expect(workspace?.kind).toBe("workspace");
    if (workspace?.kind !== "workspace") return;
    const drawer = workspace.common.navigationDrawer;
    expect(drawer).toBeDefined();
    if (!drawer) return;
    expect(drawer.key).toBe(alpha.id);
    expect(drawer.props.accountName).toBe("Composition Alpha");
    expect(drawer.props.locationLabel).toBe("/");
    expect(drawer.props.currentPath).toBe("");
    expect(drawer.props.entries).toHaveLength(1);
    expect(drawer.props.entries[0]?.accountId).toBe(alpha.id);
    expect(drawer.props.pointerEnvironment).toBeDefined();
    expect(drawer.props.offline).toBe(false);
    expect(drawer.props.explicitOfflineMode).toBe(false);
    expect(drawer.props.mutationBusy).toBe(false);
    expect(drawer.props.canCreateFolder).toBe(true);
    expect(drawer.props.canUploadFiles).toBe(true);
    expect(drawer.props.canUploadFolders).toBe(true);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    const detailsPanel = await screen.findByRole("region", { name: /Details for Projects/i });
    const selectedWorkspace = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    expect(selectedWorkspace?.kind).toBe("workspace");
    if (selectedWorkspace?.kind === "workspace") {
      expect(selectedWorkspace.workspace.selectionDetails.selectedIsFavourite).toBe(true);
    }
    fireEvent.click(within(detailsPanel).getByRole("button", { name: /Remove from Favourites/i }));
    await waitFor(() => expect([...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace")?.kind).toBe("workspace"));
    const updated = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    expect(updated?.kind).toBe("workspace");
    if (updated?.kind === "workspace") {
      expect(updated.workspace.selectionDetails.selectedIsFavourite).toBe(false);
      expect(updated.workspace.selectionDetails.selectedFavouriteActionLabel).toBe("Add to Favourites");
    }
    await waitFor(() => expect(JSON.parse(localStorage.getItem("davora-favourites:alpha") ?? "[]")).toHaveLength(0));

    fireEvent.click(screen.getByRole("button", { name: /Close item actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const switchDrawer = await screen.findByRole("complementary", { name: /Navigation menu/i });
    fireEvent.click(within(switchDrawer).getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.change(within(settingsDialog).getByLabelText(/Active account/i), { target: { value: beta.id } });
    await waitFor(() => expect(within(settingsDialog).getByLabelText(/Active account/i)).toHaveValue(beta.id));
    await waitFor(() => {
      const switched = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
      expect(switched?.kind).toBe("workspace");
      if (switched?.kind === "workspace") {
        expect(switched.common.navigationDrawer?.key).toBe(beta.id);
        expect(switched.common.navigationDrawer?.props.accountName).toBe("Composition Beta");
        expect(switched.common.navigationDrawer?.props.entries.map((entry) => entry.path)).toEqual(["Beta"]);
      }
    });
  });

  it("keeps no-account drawer absent and closes navigation exactly once before drawer actions", async () => {
    setMatchMediaMatches(true);
    render(<App />);
    await screen.findByRole("button", { name: /Connect account/i });
    expect(appShellCapture.latest?.kind).toBe("bootstrap");
    if (appShellCapture.latest?.kind === "bootstrap") {
      expect(appShellCapture.latest.common.navigationDrawer).toBeUndefined();
    }

    const account = buildAccount("alpha", { displayName: "Drawer command workspace" });
    cleanup();
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const drawer = await screen.findByRole("complementary", { name: /Navigation menu/i });
    fireEvent.click(within(drawer).getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(screen.queryByRole("complementary", { name: /Navigation menu/i })).toBeNull();
    const settingsWorkspace = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    expect(settingsWorkspace?.kind).toBe("workspace");
    if (settingsWorkspace?.kind === "workspace") {
      expect(settingsWorkspace.common.navigationDrawer?.props.open).toBe(false);
    }

    fireEvent.click(within(settingsDialog).getByRole("button", { name: /Close|Done/i }));
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const uploadDrawer = await screen.findByRole("complementary", { name: /Navigation menu/i });
    const upload = within(uploadDrawer).getByLabelText(/Upload files from navigation menu/i);
    fireEvent.change(upload, { target: { files: [new File(["file"], "upload.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(mockedApi.uploadFileWithProgress).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("complementary", { name: /Navigation menu/i })).toBeNull();
    const fileUploadWorkspace = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    expect(fileUploadWorkspace?.kind).toBe("workspace");
    if (fileUploadWorkspace?.kind === "workspace") {
      expect(fileUploadWorkspace.common.navigationDrawer?.props.open).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const folderDrawer = await screen.findByRole("complementary", { name: /Navigation menu/i });
    const folderUpload = within(folderDrawer).getByLabelText(/Upload folder from navigation menu/i);
    fireEvent.change(folderUpload, { target: { files: [new File(["folder"], "folder.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(mockedApi.uploadFileWithProgress).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("complementary", { name: /Navigation menu/i })).toBeNull();
    const folderUploadWorkspace = [...appShellCapture.history].reverse().find((entry) => entry.kind === "workspace");
    expect(folderUploadWorkspace?.kind).toBe("workspace");
    if (folderUploadWorkspace?.kind === "workspace") {
      expect(folderUploadWorkspace.common.navigationDrawer?.props.open).toBe(false);
    }
  });

  it("keeps the mobile shell header minimal while moving account status into profile and settings", async () => {
    const account = buildAccount("alpha", { displayName: "Mobile shell workspace", label: "Mobile shell workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    setMatchMediaMatches(true);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    expect(screen.queryAllByLabelText(/Active account/i)).toHaveLength(0);
    expect(document.querySelector(".app-bar .badge")).toBeNull();
    expect(document.querySelector(".app-bar .app-bar-subtitle")).toBeNull();
    expect(screen.getByRole("button", { name: /Open navigation menu/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Profile & settings/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const navigationMenu = await screen.findByRole("complementary", { name: /Navigation menu/i });
    expect(navigationMenu).toBeInTheDocument();
    expect(within(navigationMenu).getByLabelText(/Upload files from navigation menu/i)).toBeInTheDocument();
    expect(within(navigationMenu).getByLabelText(/Upload folder from navigation menu/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));

    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    expect(within(settingsDialog).getByLabelText(/Active account/i)).toHaveValue(account.id);
    expect(within(settingsDialog).getByText("Workspace status")).toBeInTheDocument();
    expect(within(settingsDialog).getByText("Online")).toBeInTheDocument();
  });

  it("removes the persistent Davora app name from connected in-app chrome", async () => {
    const account = buildAccount("alpha", { displayName: "Chrome cleanup workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    const appBar = screen.getByRole("banner");
    expect(within(appBar).queryByRole("heading", { name: /^Davora$/i })).toBeNull();
    expect(within(appBar).getByRole("button", { name: /Profile & settings/i })).toBeInTheDocument();
    expect(within(appBar).getByLabelText(/Transfers/i)).toBeInTheDocument();
  });

  it("closes settings and action dialogs when clicking outside", async () => {
    const account = buildAccount("alpha", { displayName: "Alpha workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    expect(await screen.findByRole("button", { name: /Create folder/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settingsDialog = await screen.findByRole("dialog", { name: /Profile and settings/i });
    fireEvent.click(settingsDialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Profile and settings/i })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Create folder/i }));
    const createDialog = await screen.findByRole("dialog", { name: /Create folder/i });
    fireEvent.click(createDialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Create folder/i })).not.toBeInTheDocument());
  });

});
