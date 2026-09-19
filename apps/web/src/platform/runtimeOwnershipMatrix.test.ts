import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type Terminal = "success" | "failure" | "abort" | "replacement" | "unmount";

interface Evidence {
  readonly file: string;
  readonly title: string;
}

interface NotApplicable {
  readonly reason: string;
}

type Coverage = Evidence | NotApplicable;

interface ResourceRow {
  readonly id: string;
  readonly producers: readonly string[];
  readonly terminals: Readonly<Record<Terminal, Coverage>>;
  readonly release: Coverage;
  readonly lateCallback: Coverage;
}

interface RaceRow {
  readonly id: string;
  readonly evidence: readonly Evidence[];
}

const evidence = (file: string, title: string): Evidence => ({ file, title });
const notApplicable = (reason: string): NotApplicable => ({ reason });

const resourceRows: readonly ResourceRow[] = [
  {
    id: "fetch-abort-controller",
    producers: ["src/lib/api.ts", "src/features/browsing/folder/useFolder.ts", "src/features/preview/pdf/usePdfPreviewInteraction.ts"],
    terminals: {
      success: evidence("src/api-contract.test.ts", "validates search responses and forwards cancellation"),
      failure: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T07 current fetch, HTTP, arrayBuffer, and pdf.js failures report once"),
      abort: evidence("src/api-contract.test.ts", "propagates one abort signal through direct-download metadata and body requests"),
      replacement: evidence("src/features/browsing/folder/useFolder.test.tsx", "aborts a replaced path and ignores its late response"),
      unmount: evidence("src/features/browsing/folder/useFolder.test.tsx", "aborts active work on unmount")
    },
    release: evidence("src/features/operations/context/model.test.ts", "registers and releases abort requests exactly once"),
    lateCallback: evidence("src/features/browsing/workspace/useBrowsingWorkspace.test.tsx", "keeps superseded late folder outcomes inert and exposes stable commands under StrictMode")
  },
  {
    id: "progressive-xhr",
    producers: ["src/lib/api.ts"],
    terminals: {
      success: evidence("src/api-contract.test.ts", "releases progressive XHR ownership exactly once and ignores late progress after success"),
      failure: evidence("src/api-contract.test.ts", "keeps progressive XHR failure and abort terminals inert for late callbacks"),
      abort: evidence("src/api-contract.test.ts", "keeps progressive XHR failure and abort terminals inert for late callbacks"),
      replacement: evidence("src/features/operations/upload/AppUploadIntegration.test.tsx", "aborts an in-flight upload when its account, token, and capability owner is replaced"),
      unmount: evidence("src/features/operations/context/useOperationContext.test.ts", "aborts every registered request on unmount")
    },
    release: evidence("src/api-contract.test.ts", "releases progressive XHR ownership exactly once and ignores late progress after success"),
    lateCallback: evidence("src/api-contract.test.ts", "keeps progressive XHR failure and abort terminals inert for late callbacks")
  },
  {
    id: "file-reader",
    producers: ["src/platform/upload/browserUploadFileContent.ts"],
    terminals: {
      success: evidence("src/platform/upload/browserUploadFileContent.test.ts", "strips only the data URL prefix and forwards progress"),
      failure: evidence("src/platform/upload/browserUploadFileContent.test.ts", "contains reader failures without exposing file content"),
      abort: evidence("src/platform/upload/browserUploadFileContent.test.ts", "aborts on a mid-read signal and removes every handler and listener"),
      replacement: evidence("src/features/operations/upload/AppUploadIntegration.test.tsx", "aborts an in-flight upload when navigation changes its owning folder"),
      unmount: evidence("src/features/operations/context/useOperationContext.test.ts", "aborts every registered request on unmount")
    },
    release: evidence("src/platform/upload/browserUploadFileContent.test.ts", "aborts on a mid-read signal and removes every handler and listener"),
    lateCallback: evidence("src/platform/upload/browserUploadFileContent.test.ts", "leaves callbacks captured before settlement inert")
  },
  {
    id: "timer",
    producers: ["src/features/preview/video/useVideoPreviewInteraction.ts", "src/platform/pwa/browserPwaPorts.ts"],
    terminals: {
      success: evidence("src/features/preview/video/useVideoPreviewInteraction.lifecycle.characterization.test.tsx", "T07 current streaming retry uses the bounded delays, one current callback, and one retry URL per attempt"),
      failure: notApplicable("Timer callbacks do not reject; the callback-owned operation supplies its failure terminal."),
      abort: evidence("src/platform/pwa/browserPwaPorts.test.ts", "fires the timeout fallback once and cancellation prevents late readiness"),
      replacement: evidence("src/features/preview/video/useVideoPreviewInteraction.lifecycle.characterization.test.tsx", "T10 an old timer cannot consume or clear a replacement timer identity"),
      unmount: evidence("src/features/preview/video/useVideoPreviewInteraction.lifecycle.characterization.test.tsx", "T09 unmount retires the timer and the old callback cannot mutate a newly mounted owner")
    },
    release: evidence("src/platform/pwa/browserPwaPorts.test.ts", "waits for controllerchange once, clears the timeout, and removes its listener"),
    lateCallback: evidence("src/features/preview/video/useVideoPreviewInteraction.lifecycle.characterization.test.tsx", "T22 manual retry clears the captured current timer and its queued callback cannot advance the replacement")
  },
  {
    id: "animation-frame",
    producers: ["src/features/preview/pdf/usePdfPreviewInteraction.ts"],
    terminals: {
      success: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T01 current mounted source/port/stage identity starts one pipeline and harmless rerenders do not restart it"),
      failure: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T16 current fetch failure and StrictMode cleanup leave no pending tasks, observers, or frames"),
      abort: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T14a cleanup before the first pre-render frame leaves no render continuation"),
      replacement: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T14c queued post-ready callback is inert after replacement"),
      unmount: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T16 current fetch failure and StrictMode cleanup leave no pending tasks, observers, or frames")
    },
    release: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T14b cleanup between pre-render frames leaves the second continuation inert"),
    lateCallback: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T14c queued post-ready callback is inert after replacement")
  },
  {
    id: "listener-observer",
    producers: ["src/platform/pwa/browserPwaPorts.ts", "src/features/preview/pdf/usePdfPreviewInteraction.ts", "src/features/navigation/useWorkspaceNavigation.ts"],
    terminals: {
      success: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T15b current ready ResizeObserver notification owns the layout restart"),
      failure: notApplicable("DOM listeners and observers do not expose a failure terminal; callback-owned operations do."),
      abort: evidence("src/platform/pwa/browserPwaPorts.test.ts", "fires the timeout fallback once and cancellation prevents late readiness"),
      replacement: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T15 disconnected ResizeObserver callbacks cannot restart a replacement pipeline, while current ready notifications retain layout ownership"),
      unmount: evidence("src/features/navigation/useWorkspaceNavigation.test.ts", "keeps one popstate listener through StrictMode replay and removes it on unmount")
    },
    release: evidence("src/platform/pwa/browserPwaPorts.test.ts", "owns standalone media-query listeners and makes late events inert after unsubscribe"),
    lateCallback: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T15 disconnected ResizeObserver callbacks cannot restart a replacement pipeline, while current ready notifications retain layout ownership")
  },
  {
    id: "object-url",
    producers: ["src/platform/preview/browserPreviewModalRuntime.ts", "src/features/preview/session/usePreviewSession.ts"],
    terminals: {
      success: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "opens non-PDF originals and revokes their URL exactly once after five minutes"),
      failure: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "cleans every allocated URL and popup exactly once when %s fails"),
      abort: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "cancels during the bounded prefix read without allocating or handing off a URL"),
      replacement: evidence("src/features/navigation/AppNavigationIntegration.test.tsx", "applies a popstate dismiss and path change once, revoking preview resources once"),
      unmount: evidence("src/features/preview/shell/useOriginalFileOpen.test.tsx", "cancels exactly once on unmount including under StrictMode replay")
    },
    release: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "wraps PDFs in the established iframe document and revokes source and wrapper exactly once"),
    lateCallback: evidence("src/features/preview/shell/useOriginalFileOpen.test.tsx", "cancels a prior attempt before a second attempt and ignores the first completion")
  },
  {
    id: "heic-worker",
    producers: ["src/lib/heicPreview.ts", "src/workers/heicPreviewWorker.ts"],
    terminals: {
      success: evidence("src/lib/heicPreview.test.ts", "serializes concurrent decodes and keeps late responses from a completed request inert"),
      failure: evidence("src/lib/heicPreview.test.ts", "cleans up worker errors exactly once and recovers with a fresh worker"),
      abort: evidence("src/lib/heicPreview.test.ts", "terminates timed-out HEIC workers and recovers with a fresh worker"),
      replacement: evidence("src/lib/heicPreview.test.ts", "serializes concurrent decodes and keeps late responses from a completed request inert"),
      unmount: notApplicable("The shared decoder worker is request-scoped rather than React-mounted; request settlement owns termination and listener cleanup.")
    },
    release: evidence("src/lib/heicPreview.test.ts", "cleans up worker errors exactly once and recovers with a fresh worker"),
    lateCallback: evidence("src/lib/heicPreview.test.ts", "makes timeout callbacks and late worker responses inert")
  },
  {
    id: "pdf-loading-render-task",
    producers: ["src/features/preview/pdf/usePdfPreviewInteraction.ts"],
    terminals: {
      success: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T01 current mounted source/port/stage identity starts one pipeline and harmless rerenders do not restart it"),
      failure: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T07 current fetch, HTTP, arrayBuffer, and pdf.js failures report once"),
      abort: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T11 later-page cleanup prevents unowned renders and cancels existing work once"),
      replacement: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T13 source replacement makes old page/render completion inert and preserves replacement ownership"),
      unmount: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T16 current fetch failure and StrictMode cleanup leave no pending tasks, observers, or frames")
    },
    release: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T02 cleanup while loading is pending defers exact destroy for both resolve and reject"),
    lateCallback: evidence("src/features/preview/pdf/usePdfPreviewInteraction.lifecycle.characterization.test.tsx", "T12 active render cleanup cancels once; late resolve/reject is inert while current rejection reports once")
  },
  {
    id: "media-element-stream",
    producers: ["src/features/preview/video/useVideoPreviewInteraction.ts", "src/features/preview/folderAudio/useFolderAudioPlayer.ts"],
    terminals: {
      success: evidence("src/features/preview/folderAudio/useFolderAudioPlayer.lifecycle.characterization.test.tsx", "T01 current activation acquires one stream and autoplay pipeline"),
      failure: evidence("src/features/preview/folderAudio/useFolderAudioPlayer.lifecycle.characterization.test.tsx", "T03 current autoplay rejection exposes the established fallback and manual play remains available"),
      abort: evidence("src/features/preview/video/useVideoPreviewInteraction.lifecycle.characterization.test.tsx", "T23 disable pauses exactly the retiring media once and does not affect a replacement"),
      replacement: evidence("src/features/preview/video/useVideoPreviewInteraction.lifecycle.characterization.test.tsx", "T05 cleanup pauses exactly the retiring media and reports one stop without touching the replacement"),
      unmount: evidence("src/features/preview/video/useVideoPreviewInteraction.lifecycle.characterization.test.tsx", "T24 final unmount pauses exactly the retiring media once and leaves no active timer")
    },
    release: evidence("src/features/preview/folderAudio/useFolderAudioPlayer.lifecycle.characterization.test.tsx", "T20 StrictMode retains one current stream/media owner and quiesces on unmount"),
    lateCallback: evidence("src/features/preview/folderAudio/useFolderAudioPlayer.lifecycle.characterization.test.tsx", "T04 stale stream settlement is inert after track replacement and newer request")
  },
  {
    id: "wake-lock",
    producers: ["src/features/offline/wakeLock/useScreenWakeLock.ts"],
    terminals: {
      success: evidence("src/features/offline/wakeLock/useScreenWakeLock.lifecycle.characterization.test.tsx", "deduplicates reasons and owns one request and sentinel across rerenders"),
      failure: evidence("src/features/offline/wakeLock/useScreenWakeLock.lifecycle.characterization.test.tsx", "reports a current visible rejection as denied"),
      abort: evidence("src/features/offline/wakeLock/useScreenWakeLock.lifecycle.characterization.test.tsx", "releases a late success after hidden visibility without publishing it"),
      replacement: evidence("src/features/offline/wakeLock/useScreenWakeLock.lifecycle.characterization.test.tsx", "does not let an old external release clear a replacement sentinel"),
      unmount: evidence("src/features/offline/wakeLock/useScreenWakeLock.lifecycle.characterization.test.tsx", "releases a late success after unmount without a post-unmount warning")
    },
    release: evidence("src/features/offline/wakeLock/useScreenWakeLock.lifecycle.characterization.test.tsx", "disposes the release listener even when sentinel release rejects"),
    lateCallback: evidence("src/features/offline/wakeLock/useScreenWakeLock.lifecycle.characterization.test.tsx", "keeps the public state projection finite and quiesces all work after unmount")
  },
  {
    id: "popup",
    producers: ["src/platform/preview/browserPreviewModalRuntime.ts", "src/features/preview/shell/useOriginalFileOpen.ts"],
    terminals: {
      success: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "opens non-PDF originals and revokes their URL exactly once after five minutes"),
      failure: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "cleans every allocated URL and popup exactly once when %s fails"),
      abort: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "isolates the popup immediately and makes pending cancellation idempotent, abortable, and late-inert"),
      replacement: evidence("src/features/preview/shell/useOriginalFileOpen.test.tsx", "cancels a prior attempt before a second attempt and ignores the first completion"),
      unmount: evidence("src/features/preview/shell/useOriginalFileOpen.test.tsx", "cancels exactly once on unmount including under StrictMode replay")
    },
    release: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "cleans every allocated URL and popup exactly once when %s fails"),
    lateCallback: evidence("src/platform/preview/browserPreviewModalRuntime.test.ts", "isolates the popup immediately and makes pending cancellation idempotent, abortable, and late-inert")
  },
  {
    id: "indexeddb-transaction",
    producers: ["src/platform/storage/openedFileRepository.ts"],
    terminals: {
      success: evidence("src/platform/storage/persistedCompatibilityMatrix.test.ts", "commits concurrent IndexedDB namespaces independently"),
      failure: evidence("src/platform/storage/persistedCompatibilityMatrix.test.ts", "retains the previous committed browser value when an IndexedDB transaction is interrupted"),
      abort: evidence("src/platform/storage/persistedCompatibilityMatrix.test.ts", "retains the previous committed browser value when an IndexedDB transaction is interrupted"),
      replacement: notApplicable("Repository writes are atomic namespace transactions, not replaceable render owners; later writes start independent transactions."),
      unmount: notApplicable("Repository transactions are command-scoped and intentionally outlive React render ownership.")
    },
    release: notApplicable("IndexedDB releases transaction ownership automatically at complete, abort, or error; the matrix asserts atomic committed state."),
    lateCallback: evidence("src/platform/storage/openedFileRepository.test.ts", "reports migration persistence failure without deleting legacy data")
  }
] as const;

