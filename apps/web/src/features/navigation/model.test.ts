import { describe, expect, it } from "vitest";

import {
  applyChromeDismiss,
  clearChromeOnPathNavigate,
  closeChromeSurface,
  closedChromeSurfaces,
  createHistoryState,
  DISMISS_SURFACE_ORDER,
  mergeOpenSurfaces,
  openChromeSurface,
  parseHistoryState,
  resolvePathFromHistoryState,
  resolvePopStateCommands,
  shouldPushChromeHistory,
  type DismissSurfaceKind,
  type OpenSurfacesSnapshot
} from "./model";

const closedSurfaces = (): OpenSurfacesSnapshot => ({
  preview: false,
  action: false,
  destination: false,
  account: false,
  removeAccount: false,
  folderShortcut: false,
  reportBug: false,
  settings: false,
  search: false,
  navigation: false,
  mobileDetails: false,
  transfers: false,
  quickActions: false
});

const surfaceKeyMap: Readonly<Record<DismissSurfaceKind, keyof OpenSurfacesSnapshot>> = {
  preview: "preview",
  action: "action",
  destination: "destination",
  account: "account",
  "remove-account": "removeAccount",
  "folder-shortcut": "folderShortcut",
  settings: "settings",
  search: "search",
  navigation: "navigation",
  "mobile-details": "mobileDetails",
  transfers: "transfers",
  "report-bug": "reportBug",
  "quick-actions": "quickActions"
};

const surfaceKey = (surface: DismissSurfaceKind): keyof OpenSurfacesSnapshot => surfaceKeyMap[surface];


const onlyOpen = (surface: keyof OpenSurfacesSnapshot): OpenSurfacesSnapshot => ({
  ...closedSurfaces(),
  [surface]: true
});

