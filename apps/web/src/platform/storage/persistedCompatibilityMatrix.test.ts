import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { clear, createStore, get, set } from "idb-keyval";
import { describe, expect, it } from "vitest";

import { createAccountRegistryService } from "../../features/accounts/registry/service";
import { createBrowsingCacheRepository, type BrowsingCacheStorage } from "../../features/browsing/cache";
import { FOLDER_CACHE_PREFIX, SEARCH_CACHE_PREFIX, V1_FOLDER_CACHE_PREFIX, V1_SEARCH_CACHE_PREFIX } from "../../features/browsing/cache/policy";
import { FAVOURITES_STORAGE_PREFIX } from "../../features/browsing/favourites/service";
import { FOLDER_SORT_STORAGE_PREFIX } from "../../features/browsing/folderSort/policy";
import { UI_SETTINGS_STORAGE_KEY } from "../../features/settings/service";
import { AUDIO_PLAYLIST_PREFIX } from "../../features/preview/folderAudio/model";
import { buildFileEntry } from "../../test/files";
import { createBrowserExplicitOfflineModeStorage, EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY } from "./browserExplicitOfflineModeStorage";
import { openedFileBlobKey, openedFileIndexKey } from "./openedFileRepository";
import type { BrowserStringStorage, BrowserStorageResult } from "./browserStringStorage";

type EvidenceCriterion =
  | "current round-trip"
  | "oldest supported fixture"
  | "malformed/unknown version"
  | "failed-write rollback"
  | "account/namespace isolation"
  | "idempotent migration"
  | "old-data retention until commit";

interface Evidence {
  readonly criterion: EvidenceCriterion;
  readonly file: string;
  readonly title: string;
}

