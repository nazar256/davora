import { describe, expect, it, vi } from "vitest";

import { audioPreviewPositionStorageKey } from "../../lib/audioResume";
import { folderAudioStorageKey } from "../../features/preview/folderAudio";
import { createBrowserStringStorage } from "./browserStringStorage";
import type { BrowserStorageResult } from "./browserStringStorage";
import { createBrowserAccountPlaybackCleanup } from "./browserAccountPlaybackCleanup";

function createStorage(values: Map<string, string>, overrides: {
  listKeys?: () => BrowserStorageResult<readonly string[]>;
  deleteItem?: (key: string) => BrowserStorageResult<void>;
} = {}) {
  const storage = createBrowserStringStorage(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null
  }));
  return {
    ...storage,
    ...(overrides.listKeys || overrides.deleteItem ? {
      listKeys: overrides.listKeys ?? storage.listKeys,
      deleteItem: overrides.deleteItem ?? storage.deleteItem
    } : {})
  };
}

function cleanupFor(values: Map<string, string>, overrides: Parameters<typeof createStorage>[1] = {}) {
  const storage = createStorage(values, overrides);
  return createBrowserAccountPlaybackCleanup({
    storage,
    folderAudioKeyPrefix: (accountId) => folderAudioStorageKey(accountId, ""),
    audioResumeKeyPrefix: (accountId) => audioPreviewPositionStorageKey({ accountId, path: "" })
  });
}

describe("browser account playback cleanup", () => {
  it("removes every target folder and resume key while preserving other account and unrelated keys", () => {
    const values = new Map([
      [folderAudioStorageKey("alpha", "Projects"), "malformed"],
      [folderAudioStorageKey("alpha", "Archive/Audio"), "{}"],
      [folderAudioStorageKey("beta", "Projects"), "beta"],
      [audioPreviewPositionStorageKey({ accountId: "alpha", path: "Projects/track.m4a" }), "11"],
      [audioPreviewPositionStorageKey({ accountId: "beta", path: "Projects/track.m4a" }), "22"],
      ["davora-folder-audio-settings", "global"]
    ]);

    cleanupFor(values).purgeAccount("alpha", ["alpha", "beta"]);

    expect(values).toEqual(new Map([
      [folderAudioStorageKey("beta", "Projects"), "beta"],
      [audioPreviewPositionStorageKey({ accountId: "beta", path: "Projects/track.m4a" }), "22"],
      ["davora-folder-audio-settings", "global"]
    ]));
  });

  it("succeeds when stores are empty and target payloads are malformed", () => {
    const values = new Map([
      [folderAudioStorageKey("alpha", ""), "not-json"],
      [audioPreviewPositionStorageKey({ accountId: "alpha", path: "" }), "not-a-number"]
    ]);

    expect(() => cleanupFor(values).purgeAccount("alpha", ["alpha"])).not.toThrow();
    expect(values).toHaveLength(0);
    expect(() => cleanupFor(new Map()).purgeAccount("alpha", ["alpha"])).not.toThrow();
  });

  it("does not match account-id lookalikes", () => {
    const values = new Map([
      [folderAudioStorageKey("alpha2", "Projects"), "alpha2"],
      [audioPreviewPositionStorageKey({ accountId: "alpha2", path: "track.m4a" }), "alpha2"]
    ]);

    cleanupFor(values).purgeAccount("alpha", ["alpha", "alpha2"]);

    expect(values).toEqual(new Map([
      [folderAudioStorageKey("alpha2", "Projects"), "alpha2"],
      [audioPreviewPositionStorageKey({ accountId: "alpha2", path: "track.m4a" }), "alpha2"]
    ]));
  });

  it("fails closed before deletion when account namespaces are ambiguous", () => {
    const values = new Map([
      [folderAudioStorageKey("alpha:child", "Projects"), "ambiguous"],
      [audioPreviewPositionStorageKey({ accountId: "alpha:child", path: "track.m4a" }), "ambiguous"]
    ]);
    const deleteItem = vi.fn(createStorage(values).deleteItem);

    expect(() => cleanupFor(values, { deleteItem }).purgeAccount("alpha", ["alpha", "alpha:child"])).toThrow();
    expect(deleteItem).not.toHaveBeenCalled();
    expect(values).toHaveLength(2);
  });

  it("does not let unrelated ambiguous namespaces block another account purge", () => {
    const values = new Map([
      [folderAudioStorageKey("alpha:child", "Projects"), "ambiguous-folder"],
      [audioPreviewPositionStorageKey({ accountId: "alpha:child", path: "track.m4a" }), "ambiguous-resume"],
      [folderAudioStorageKey("beta", "Projects"), "beta-folder"],
      [audioPreviewPositionStorageKey({ accountId: "beta", path: "track.m4a" }), "beta-resume"]
    ]);

    cleanupFor(values).purgeAccount("beta", ["beta", "alpha", "alpha:child"]);

    expect(values).toEqual(new Map([
      [folderAudioStorageKey("alpha:child", "Projects"), "ambiguous-folder"],
      [audioPreviewPositionStorageKey({ accountId: "alpha:child", path: "track.m4a" }), "ambiguous-resume"]
    ]));
  });

  it("surfaces enumeration and deletion failures", () => {
    const values = new Map([[folderAudioStorageKey("alpha", "Projects"), "alpha"]]);
    expect(() => cleanupFor(values, { listKeys: () => ({ ok: false, error: new Error("enumeration-secret") }) }).purgeAccount("alpha", ["alpha"])).toThrow(/enumeration-secret/);

    const deleteItem = vi.fn(() => ({ ok: false as const, error: new Error("delete-secret") }));
    expect(() => cleanupFor(values, { deleteItem }).purgeAccount("alpha", ["alpha"])).toThrow(/delete-secret/);
    expect(deleteItem).toHaveBeenCalledWith(folderAudioStorageKey("alpha", "Projects"));
  });

  it("can retry after a partial deletion failure", () => {
    const values = new Map([
      [folderAudioStorageKey("alpha", "Projects"), "alpha-projects"],
      [folderAudioStorageKey("alpha", "Archive"), "alpha-archive"],
      [folderAudioStorageKey("beta", "Projects"), "beta-projects"]
    ]);
    let deletionCalls = 0;
    const baseStorage = createStorage(values);
    const cleanup = createBrowserAccountPlaybackCleanup({
      storage: createStorage(values, {
        deleteItem: (key) => {
          deletionCalls += 1;
          if (deletionCalls === 2) {
            return { ok: false, error: new Error("transient-delete") };
          }
          return baseStorage.deleteItem(key);
        }
      }),
      folderAudioKeyPrefix: (accountId) => folderAudioStorageKey(accountId, ""),
      audioResumeKeyPrefix: (accountId) => audioPreviewPositionStorageKey({ accountId, path: "" })
    });

    expect(() => cleanup.purgeAccount("alpha", ["alpha", "beta"])).toThrow(/transient-delete/);
    expect(values).toEqual(new Map([
      [folderAudioStorageKey("alpha", "Archive"), "alpha-archive"],
      [folderAudioStorageKey("beta", "Projects"), "beta-projects"]
    ]));
    expect(() => cleanup.purgeAccount("alpha", ["alpha", "beta"])).not.toThrow();
    expect(values).toEqual(new Map([[folderAudioStorageKey("beta", "Projects"), "beta-projects"]]));
  });
});
