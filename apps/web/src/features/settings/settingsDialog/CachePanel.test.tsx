import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CachePanel, type CachePanelProps } from "./CachePanel";

afterEach(cleanup);
const props = (): CachePanelProps => ({ itemCount: 0, totalBytes: 0, limitBytes: 1024, fileSizeDisplayMode: "human", maxCacheableFileSizeBytes: 1024, previewFreshnessIntervalSeconds: 60, imagePreviewPrefetchCount: 1, offlineItems: [], retainedBytes: 9, storageScope: "alpha", onRetryOfflineItem: vi.fn(), onClear: vi.fn(), onRemoveOfflineItem: vi.fn(), onLimitChange: vi.fn(), onMaxCacheableFileSizeChange: vi.fn(), onPreviewFreshnessIntervalChange: vi.fn(), onImagePreviewPrefetchCountChange: vi.fn() });
const row = (readiness: "available" | "incomplete" | "missing" | "empty", recoverable = true) => ({ rootId: readiness, rootPath: "Docs", name: readiness, kind: "folder" as const, fileCount: 2, readableFileCount: 1, totalBytes: 9, readiness, recoverable });
function toggle(open: boolean) {
  const disclosure = screen.getByRole("button", { name: "Storage details" }).closest("details")!;
  disclosure.open = open;
  fireEvent(disclosure, new Event("toggle"));
}
describe("offline settings readiness and storage", () => {
  it("shows quiet saved state and actionable exceptional states without invented totals", () => {
    render(<CachePanel {...props()} offlineItems={[row("available"), row("incomplete"), row("missing"), row("empty")]} />);
    expect(screen.getByLabelText("Saved offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Incomplete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Missing files" })).toBeInTheDocument();
    expect(screen.getByLabelText("No files saved")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Retry offline copy/ })).toHaveLength(2);
    expect(screen.getByText(/1 saved file/)).toBeInTheDocument();
  });
  it("keeps an unrecoverable batch removable and explains reselection", () => {
    render(<CachePanel {...props()} offlineItems={[row("incomplete", false)]} />);
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
    expect(screen.getByText(/Select the items again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Remove offline copy/ })).toBeEnabled();
  });
  it("disables retry behind the backend action gate", () => {
    render(<CachePanel {...props()} retryDisabled offlineItems={[row("incomplete")]} />);
    expect(screen.getByRole("button", { name: /^Retry/ })).toBeDisabled();
  });
  it("estimates only while open, labels origin scope, and refreshes on account/totals changes", async () => {
    const estimateStorage = vi.fn(async () => ({ usage: 0, quota: 1000 }));
    const view = render(<CachePanel {...props()} estimateStorage={estimateStorage} />);
    expect(estimateStorage).not.toHaveBeenCalled();
    toggle(true);
    await screen.findByText(/This browser/);
    expect(screen.getByText(/All accounts and app storage/)).toBeInTheDocument();
    expect(screen.getByText(/Retained originals/)).toHaveTextContent("9 B");
    view.rerender(<CachePanel {...props()} estimateStorage={estimateStorage} storageScope="beta" retainedBytes={15} />);
    await waitFor(() => expect(estimateStorage).toHaveBeenCalledTimes(2));
    toggle(false);
    view.rerender(<CachePanel {...props()} estimateStorage={estimateStorage} storageScope="gamma" />);
    expect(estimateStorage).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, {}, { usage: -1, quota: 2 }, { usage: NaN, quota: 2 }, { usage: 2, quota: 0 }, { usage: 2, quota: Infinity }, { quota: 2 }, { usage: 2 }])("omits unavailable or malformed estimates %j", async (value) => {
    render(<CachePanel {...props()} estimateStorage={async () => value} />);
    toggle(true);
    await act(async () => undefined);
    expect(screen.queryByText(/This browser/)).toBeNull();
    expect(screen.getByText(/Retained originals/)).toHaveTextContent("9 B");
  });
  it("ignores rejection and late estimates after close/reopen or unmount", async () => {
    let resolve!: (value: unknown) => void;
    const estimateStorage = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockRejectedValue(new Error("unavailable"));
    const view = render(<CachePanel {...props()} estimateStorage={estimateStorage} />);
    toggle(true);
    toggle(false);
    toggle(true);
    await act(async () => { resolve({ usage: 42, quota: 100 }); });
    expect(screen.queryByText(/This browser/)).toBeNull();
    view.unmount();
  });
});
