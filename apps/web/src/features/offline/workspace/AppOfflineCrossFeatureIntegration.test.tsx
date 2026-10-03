import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  App, buildAccount, buildSession, mockedApi, seedAccounts, setMatchMediaMatches,
  createDeferred, dispatchAppBack, expectRetainedFilePersisted, installWakeLockMock, mockedRetentionRepository, retainedFileFixture, retainedRootFixture, seedRetentionSnapshot, textPreview,
} from "../../../test/appIntegrationHarness";

describe("App offline integration", () => {
  it("labels only files and complete folder roots that are available offline", async () => {
    const account = buildAccount("alpha", { displayName: "Offline indicators workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({ completeness: "complete",
      path: "",
      items: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" },
        { path: "online-only.txt", name: "online-only.txt", isFolder: false, size: 12, mimeType: "text/plain" }
      ]
    });
    const root = retainedRootFixture({ rootPath: "Projects", rootName: "Projects", kind: "folder", folderRoots: ["Projects"] });
    seedRetentionSnapshot(account, {
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
      roots: [root],
      files: [retainedFileFixture("Projects/roadmap.txt", { preview: textPreview, size: 70, blobSize: 70 })],
      memberships: [{ rootId: root.id, filePath: "Projects/roadmap.txt" }]
    });

    render(<App />);

    expect(await screen.findByLabelText("Projects is available offline")).toBeInTheDocument();
    expect(screen.getByLabelText("roadmap.txt is available offline")).toBeInTheDocument();
    const onlineRow = screen.getByRole("button", { name: /Open file online-only.txt/i }).closest(".item-row");
    expect(onlineRow?.querySelector(".offline-availability")).toBeNull();
  });

  it("does not label metadata-only files or roots with an unreadable offline entry", async () => {
    const account = buildAccount("alpha", { displayName: "Unreadable offline workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.listFiles.mockResolvedValue({ completeness: "complete",
      path: "",
      items: [
        { path: "Projects", name: "Projects", isFolder: true },
        { path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, size: 70, mimeType: "text/plain" },
        { path: "Projects/missing.txt", name: "missing.txt", isFolder: false, size: 20, mimeType: "text/plain" }
      ]
    });
    const root = retainedRootFixture({ rootPath: "Projects", rootName: "Projects", kind: "folder", folderRoots: ["Projects"] });
    seedRetentionSnapshot(account, {
      normalCache: { itemCount: 0, totalBytes: 0, limitBytes: 24 * 1024 * 1024 },
      roots: [root],
      files: [
        retainedFileFixture("Projects/roadmap.txt", { preview: textPreview, size: 70, blobSize: 70 }),
        retainedFileFixture("Projects/missing.txt", { preview: { ...textPreview, path: "Projects/missing.txt", name: "missing.txt" }, size: 20, blobSize: 20, readable: false })
      ],
      memberships: [{ rootId: root.id, filePath: "Projects/roadmap.txt" }, { rootId: root.id, filePath: "Projects/missing.txt" }]
    });

    render(<App />);

    expect(await screen.findByLabelText("roadmap.txt is available offline")).toBeInTheDocument();
    expect(screen.queryByLabelText("missing.txt is available offline")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Projects is available offline")).not.toBeInTheDocument();
  });

  it("retains an active offline sync beyond the terminal transfer history cap", async () => {
    const account = buildAccount("alpha", { displayName: "Concurrent transfer workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const syncDownload = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.fetchDownloadBlob.mockReturnValue(syncDownload.promise);
    const wakeLock = installWakeLockMock();

    render(<App />);

    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));
    await waitFor(() => expect(wakeLock.request).toHaveBeenCalledWith("screen"));

    const toolbar = document.querySelector<HTMLElement>(".folder-actions-inline");
    expect(toolbar).not.toBeNull();
    if (!toolbar) throw new Error("Folder action toolbar is missing.");
    const input = within(toolbar).getByLabelText<HTMLInputElement>(/^Upload files$/i);
    const uploads = Array.from({ length: 12 }, (_, index) => new File([`file-${index}`], `file-${index}.txt`, { type: "text/plain" }));
    fireEvent.change(input, { target: { files: uploads } });

    await waitFor(() => expect(mockedApi.uploadFileWithProgress).toHaveBeenCalledTimes(12), { timeout: 5_000 });
    expect(document.querySelector(".wake-lock-status")).toBeNull();
    expect(wakeLock.sentinel.release).not.toHaveBeenCalled();

    syncDownload.resolve({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });

    await waitFor(() => expectRetainedFilePersisted("Projects/roadmap.txt"));
    await waitFor(() => expect(wakeLock.sentinel.release).toHaveBeenCalledTimes(1));
  });


  it("maps browser back to close an automatically opened transfer tray without leaving the folder", async () => {
    setMatchMediaMatches(true);
    const account = buildAccount("alpha", { displayName: "Transfer back workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const download = createDeferred<{ blob: Blob; filename?: string }>();
    mockedApi.fetchDownloadBlob.mockReturnValue(download.promise);

    render(<App />);

    await screen.findByRole("button", { name: /Open folder Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open folder Projects/i }));
    await screen.findByRole("button", { name: /Open actions for roadmap.txt/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: /Keep offline confirmation/i })).getByRole("button", { name: /Start sync/i }));

    const transferStatus = await screen.findByRole("dialog", { name: /Transfer status/i });
    expect(within(transferStatus).getByText("roadmap.txt")).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ davora: true, path: "Projects", surface: "transfers" });

    act(() => dispatchAppBack("Projects"));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Transfer status/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();
    expect(window.location.search).toContain("path=Projects");

    download.resolve({ blob: new Blob(["offline roadmap"], { type: "text/plain" }), filename: "roadmap.txt" });
    await waitFor(() => expectRetainedFilePersisted("Projects/roadmap.txt"));
  });



  it("discards offline estimation that completes after the active account changes", async () => {
    const alpha = buildAccount("alpha", { displayName: "Alpha workspace" });
    const beta = buildAccount("beta", { displayName: "Beta workspace" });
    seedAccounts([
      { account: alpha, session: buildSession(alpha) },
      { account: beta, session: buildSession(beta) }
    ], alpha.id);
    const folderListing = createDeferred<Awaited<ReturnType<typeof mockedApi.listFiles>>>();
    mockedApi.listFiles.mockImplementation(async (path: string) => path === "Projects"
      ? folderListing.promise
      : { completeness: "complete" as const, path, items: [{ path: "Projects", name: "Projects", isFolder: true }] });

    render(<App />);
    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Profile & settings/i }));
    const settings = await screen.findByRole("dialog", { name: /Profile and settings/i });
    const accountSelect = within(settings).getByLabelText(/Active account/i);

    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    fireEvent.change(accountSelect, { target: { value: beta.id } });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument());
    folderListing.resolve({ completeness: "complete" as const, path: "Projects", items: [] });
    await act(async () => folderListing.promise);
    expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument();
    expect(mockedApi.fetchDownloadBlob).not.toHaveBeenCalled();
  });

  it("invalidates keep-offline confirmation on connectivity loss and rejects its detached callback", async () => {
    const account = buildAccount("alpha", { displayName: "Offline transition workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Keep offline$/i }));
    const dialog = await screen.findByRole("dialog", { name: /Keep offline confirmation/i });
    const detachedStart = within(dialog).getByRole("button", { name: /Start sync/i });
    await waitFor(() => expect(detachedStart).toBeEnabled());

    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    fireEvent(window, new Event("offline"));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Keep offline confirmation/i })).not.toBeInTheDocument());
    fireEvent.click(detachedStart);
    expect(mockedApi.fetchDownloadBlob).not.toHaveBeenCalled();
    expect(mockedRetentionRepository.persistRetainedFile).not.toHaveBeenCalled();
  });



});
