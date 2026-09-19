import { describe, expect, it } from "vitest";

import { buildFileListEmptyPresentation } from "./emptyPresentation";

const locationLabel = "/Projects/Plans";

describe("buildFileListEmptyPresentation", () => {
  it("hides empty state during first folder load with unknown contents", () => {
    expect(buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive: false,
      loadingFolder: true,
      hasEverCachedFolder: false,
      locationLabel,
      cacheOnlyMode: false
    })).toMatchObject({ showEmptyState: false });
  });

  it("shows empty state when the list is empty outside first-load unknown state", () => {
    expect(buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive: false,
      loadingFolder: false,
      hasEverCachedFolder: false,
      locationLabel,
      cacheOnlyMode: false
    }).showEmptyState).toBe(true);

    expect(buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive: false,
      loadingFolder: true,
      hasEverCachedFolder: true,
      locationLabel,
      cacheOnlyMode: false
    }).showEmptyState).toBe(true);

    expect(buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive: true,
      loadingFolder: true,
      hasEverCachedFolder: false,
      locationLabel,
      cacheOnlyMode: false
    }).showEmptyState).toBe(true);
  });

  it.each([
    [{
      searchActive: true,
      visibleListError: new Error("search failed"),
      hasEverCachedFolder: false,
      expectedTitle: "Unable to load search results.",
      expectedStatus: "search failed"
    }, {
      searchActive: true,
      visibleListError: undefined,
      hasEverCachedFolder: false,
      expectedTitle: "No files match this search yet.",
      expectedStatus: `Search scope: ${locationLabel}`
    }, {
      searchActive: false,
      visibleListError: new Error("folder failed"),
      hasEverCachedFolder: true,
      expectedTitle: "Unable to load this folder.",
      expectedStatus: "folder failed"
    }, {
      searchActive: false,
      visibleListError: new Error("folder failed"),
      hasEverCachedFolder: false,
      expectedTitle: "Couldn't load this folder. Its contents are unknown.",
      expectedStatus: "folder failed"
    }, {
      searchActive: false,
      visibleListError: undefined,
      hasEverCachedFolder: false,
      expectedTitle: "This folder is empty.",
      expectedStatus: `Location: ${locationLabel}`
    }]
  ])("uses empty title and status for $expectedTitle", ({
    searchActive,
    visibleListError,
    hasEverCachedFolder,
    expectedTitle,
    expectedStatus
  }) => {
    const presentation = buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive,
      loadingFolder: false,
      hasEverCachedFolder,
      visibleListError,
      locationLabel,
      cacheOnlyMode: false
    });

    expect(presentation.emptyTitle).toBe(expectedTitle);
    expect(presentation.emptyStatus).toBe(expectedStatus);
  });

  it("enables list recovery only for folder errors outside search, loading, and cache-only", () => {
    const folderError = new Error("folder failed");

    expect(buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive: false,
      loadingFolder: false,
      hasEverCachedFolder: false,
      folderError,
      locationLabel,
      cacheOnlyMode: false
    }).listRecoveryAvailable).toBe(true);

    expect(buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive: true,
      loadingFolder: false,
      hasEverCachedFolder: false,
      folderError,
      locationLabel,
      cacheOnlyMode: false
    }).listRecoveryAvailable).toBe(false);

    expect(buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive: false,
      loadingFolder: true,
      hasEverCachedFolder: false,
      folderError,
      locationLabel,
      cacheOnlyMode: false
    }).listRecoveryAvailable).toBe(false);

    expect(buildFileListEmptyPresentation({
      visibleItemCount: 0,
      searchActive: false,
      loadingFolder: false,
      hasEverCachedFolder: false,
      folderError,
      cacheOnlyMode: true,
      locationLabel
    }).listRecoveryAvailable).toBe(false);
  });
});