const raceRows: readonly RaceRow[] = [
  {
    id: "account-switch",
    evidence: [
      evidence("src/features/browsing/workspace/browsingQueryLifecycle.characterization.test.tsx", "keeps replaced query/path/account outcomes stale-inert while preserving the raw query until clear"),
      evidence("src/features/operations/download/workspace/AppDownloadIntegration.test.tsx", "contains a late focused download when its account context is replaced")
    ]
  },
  {
    id: "path-switch",
    evidence: [
      evidence("src/features/browsing/folder/useFolder.test.tsx", "aborts a replaced path and ignores its late response"),
      evidence("src/features/operations/upload/AppUploadIntegration.test.tsx", "aborts an in-flight upload when navigation changes its owning folder")
    ]
  },
  {
    id: "stale-request",
    evidence: [evidence("src/features/browsing/workspace/useBrowsingWorkspace.test.tsx", "keeps superseded late folder outcomes inert and exposes stable commands under StrictMode")]
  },
  {
    id: "upload-download-abort",
    evidence: [
      evidence("src/features/operations/upload/AppUploadIntegration.test.tsx", "terminalizes every queued upload and releases the wake lock when a multi-file upload aborts"),
      evidence("src/features/operations/download/workspace/AppDownloadIntegration.test.tsx", "aborts a direct download when its App owner unmounts")
    ]
  },
  {
    id: "duplicate-sync",
    evidence: [evidence("src/features/offline/workspace/AppOfflineApplicationIntegration.test.tsx", "does not enqueue a duplicate background offline sync for the same root")]
  },
  {
    id: "unmount",
    evidence: [
      evidence("src/features/operations/context/useOperationContext.test.ts", "aborts every registered request on unmount"),
      evidence("src/features/preview/folderAudio/useFolderAudioPlayer.lifecycle.characterization.test.tsx", "T20 StrictMode retains one current stream/media owner and quiesces on unmount")
    ]
  },
  {
    id: "back-during-work",
    evidence: [
      evidence("src/features/navigation/AppNavigationIntegration.test.tsx", "applies a popstate dismiss and path change once, revoking preview resources once"),
      evidence("src/features/offline/workspace/AppOfflineCrossFeatureIntegration.test.tsx", "maps browser back to close an automatically opened transfer tray without leaving the folder")
    ]
  },
  {
    id: "media-switch",
    evidence: [
      evidence("src/features/preview/video/useVideoPreviewInteraction.lifecycle.characterization.test.tsx", "T05 cleanup pauses exactly the retiring media and reports one stop without touching the replacement"),
      evidence("src/features/preview/folderAudio/useFolderAudioPlayer.lifecycle.characterization.test.tsx", "T09 stale autoplay rejection cannot mark a replacement track blocked")
    ]
  },
  {
    id: "service-worker-update",
    evidence: [
      evidence("src/features/pwa/usePwaPromptState.test.tsx", "guards synchronous duplicate reload commands to one active update and waiter"),
      evidence("src/features/pwa/usePwaPromptState.test.tsx", "cancels the active waiter on unmount and keeps late callbacks inert"),
      evidence("src/features/pwa/usePwaPromptState.test.tsx", "cancels an old waiter before a later reload attempt replaces it")
    ]
  }
] as const;

