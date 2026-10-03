import {
  fireEvent, render, screen, waitFor, within
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  App, buildAccount, buildSession, mockedApi, seedAccounts, setMatchMediaMatches,
} from "../../../test/appIntegrationHarness";

describe("App browsing integration", () => {
  it("keeps captured cross-folder search archive roots after the query is cleared", async () => {
    const account = buildAccount("alpha", { displayName: "Search selection workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    mockedApi.searchFiles.mockResolvedValueOnce({ completeness: "complete",
      query: "report",
      path: "",
      items: [
        { path: "Projects/report.txt", name: "report.txt", isFolder: false, size: 2, score: 2 },
        { path: "Archive/report.txt", name: "report.txt", isFolder: false, size: 3, score: 1 }
      ]
    });

    render(<App />);
    await screen.findByRole("button", { name: /Create folder/i });
    fireEvent.change(screen.getByLabelText(/Search files/i), { target: { value: "report" } });
    const resultCheckboxes = await screen.findAllByRole("checkbox", { name: /Select report.txt file/i });
    fireEvent.click(resultCheckboxes[0]);
    fireEvent.click(resultCheckboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /Clear search/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Download selected$/i })[0]);

    await waitFor(() => expect(mockedApi.triggerBrowserDownload).toHaveBeenCalledWith(expect.any(Blob), "davora-search-results-download.zip"));
  });

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  it("adds file and folder favourites from item actions and removes shortcuts without deleting files", async () => {
    setMatchMediaMatches(true);
    const account = buildAccount("alpha", { displayName: "Favourites workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(within(await screen.findByRole("region", { name: /Details for Projects/i })).getByRole("button", { name: /Add to Favourites/i }));
    fireEvent.click(screen.getByRole("button", { name: /Close item actions/i }));

    fireEvent.click(screen.getByRole("button", { name: /Open actions for roadmap.txt/i }));
    fireEvent.click(within(await screen.findByRole("region", { name: /Details for roadmap.txt/i })).getByRole("button", { name: /Add to Favourites/i }));
    fireEvent.click(screen.getByRole("button", { name: /Close item actions/i }));

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const favouritesSection = await screen.findByRole("region", { name: /Favourites/i });
    expect(within(favouritesSection).getByRole("button", { name: /Open favourite folder Projects/i })).toBeInTheDocument();
    expect(within(favouritesSection).getByRole("button", { name: /Open favourite file roadmap.txt/i })).toBeInTheDocument();
    expect(within(favouritesSection).queryByText(/^Folder$/)).not.toBeInTheDocument();
    expect(within(favouritesSection).queryByText(/^File$/)).not.toBeInTheDocument();

    fireEvent.click(within(favouritesSection).getByRole("button", { name: /Remove roadmap.txt from Favourites/i }));

    expect(within(favouritesSection).queryByRole("button", { name: /Open favourite file roadmap.txt/i })).not.toBeInTheDocument();
    expect(mockedApi.deleteFile).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("davora-favourites:alpha") ?? "[]")).toHaveLength(1);
  });

  it("opens favourite folders and files from the mobile navigation drawer", async () => {
    setMatchMediaMatches(true);
    const account = buildAccount("alpha", { displayName: "Favourite open workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    localStorage.setItem("davora-favourites:alpha", JSON.stringify([
      { accountId: "alpha", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-alpha", path: "Projects", name: "Projects", isFolder: true, addedAt: "2026-07-10T00:00:00.000Z" },
      { accountId: "alpha", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-alpha", path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, mimeType: "text/plain", addedAt: "2026-07-10T00:00:01.000Z" }
    ]));

    render(<App />);

    await screen.findByRole("button", { name: /Open navigation menu/i });
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(within(await screen.findByRole("region", { name: /Favourites/i })).getByRole("button", { name: /Open favourite folder Projects/i }));
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("path")).toBe("Projects"));
    expect(await screen.findByRole("button", { name: /Open file roadmap.txt/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    fireEvent.click(within(await screen.findByRole("region", { name: /Favourites/i })).getByRole("button", { name: /Open favourite file roadmap.txt/i }));

    expect(await screen.findByRole("dialog", { name: /Preview roadmap.txt/i })).toBeInTheDocument();
  });

  it("persists manual favourite reorder and marks missing favourites as unavailable", async () => {
    setMatchMediaMatches(true);
    const account = buildAccount("alpha", { displayName: "Favourite reorder workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    localStorage.setItem("davora-favourites:alpha", JSON.stringify([
      { accountId: "alpha", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-alpha", path: "Projects", name: "Projects", isFolder: true, addedAt: "2026-07-10T00:00:00.000Z" },
      { accountId: "alpha", accountBackend: "mock", accountRootPath: ".davora-agent-test", cacheNamespace: "ns-alpha", path: "Projects/roadmap.txt", name: "roadmap.txt", isFolder: false, mimeType: "text/plain", addedAt: "2026-07-10T00:00:01.000Z" }
    ]));

    render(<App />);

    await screen.findByRole("button", { name: /Open navigation menu/i });
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const favouritesSection = await screen.findByRole("region", { name: /Favourites/i });
    const projectRow = within(favouritesSection).getByLabelText(/Drag Projects favourite/i).closest(".favourite-row");
    const fileRow = within(favouritesSection).getByLabelText(/Drag roadmap.txt favourite/i).closest(".favourite-row");
    expect(projectRow).not.toBeNull();
    expect(fileRow).not.toBeNull();

    fireEvent.dragStart(fileRow!);
    fireEvent.dragOver(projectRow!);
    fireEvent.dragEnd(fileRow!);

    const storedFavourites: unknown = JSON.parse(localStorage.getItem("davora-favourites:alpha") ?? "[]");
    expect(Array.isArray(storedFavourites)).toBe(true);
    if (!Array.isArray(storedFavourites)) throw new Error("Stored favourites must be an array.");
    expect(storedFavourites.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null || !("path" in entry) || typeof entry.path !== "string") {
        throw new Error("Stored favourite must contain a string path.");
      }
      return entry.path;
    })).toEqual([
      "Projects/roadmap.txt",
      "Projects"
    ]);

    fireEvent.click(within(screen.getByRole("complementary", { name: /Navigation menu/i })).getByRole("button", { name: /Close navigation menu/i }));
    fireEvent.click(screen.getByRole("button", { name: /Open navigation menu/i }));
    const reopenedFavourites = await screen.findByRole("region", { name: /Favourites/i });
    expect(Array.from(reopenedFavourites.querySelectorAll<HTMLElement>(".favourite-row")).map((row) => row.dataset.favouriteKey)).toEqual([
      "file:Projects/roadmap.txt",
      "folder:Projects"
    ]);

    mockedApi.listFiles.mockResolvedValueOnce({ completeness: "complete", path: "Projects", items: [] });
    fireEvent.click(within(reopenedFavourites).getByRole("button", { name: /Open favourite file roadmap.txt/i }));

    expect(await within(reopenedFavourites).findByText(/Unavailable/i)).toBeInTheDocument();
    fireEvent.click(within(reopenedFavourites).getByRole("button", { name: /Remove roadmap.txt from Favourites/i }));
    expect(within(reopenedFavourites).queryByText(/Unavailable/i)).not.toBeInTheDocument();
  });

  it("keeps the app running when browser storage cannot save favourites", async () => {
    setMatchMediaMatches(true);
    const account = buildAccount("alpha", { displayName: "Favourite storage workspace" });
    seedAccounts([{ account, session: buildSession(account) }], account.id);
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "davora-favourites:alpha") {
        throw new Error("Quota exceeded");
      }
      return originalSetItem.call(localStorage, key, value);
    });

    render(<App />);

    await screen.findByRole("button", { name: /Open actions for Projects/i });
    fireEvent.click(screen.getByRole("button", { name: /Open actions for Projects/i }));
    fireEvent.click(within(await screen.findByRole("region", { name: /Details for Projects/i })).getByRole("button", { name: /Add to Favourites/i }));

    expect(await screen.findByText(/Unable to save Favourites: Quota exceeded/i)).toBeInTheDocument();
    expect(screen.queryByText(/Added Projects to Favourites/i)).not.toBeInTheDocument();
    expect(mockedApi.deleteFile).not.toHaveBeenCalled();
    expect(localStorage.getItem("davora-favourites:alpha")).toBeNull();

    setItemSpy.mockRestore();
  });

  ;

  ;

  ;

});