interface PersistedShape {
  readonly name: string;
  readonly keys: readonly string[];
  readonly versions: readonly string[];
  readonly owner: string;
  readonly evidence: readonly Evidence[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const evidence = (criterion: EvidenceCriterion, file: string, title: string): Evidence => ({ criterion, file, title });

/**
 * This is intentionally an executable census. A shape is not considered
 * covered by a broad integration label: every row must point to an existing
 * owner test title for every migration/retention property.
 */
const persistedShapes: readonly PersistedShape[] = [
  {
    name: "browser ownership",
    keys: ["davora-browser-id", "davora-browser-secret"],
    versions: ["unversioned secure string pair"],
    owner: "features/accounts/ownership plus browser account transport",
    evidence: [
      evidence("current round-trip", "apps/web/src/browser-ownership-account-transport.characterization.test.ts", "preserves both legacy key bytes and reuses the exact pair for account requests"),
      evidence("oldest supported fixture", "apps/web/src/browser-ownership-account-transport.characterization.test.ts", "preserves both legacy key bytes and reuses the exact pair for account requests"),
      evidence("malformed/unknown version", "apps/web/src/browser-ownership-account-transport.characterization.test.ts", "fails closed when secure randomness is unavailable for a missing key"),
      evidence("failed-write rollback", "apps/web/src/browser-ownership-account-transport.characterization.test.ts", "reuses a successfully persisted half after a partial write failure"),
      evidence("account/namespace isolation", "apps/web/src/browser-ownership-account-transport.characterization.test.ts", "reads the latest committed pair for every request rather than caching authority"),
      evidence("idempotent migration", "apps/web/src/browser-ownership-account-transport.characterization.test.ts", "does not duplicate generation under StrictMode-like concurrent reads"),
      evidence("old-data retention until commit", "apps/web/src/browser-ownership-account-transport.characterization.test.ts", "reuses a successfully persisted half after a partial write failure")
    ]
  },
  {
    name: "account registry",
    keys: ["davora-account-state"],
    versions: ["unversioned canonical registry root"],
    owner: "features/accounts/registry codec and service",
    evidence: [
      evidence("current round-trip", "apps/web/src/features/accounts/registry/codec.test.ts", "round-trips only canonical account registry fields"),
      evidence("oldest supported fixture", "apps/web/src/features/accounts/registry/codec.test.ts", "sanitizes malformed records, expired sessions, duplicates, active identity, and unknown fields"),
      evidence("malformed/unknown version", "apps/web/src/features/accounts/registry/codec.test.ts", "turns a corrupt root into a deferred delete repair and stable warning"),
      evidence("failed-write rollback", "apps/web/src/features/accounts/registry/service.test.ts", "changes nothing on failed persistence and rejects unknown or mismatched session identity"),
      evidence("account/namespace isolation", "apps/web/src/features/accounts/registry/codec.test.ts", "sanitizes malformed records, expired sessions, duplicates, active identity, and unknown fields"),
      evidence("idempotent migration", "apps/web/src/features/accounts/registry/service.test.ts", "does not write while loading and runs one deferred repair generation"),
      evidence("old-data retention until commit", "apps/web/src/features/accounts/registry/service.test.ts", "keeps sanitized memory when repair fails and retries on the next full commit")
    ]
  },
  {
    name: "UI settings",
    keys: [UI_SETTINGS_STORAGE_KEY],
    versions: ["unversioned normalized settings object"],
    owner: "features/settings/service and UI settings controller",
    evidence: [
      evidence("current round-trip", "apps/web/src/features/settings/service.test.ts", "normalizes, persists, and returns saved settings"),
      evidence("oldest supported fixture", "apps/web/src/features/settings/service.test.ts", "normalizes partial stored settings and preserves valid fields"),
      evidence("malformed/unknown version", "apps/web/src/features/settings/service.test.ts", "removes corrupt JSON and returns defaults"),
      evidence("failed-write rollback", "apps/web/src/platform/storage/browserStringStorage.test.ts", "contains operation-time storage failures"),
      evidence("account/namespace isolation", "apps/web/src/features/settings/service.test.ts", "returns defaults when settings are missing"),
      evidence("idempotent migration", "apps/web/src/features/settings/service.test.ts", "treats valid JSON with invalid persisted fields as untrusted data"),
      evidence("old-data retention until commit", "apps/web/src/features/settings/service.test.ts", "normalizes, persists, and returns saved settings")
    ]
  },
  {
    name: "explicit offline mode",
    keys: [EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY],
    versions: ["unversioned sorted account-id array"],
    owner: "platform/storage/browserExplicitOfflineModeStorage",
    evidence: [
      evidence("current round-trip", "apps/web/src/platform/storage/browserExplicitOfflineModeStorage.test.ts", "stores independent account choices in sorted canonical form"),
      evidence("oldest supported fixture", "apps/web/src/platform/storage/browserExplicitOfflineModeStorage.test.ts", "fails a read without mutating, then preserves other accounts on a later successful commit"),
      evidence("malformed/unknown version", "apps/web/src/platform/storage/browserExplicitOfflineModeStorage.test.ts", "fails closed on malformed persisted values without mutating during read"),
      evidence("failed-write rollback", "apps/web/src/platform/storage/browserExplicitOfflineModeStorage.test.ts", "reports write and delete failures without claiming a commit"),
      evidence("account/namespace isolation", "apps/web/src/platform/storage/browserExplicitOfflineModeStorage.test.ts", "stores independent account choices in sorted canonical form"),
      evidence("idempotent migration", "apps/web/src/platform/storage/browserExplicitOfflineModeStorage.test.ts", "defers valid noncanonical repair until committed layout work"),
      evidence("old-data retention until commit", "apps/web/src/platform/storage/browserExplicitOfflineModeStorage.test.ts", "fails a read without mutating, then preserves other accounts on a later successful commit")
    ]
  },
  {
    name: "favourites",
    keys: [`${FAVOURITES_STORAGE_PREFIX}:<accountId>`],
    versions: ["unversioned normalized favourite array"],
    owner: "features/browsing/favourites/service",
    evidence: [
      evidence("current round-trip", "apps/web/src/features/browsing/favourites/useFavourites.test.tsx", "adds, patches, reorders, and removes through explicit successful results"),
      evidence("oldest supported fixture", "apps/web/src/features/browsing/favourites/useFavourites.test.tsx", "loads atomically by account and never exposes the previous account entries"),
      evidence("malformed/unknown version", "apps/web/src/features/browsing/favourites/useFavourites.test.tsx", "contains unsafe persisted paths instead of throwing from the load effect"),
      evidence("failed-write rollback", "apps/web/src/features/browsing/favourites/useFavourites.test.tsx", "keeps current state intact and returns an explicit save failure"),
      evidence("account/namespace isolation", "apps/web/src/features/browsing/favourites/useFavourites.test.tsx", "loads atomically by account and never exposes the previous account entries"),
      evidence("idempotent migration", "apps/web/src/features/browsing/favourites/useFavourites.test.tsx", "reloads and rebinds entries when same-ID account metadata changes"),
      evidence("old-data retention until commit", "apps/web/src/features/browsing/favourites/useFavourites.test.tsx", "keeps current state intact and returns an explicit save failure")
    ]
  },
  {
    name: "folder/search cache",
    keys: [FOLDER_CACHE_PREFIX + "<encoded namespace><encoded path>", SEARCH_CACHE_PREFIX + "<encoded namespace><encoded path><encoded query>", V1_FOLDER_CACHE_PREFIX + "<legacy namespace>", V1_SEARCH_CACHE_PREFIX + "<legacy namespace>"],
    versions: ["v2 encoded keys", "v1 legacy keys"],
    owner: "features/browsing/cache/policy and repository",
    evidence: [
      evidence("current round-trip", "apps/web/src/features/browsing/cache/repository.test.ts", "uses collision-safe v2 keys and preserves the envelope format"),
      evidence("oldest supported fixture", "apps/web/src/features/browsing/cache/repository.test.ts", "purges every legacy v1 key at construction and preserves unrelated keys"),
      evidence("malformed/unknown version", "apps/web/src/features/browsing/cache/repository.test.ts", "strictly decodes v2 keys and rejects malformed or noncanonical keys"),
      evidence("failed-write rollback", "apps/web/src/features/browsing/cache/repository.test.ts", "maps unavailable operations to redacted misses, skipped writes, or failed clears"),
      evidence("account/namespace isolation", "apps/web/src/features/browsing/cache/repository.test.ts", "keeps encoded search components and exact namespaces isolated"),
      evidence("idempotent migration", "apps/web/src/features/browsing/cache/repository.test.ts", "does not let the marker suppress later scans and attempts every v1 deletion"),
      evidence("old-data retention until commit", "apps/web/src/features/browsing/cache/repository.test.ts", "treats marker write failure as audit-only and still clears successfully")
    ]
  },
  {
    name: "opened-file index and blobs",
    keys: [openedFileIndexKey("<namespace>"), openedFileBlobKey("<namespace>", "<path>"), "davora-opened-file:index:<legacy namespace>", "davora-opened-file:<legacy namespace>:<path>:blob"],
    versions: ["v2 index/blob keys", "v1 legacy index/blob keys"],
    owner: "platform/storage/openedFileRepository",
    evidence: [
      evidence("current round-trip", "apps/web/src/platform/storage/openedFileRepository.test.ts", "reports missing blobs as metadata-only and keeps same-root writes idempotent"),
      evidence("oldest supported fixture", "apps/web/src/platform/storage/openedFileRepository.test.ts", "migrates valid legacy facts once and isolates malformed siblings"),
      evidence("malformed/unknown version", "apps/web/src/platform/storage/openedFileRepository.test.ts", "fails closed for malformed V2 keys and never deletes them during purge"),
      evidence("failed-write rollback", "apps/web/src/platform/storage/openedFileRepository.test.ts", "reports migration persistence failure without deleting legacy data"),
      evidence("account/namespace isolation", "apps/web/src/platform/storage/openedFileRepository.test.ts", "keeps retained files through normal cache clear and isolates namespaces"),
      evidence("idempotent migration", "apps/web/src/platform/storage/openedFileRepository.test.ts", "migrates valid legacy facts once and isolates malformed siblings"),
      evidence("old-data retention until commit", "apps/web/src/platform/storage/openedFileRepository.test.ts", "reports migration persistence failure without deleting legacy data")
    ]
  },
  {
    name: "audio resume positions",
    keys: ["davora-audio-preview-position:<accountId>:<path>"],
    versions: ["unversioned finite positive number string"],
    owner: "lib/audioResume and preview audio ports",
    evidence: [
      evidence("current round-trip", "apps/web/src/lib/audioResume.test.ts", "stores positions per account and path"),
      evidence("oldest supported fixture", "apps/web/src/lib/audioResume.test.ts", "stores positions per account and path"),
      evidence("malformed/unknown version", "apps/web/src/lib/audioResume.test.ts", "treats unusable values as unavailable resume state"),
      evidence("failed-write rollback", "apps/web/src/lib/audioResume.test.ts", "treats unusable values as unavailable resume state"),
      evidence("account/namespace isolation", "apps/web/src/lib/audioResume.test.ts", "stores positions per account and path"),
      evidence("idempotent migration", "apps/web/src/lib/audioResume.test.ts", "stores positions per account and path"),
      evidence("old-data retention until commit", "apps/web/src/lib/audioResume.test.ts", "stores positions per account and path")
    ]
  },
  {
    name: "folder-audio state",
    keys: [AUDIO_PLAYLIST_PREFIX + "<accountId>:<encoded folder path>"],
    versions: ["unversioned normalized playlist state"],
    owner: "features/preview/folderAudio model and player",
    evidence: [
      evidence("current round-trip", "apps/web/src/features/preview/folderAudio/useFolderAudioPlayer.test.tsx", "persists and restores playlist state until dismissed"),
      evidence("oldest supported fixture", "apps/web/src/features/preview/folderAudio/model.test.ts", "normalizes persisted playlist state and rejects invalid payloads"),
      evidence("malformed/unknown version", "apps/web/src/features/preview/folderAudio/model.test.ts", "normalizes persisted playlist state and rejects invalid payloads"),
      evidence("failed-write rollback", "apps/web/src/features/preview/folderAudio/useFolderAudioPlayer.test.tsx", "persists and restores playlist state until dismissed"),
      evidence("account/namespace isolation", "apps/web/src/features/preview/folderAudio/useFolderAudioPlayer.lifecycle.characterization.test.tsx", "T18a account change isolates persisted resume positions and current controls"),
      evidence("idempotent migration", "apps/web/src/features/preview/folderAudio/model.test.ts", "builds stable playlist storage keys"),
      evidence("old-data retention until commit", "apps/web/src/features/preview/folderAudio/useFolderAudioPlayer.test.tsx", "persists and restores playlist state until dismissed")
    ]
  },
  {
    name: "folder sort overrides",
    keys: [FOLDER_SORT_STORAGE_PREFIX + "<encoded namespace><encoded canonical path>"],
    versions: ["unversioned validated sort-mode string"],
    owner: "features/browsing/folderSort policy and service",
    evidence: [
      evidence("current round-trip", "apps/web/src/features/browsing/folderSort/service.test.ts", "round-trips folder sort overrides within a namespace"),
      evidence("oldest supported fixture", "apps/web/src/features/browsing/folderSort/policy.test.ts", "round-trips namespace and path including separators and colons"),
      evidence("malformed/unknown version", "apps/web/src/features/browsing/folderSort/service.test.ts", "treats corrupt stored values as absent and removes the bad key"),
      evidence("failed-write rollback", "apps/web/src/features/browsing/folderSort/useFolderSort.test.tsx", "applies the sort for the session and reports failure when the write fails"),
      evidence("account/namespace isolation", "apps/web/src/features/browsing/folderSort/service.test.ts", "clears only the target namespace and preserves unrelated keys"),
      evidence("idempotent migration", "apps/web/src/features/browsing/folderSort/useFolderSort.test.tsx", "converges saved sorts without extra renders under StrictMode"),
      evidence("old-data retention until commit", "apps/web/src/features/browsing/folderSort/useFolderSort.test.tsx", "reports clear failures and keeps stored overrides")
    ]
  },
  {
    name: "encrypted Worker account state",
    keys: ["davora-account-store (Durable Object object name)", "configured local account-state file"],
    versions: ["encrypted envelope v1", "encrypted envelope v2", "payload v1", "payload v2", "revisioned CAS"],
    owner: "apps/worker/src/accounts codec, repository, local and Durable Object storage",
    evidence: [
      evidence("current round-trip", "apps/worker/tests/accounts/account-repository.test.ts", "retries a concurrent mutation without losing either account"),
      evidence("oldest supported fixture", "apps/worker/tests/accounts/account-application.integration.test.ts", "migrates legacy durable account state before issuing a session"),
      evidence("malformed/unknown version", "apps/worker/tests/accounts/account-repository.test.ts", "fails closed without replacing corrupt encrypted state"),
      evidence("failed-write rollback", "apps/worker/tests/accounts/account-application.integration.test.ts", "keeps runtime and durable accounts plus existing bearer sessions when DELETE persistence fails"),
      evidence("account/namespace isolation", "apps/worker/tests/accounts/account-repository.property.test.ts", "rejects foreign account mutations without changing any account and keeps revocation terminal"),
      evidence("idempotent migration", "apps/worker/tests/accounts/account-repository.test.ts", "migrates legacy-key state through CAS before returning it"),
      evidence("old-data retention until commit", "apps/worker/tests/accounts/account-repository.test.ts", "upgrades a legacy local encrypted file to a revisioned CAS envelope")
    ]
  }
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertEvidenceTitle(item: Evidence): void {
  const source = readFileSync(resolve(repoRoot, item.file), "utf8");
  const title = escapeRegExp(item.title);
  expect(source, `${item.file} is missing the mapped ${item.criterion} title`).toMatch(new RegExp(`\\b(?:it|test)\\(\\s*[\\"']${title}[\\"']`));
}

function createMapStorage(initial: Record<string, string> = {}, failWrites = false): BrowserStringStorage & BrowsingCacheStorage {
  const values = new Map(Object.entries(initial));
  const result = <T>(value: T): BrowserStorageResult<T> => ({ ok: true, value });
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { if (failWrites) throw new Error("injected write failure"); values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    readItem: (key) => result(values.get(key) ?? null),
    writeItem: (key, value) => { if (failWrites) return { ok: false, error: new Error("injected write failure") }; values.set(key, value); return result(undefined); },
    deleteItem: (key) => { values.delete(key); return result(undefined); },
    keys: () => [...values.keys()],
    listKeys: () => result([...values.keys()])
  };
}

describe("persisted-data compatibility matrix", () => {
  for (const shape of persistedShapes) {
    it(`${shape.name} enumerates exact keys, versions, owner, and all compatibility evidence`, () => {
      expect(shape.keys.length, `${shape.name} must enumerate at least one live key`).toBeGreaterThan(0);
      expect(shape.versions.length, `${shape.name} must enumerate supported versions`).toBeGreaterThan(0);
      expect(shape.owner).toBeTruthy();
      expect(new Set(shape.evidence.map((item) => item.criterion))).toEqual(new Set<EvidenceCriterion>([
        "current round-trip",
        "oldest supported fixture",
        "malformed/unknown version",
        "failed-write rollback",
        "account/namespace isolation",
        "idempotent migration",
        "old-data retention until commit"
      ]));
      shape.evidence.forEach(assertEvidenceTitle);
    });
  }

  it("retains the previous committed browser value when an IndexedDB transaction is interrupted", async () => {
    const store = createStore("davora-wave3-persisted-compatibility", "values");
    await clear(store);
    await set("stable", "old", store);

    await expect(store("readwrite", (objectStore) => {
      objectStore.put("new", "stable");
      objectStore.transaction.abort();
      throw new Error("interrupted transaction");
    })).rejects.toThrow("interrupted transaction");

    expect(await get("stable", store)).toBe("old");
    await clear(store);
  });

  it("commits concurrent IndexedDB namespaces independently", async () => {
    const store = createStore("davora-wave3-persisted-compatibility", "values");
    await clear(store);
    await Promise.all([
      set("namespace-a", { owner: "alpha", value: "A" }, store),
      set("namespace-b", { owner: "beta", value: "B" }, store)
    ]);
    expect(await get("namespace-a", store)).toEqual({ owner: "alpha", value: "A" });
    expect(await get("namespace-b", store)).toEqual({ owner: "beta", value: "B" });
    await clear(store);
  });

  it("keeps browser account and cache namespaces isolated after a failed write", () => {
    const storage = createMapStorage({ [EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY]: '["alpha"]' }, true);
    const offline = createBrowserExplicitOfflineModeStorage(storage);
    expect(offline.commit("beta", true).kind).toBe("failed");
    expect(storage.getItem(EXPLICIT_OFFLINE_ACCOUNTS_STORAGE_KEY)).toBe('["alpha"]');

    const cacheStorage = createMapStorage();
    const cache = createBrowsingCacheRepository(cacheStorage, { nowIso: () => "2026-09-01T00:00:00.000Z" });
    const alpha = [buildFileEntry("docs/alpha.txt")];
    const beta = [buildFileEntry("docs/beta.txt")];
    expect(cache.writeFolder("alpha", "docs", alpha)).toEqual({ kind: "written" });
    expect(cache.writeFolder("beta", "docs", beta)).toEqual({ kind: "written" });
    expect(cache.readFolder("alpha", "docs")).toMatchObject({ kind: "hit", items: alpha });
    expect(cache.readFolder("beta", "docs")).toMatchObject({ kind: "hit", items: beta });
    expect(cache.clearNamespace("alpha")).toEqual({ kind: "cleared" });
    expect(cache.readFolder("alpha", "docs")).toEqual({ kind: "miss" });
    expect(cache.readFolder("beta", "docs")).toMatchObject({ kind: "hit", items: beta });
  });

  it("preserves account registry state when its next commit fails", () => {
    const storage = createMapStorage({}, true);
    const registry = createAccountRegistryService({
      readItem: (key) => storage.readItem(key),
      writeItem: (key, value) => storage.writeItem(key, value),
      deleteItem: (key) => storage.deleteItem(key)
    });
    expect(registry.getSnapshot()).toEqual({ accounts: [] });
    expect(registry.commitConnectedAccount({
      id: "alpha",
      type: "nextcloud",
      label: "Alpha",
      displayName: "Alpha",
      baseUrl: "https://alpha.example.com",
      username: "alpha",
      rootPath: "",
      backend: "mock",
      connectionState: "connected",
      lastValidatedAt: "2026-09-01T00:00:00.000Z",
      cacheNamespace: "alpha"
    })).toMatchObject({ kind: "failed" });
    expect(registry.getSnapshot()).toEqual({ accounts: [] });
  });
});