const requiredResources = [
  "animation-frame",
  "fetch-abort-controller",
  "file-reader",
  "heic-worker",
  "indexeddb-transaction",
  "listener-observer",
  "media-element-stream",
  "object-url",
  "pdf-loading-render-task",
  "popup",
  "progressive-xhr",
  "timer",
  "wake-lock"
] as const;

const requiredRaces = [
  "account-switch",
  "back-during-work",
  "duplicate-sync",
  "media-switch",
  "path-switch",
  "service-worker-update",
  "stale-request",
  "unmount",
  "upload-download-abort"
] as const;

function isEvidence(value: Coverage): value is Evidence {
  return "file" in value;
}

function assertLiveEvidence(value: Coverage): void {
  if (!isEvidence(value)) {
    expect(value.reason.trim().length).toBeGreaterThan(20);
    return;
  }
  expect(value.file).toMatch(/^src\/.+\.test\.tsx?$/);
  const source = readFileSync(resolve(process.cwd(), value.file), "utf8");
  expect(source, `${value.file} must retain exact test title: ${value.title}`).toContain(`"${value.title}"`);
}

describe("runtime ownership evidence matrix", () => {
  it("enumerates every required browser resource producer exactly once", () => {
    expect(resourceRows.map((row) => row.id).sort()).toEqual([...requiredResources]);
    expect(new Set(resourceRows.map((row) => row.id)).size).toBe(resourceRows.length);

    for (const row of resourceRows) {
      expect(row.producers.length).toBeGreaterThan(0);
      for (const producer of row.producers) {
        expect(producer).toMatch(/^src\/.+\.tsx?$/);
        expect(() => readFileSync(resolve(process.cwd(), producer), "utf8")).not.toThrow();
      }
    }
  });

  it("binds every resource terminal, release, and late-callback outcome to live exact evidence or an explicit non-applicability reason", () => {
    const terminals: readonly Terminal[] = ["success", "failure", "abort", "replacement", "unmount"];
    for (const row of resourceRows) {
      expect(Object.keys(row.terminals).sort(), `${row.id} terminal coverage`).toEqual([...terminals].sort());
      for (const terminal of terminals) assertLiveEvidence(row.terminals[terminal]);
      assertLiveEvidence(row.release);
      assertLiveEvidence(row.lateCallback);
    }
  });

  it("binds every required race to live exact test titles", () => {
    expect(raceRows.map((row) => row.id).sort()).toEqual([...requiredRaces]);
    expect(new Set(raceRows.map((row) => row.id)).size).toBe(raceRows.length);
    for (const row of raceRows) {
      expect(row.evidence.length, `${row.id} evidence`).toBeGreaterThan(0);
      for (const item of row.evidence) assertLiveEvidence(item);
    }
  });
});