describe("navigation model", () => {
  it("creates and parses typed history payloads", () => {
    const state = createHistoryState("alpha", "Projects", "preview");

    expect(state).toEqual({
      davora: true,
      accountId: "alpha",
      path: "Projects",
      surface: "preview"
    });
    expect(parseHistoryState(state)).toEqual(state);
    expect(parseHistoryState({ davora: true, accountId: "alpha", path: "" })).toEqual(
      createHistoryState("alpha", "")
    );
    expect(parseHistoryState(null)).toBeNull();
    expect(parseHistoryState({ davora: true, accountId: 1, path: "" })).toBeNull();
    expect(parseHistoryState({ davora: true, accountId: "alpha", path: "", surface: "unknown" })).toBeNull();
  });

  it("restores path from davora history state and keeps current path otherwise", () => {
    expect(resolvePathFromHistoryState(createHistoryState("alpha", "Projects"), "Home")).toBe("Projects");
    expect(resolvePathFromHistoryState(null, "Home")).toBe("Home");
  });

  it("dismisses only the top priority open surface on Back", () => {
    for (const surface of DISMISS_SURFACE_ORDER) {
      const openSurfaces = onlyOpen(surfaceKey(surface));
      expect(resolvePopStateCommands({
        historyState: createHistoryState("alpha", "Projects"),
        currentPath: "Projects",
        openSurfaces
      })).toEqual([{ kind: "dismiss", surface }]);
    }
  });

  it("prefers quick actions over every other open surface", () => {
    expect(resolvePopStateCommands({
      historyState: createHistoryState("alpha", "Projects"),
      currentPath: "Projects",
      openSurfaces: {
        preview: true,
        action: true,
        destination: true,
        account: true,
        removeAccount: true,
        folderShortcut: true,
        reportBug: true,
        settings: true,
        search: true,
        navigation: true,
        mobileDetails: true,
        transfers: true,
        quickActions: true
      }
    })).toEqual([{ kind: "dismiss", surface: "quick-actions" }]);
  });

  it("follows the NAV-02 dismiss order across surfaces used today", () => {
    const order = DISMISS_SURFACE_ORDER;
    let openSurfaces = closedSurfaces();

    for (const surface of order) {
      const key = surfaceKey(surface);
      openSurfaces = { ...openSurfaces, [key]: true };
      expect(resolvePopStateCommands({
        historyState: createHistoryState("alpha", "Projects"),
        currentPath: "Projects",
        openSurfaces
      })[0]).toEqual({ kind: "dismiss", surface });
      openSurfaces = { ...openSurfaces, [key]: false };
    }
  });

  it("navigates when no surface is open and history path differs", () => {
    expect(resolvePopStateCommands({
      historyState: createHistoryState("alpha", ""),
      currentPath: "Projects",
      openSurfaces: closedSurfaces()
    })).toEqual([{ kind: "navigate", path: "" }]);
  });

  it("dismisses before path restore when both apply", () => {
    const historyState = createHistoryState("alpha", "", "preview");

    expect(parseHistoryState(historyState)).toEqual(historyState);
    expect(resolvePopStateCommands({
      historyState,
      currentPath: "Projects/roadmap.txt",
      openSurfaces: onlyOpen("preview")
    })).toEqual([
      { kind: "dismiss", surface: "preview" },
      { kind: "navigate", path: "" }
    ]);
  });

  it("uses the exact dismiss order when workflow and chrome surfaces are simultaneous", () => {
    expect(DISMISS_SURFACE_ORDER).toEqual([
      "quick-actions",
      "preview",
      "action",
      "destination",
      "folder-shortcut",
      "account",
      "remove-account",
      "report-bug",
      "settings",
      "search",
      "navigation",
      "mobile-details",
      "transfers"
    ]);

    let openSurfaces: OpenSurfacesSnapshot = {
      preview: true,
      action: true,
      destination: true,
      account: true,
      removeAccount: true,
      folderShortcut: true,
      reportBug: true,
      settings: true,
      search: true,
      navigation: true,
      mobileDetails: true,
      transfers: true,
      quickActions: true
    };

    for (const surface of DISMISS_SURFACE_ORDER) {
      expect(resolvePopStateCommands({
        historyState: createHistoryState("alpha", "Projects"),
        currentPath: "Projects",
        openSurfaces
      })).toEqual([{ kind: "dismiss", surface }]);

      openSurfaces = { ...openSurfaces, [surfaceKey(surface)]: false };
    }

    expect(resolvePopStateCommands({
      historyState: createHistoryState("alpha", "Archive"),
      currentPath: "Projects",
      openSurfaces
    })).toEqual([{ kind: "navigate", path: "Archive" }]);
  });

  it("navigates from popstate entries that only carry davora and path", () => {
    expect(resolvePopStateCommands({
      historyState: { davora: true, path: "" },
      currentPath: "Projects",
      openSurfaces: closedSurfaces()
    })).toEqual([{ kind: "navigate", path: "" }]);
  });

  it("does not navigate for non-davora history entries", () => {
    expect(resolvePopStateCommands({
      historyState: { path: "Projects" },
      currentPath: "",
      openSurfaces: closedSurfaces()
    })).toEqual([]);
  });

  it("does not navigate when history path matches current path", () => {
    expect(resolvePopStateCommands({
      historyState: createHistoryState("alpha", "Projects", "transfers"),
      currentPath: "Projects",
      openSurfaces: onlyOpen("transfers")
    })).toEqual([{ kind: "dismiss", surface: "transfers" }]);
  });

  it("documents destination picker as action-labeled but destination-priority dismiss", () => {
    expect(createHistoryState("alpha", "Projects", "action").surface).toBe("action");
    expect(resolvePopStateCommands({
      historyState: createHistoryState("alpha", "Projects", "action"),
      currentPath: "Projects",
      openSurfaces: {
        ...closedSurfaces(),
        destination: true,
        action: false
      }
    })).toEqual([{ kind: "dismiss", surface: "destination" }]);
  });

  describe("chrome surfaces snapshot", () => {
    it("opens, closes, and dismisses only chrome-backed surfaces", () => {
      let chrome = closedChromeSurfaces();

      chrome = openChromeSurface(chrome, "settings");
      expect(chrome.settings).toBe(true);

      chrome = closeChromeSurface(chrome, "settings");
      expect(chrome.settings).toBe(false);

      chrome = openChromeSurface(chrome, "navigation");
      chrome = applyChromeDismiss(chrome, "navigation");
      expect(chrome.navigation).toBe(false);

      chrome = openChromeSurface(chrome, "search");
      expect(applyChromeDismiss(chrome, "preview")).toBe(chrome);
      expect(applyChromeDismiss(chrome, "search").search).toBe(false);
    });

    it("clears drawer, mobile details, and quick actions on path navigation", () => {
      const chrome = clearChromeOnPathNavigate({
        navigation: true,
        search: true,
        mobileDetails: true,
        settings: true,
        transfers: true,
        quickActions: true
      });

      expect(chrome).toEqual({
        navigation: false,
        search: true,
        mobileDetails: false,
        settings: true,
        transfers: true,
        quickActions: false
      });
    });

    it("merges chrome and workflow snapshots for popstate and PTR", () => {
      expect(mergeOpenSurfaces(
        {
          navigation: true,
          search: false,
          mobileDetails: false,
          settings: true,
          transfers: false,
          quickActions: true
        },
        {
          preview: true,
          action: false,
          destination: false,
          account: false,
          removeAccount: false,
          folderShortcut: false
          reportBug: false
        },
      )).toEqual({
        preview: true,
        action: false,
        destination: false,
        account: false,
        removeAccount: false,
        folderShortcut: false,
        reportBug: false,
        settings: true,
        search: false,
        navigation: true,
        mobileDetails: false,
        transfers: false,
        quickActions: true
      });
    });

    it("pushes chrome history only when requested", () => {
      const open = openChromeSurface(closedChromeSurfaces(), "transfers");

      expect(shouldPushChromeHistory(closedChromeSurfaces(), "transfers")).toBe(true);
      expect(shouldPushChromeHistory(open, "transfers")).toBe(false);
      expect(shouldPushChromeHistory(open, "transfers", true)).toBe(true);
      expect(shouldPushChromeHistory(open, "transfers", false)).toBe(false);
    });
  });

});
