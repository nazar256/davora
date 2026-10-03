import { describe, expect, it } from "vitest";

import { buildFileEntry } from "../../../test/files";
import { selectSearchCoverage } from "./selectors";
import { searchReducer, type SearchRequest } from "./model";

const request = (generation: number): SearchRequest => ({
  key: { accountId: "account", cacheNamespace: "namespace", path: "Docs", query: "report" },
  generation,
  contextToken: {}
});

describe("search model", () => {
  it("masks old results as soon as a replacement request starts", () => {
    const first = request(1);
    const item = { ...buildFileEntry("Docs/old.txt"), score: 1 };
    const ready = searchReducer(
      searchReducer({ kind: "inactive" }, { type: "request-started", request: first }),
      { completeness: "complete" as const, type: "live-response-accepted", request: first, items: [item] }
    );

    expect(searchReducer(ready, { type: "request-started", request: request(2) }))
      .toEqual({ kind: "searching", request: request(2) });
  });

  it("ignores outcomes from superseded requests", () => {
    const current = request(2);
    const state = { kind: "searching", request: current } as const;
    expect(searchReducer(state, {
      completeness: "complete",
      type: "live-response-accepted",
      request: request(1),
      items: [{ ...buildFileEntry("Docs/late.txt"), score: 1 }]
    })).toBe(state);
  });

  it("represents live, cached fallback, offline, failed, and cancelled outcomes explicitly", () => {
    const current = request(1);
    const started = searchReducer({ kind: "inactive" }, { type: "request-started", request: current });
    const items = [{ ...buildFileEntry("Docs/a.txt"), score: 1 }];
    expect(searchReducer(started, { completeness: "complete" as const, type: "live-response-accepted", request: current, items }).kind).toBe("ready");
    expect(searchReducer(started, { type: "cached-fallback-shown", request: current, items }).kind).toBe("fallback");
    expect(searchReducer(started, { type: "explicit-offline-shown", request: current, items }).kind).toBe("offline");
    expect(searchReducer(started, { type: "load-failed", request: current }).kind).toBe("failed");
    expect(searchReducer(started, { type: "request-cancelled", request: current })).toEqual({ kind: "inactive" });
  });
});

it("carries accepted completeness and never reuses it for local, loading or failed coverage", () => {
  const current = request(1);
  const started = searchReducer({ kind: "inactive" }, { type: "request-started", request: current });
  const live = searchReducer(started, { type: "live-response-accepted", request: current, items: [], completeness: "partial" });
  expect(selectSearchCoverage(live)).toBe("partial");
  expect(selectSearchCoverage(searchReducer(live, { type: "request-started", request: current }))).toBe("searching");
  expect(selectSearchCoverage(searchReducer(started, { type: "cached-fallback-shown", request: current, items: [] }))).toBe("saved");
  expect(selectSearchCoverage(searchReducer(started, { type: "explicit-offline-shown", request: current, items: [] }))).toBe("offline");
  expect(selectSearchCoverage(searchReducer(started, { type: "load-failed", request: current }))).toBe("failed");
  for (const key of [{ ...current.key, accountId: "other" }, { ...current.key, path: "Elsewhere" }, { ...current.key, query: "other" }]) {
    expect(searchReducer(started, { type: "live-response-accepted", request: { ...current, key }, items: [], completeness: "complete" })).toBe(started);
  }
});
