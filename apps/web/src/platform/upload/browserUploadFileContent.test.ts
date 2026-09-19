import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserUploadFileContent } from "./browserUploadFileContent";

class FakeFileReader {
  static instances: FakeFileReader[] = [];
  static readError: unknown;
  result: string | null = null;
  error: DOMException | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: ((event: { readonly loaded: number; readonly total: number }) => void) | null = null;
  readAsDataURL = vi.fn();
  abort = vi.fn(() => this.onabort?.());

  constructor() {
    FakeFileReader.instances.push(this);
    this.readAsDataURL.mockImplementation(() => {
      if (FakeFileReader.readError !== undefined) {
        throw FakeFileReader.readError;
      }
    });
  }
}

function expectReaderCleaned(reader: FakeFileReader) {
  expect(reader.onload).toBeNull();
  expect(reader.onerror).toBeNull();
  expect(reader.onabort).toBeNull();
  expect(reader.onprogress).toBeNull();
}

function trackedSignal() {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  return { controller, signal: controller.signal, add, remove };
}

function expectAbortListenerCleaned(
  add: ReturnType<typeof vi.spyOn>,
  remove: ReturnType<typeof vi.spyOn>
) {
  const listener = add.mock.calls.find(([type]) => type === "abort")?.[1];
  expect(listener).toBeTypeOf("function");
  expect(remove).toHaveBeenCalledWith("abort", listener);
}

describe("browser upload file content", () => {
  beforeEach(() => {
    FakeFileReader.instances = [];
    FakeFileReader.readError = undefined;
    vi.stubGlobal("FileReader", FakeFileReader);
  });

  it("strips only the data URL prefix and forwards progress", async () => {
    const progress = vi.fn(() => true);
    const { signal, add, remove } = trackedSignal();
    const promise = createBrowserUploadFileContent().prepare(
      new File(["secret"], "secret.txt", { type: "text/plain" }),
      progress,
      signal
    );
    const reader = FakeFileReader.instances[0];
    reader.onprogress?.({ loaded: 3, total: 6 });
    reader.result = "data:text/plain;base64,YWJj";
    reader.onload?.();

    await expect(promise).resolves.toEqual({ kind: "prepared", contentBase64: "YWJj" });
    expect(progress).toHaveBeenCalledWith(3, 6);
    expectReaderCleaned(reader);
    expectAbortListenerCleaned(add, remove);
  });

  it("does not start a read when the signal is already aborted", async () => {
    const { controller, signal } = trackedSignal();
    controller.abort();
    const promise = createBrowserUploadFileContent().prepare(
      new File(["secret"], "secret.txt"),
      vi.fn(() => true),
      signal
    );
    await expect(promise).resolves.toEqual({ kind: "failed", message: "Aborted" });
    const reader = FakeFileReader.instances.at(-1)!;
    expect(reader.readAsDataURL).not.toHaveBeenCalled();
    expect(reader.abort).not.toHaveBeenCalled();
    expectReaderCleaned(reader);
  });

  it("aborts and settles when progress cancellation is requested", async () => {
    const { signal, add, remove } = trackedSignal();
    const promise = createBrowserUploadFileContent().prepare(
      new File(["secret"], "secret.txt"),
      vi.fn(() => false),
      signal
    );
    const reader = FakeFileReader.instances.at(-1)!;
    reader.onprogress?.({ loaded: 1, total: 6 });

    await expect(promise).resolves.toEqual({ kind: "failed", message: "Aborted" });
    expect(reader.abort).toHaveBeenCalledTimes(1);
    expectReaderCleaned(reader);
    expectAbortListenerCleaned(add, remove);
  });

  it("aborts on a mid-read signal and removes every handler and listener", async () => {
    const { controller, signal, add, remove } = trackedSignal();
    const promise = createBrowserUploadFileContent().prepare(
      new File(["secret"], "secret.txt"),
      vi.fn(() => true),
      signal
    );
    const reader = FakeFileReader.instances.at(-1)!;
    controller.abort();

    await expect(promise).resolves.toEqual({ kind: "failed", message: "Aborted" });
    expect(reader.abort).toHaveBeenCalledTimes(1);
    expectReaderCleaned(reader);
    expectAbortListenerCleaned(add, remove);
  });

  it("contains reader failures without exposing file content", async () => {
    const { signal, add, remove } = trackedSignal();
    const promise = createBrowserUploadFileContent().prepare(
      new File(["secret-content"], "secret.txt"),
      vi.fn(() => false),
      signal
    );
    const reader = FakeFileReader.instances.at(-1)!;
    reader.error = new DOMException("secret-content leaked", "NotReadableError");
    reader.onerror?.();
    await expect(promise).resolves.toEqual({ kind: "failed", message: "Unable to read upload file." });
    expectReaderCleaned(reader);
    expectAbortListenerCleaned(add, remove);
  });

  it("sanitizes synchronous read failures and cleans up", async () => {
    FakeFileReader.readError = new Error("secret-content leaked from sync read");
    const { signal, add, remove } = trackedSignal();
    const promise = createBrowserUploadFileContent().prepare(
      new File(["secret-content"], "secret.txt"),
      vi.fn(() => true),
      signal
    );

    await expect(promise).resolves.toEqual({ kind: "failed", message: "Unable to read upload file." });
    const reader = FakeFileReader.instances.at(-1)!;
    expectReaderCleaned(reader);
    expectAbortListenerCleaned(add, remove);
  });

  it("leaves callbacks captured before settlement inert", async () => {
    const progress = vi.fn(() => false);
    const { signal } = trackedSignal();
    const promise = createBrowserUploadFileContent().prepare(
      new File(["secret"], "secret.txt"),
      progress,
      signal
    );
    const reader = FakeFileReader.instances.at(-1)!;
    const lateProgress = reader.onprogress!;
    const lateError = reader.onerror!;
    reader.result = "data:text/plain;base64,YWJj";
    reader.onload?.();
    await expect(promise).resolves.toEqual({ kind: "prepared", contentBase64: "YWJj" });

    lateProgress({ loaded: 2, total: 4 });
    lateError();
    expect(progress).not.toHaveBeenCalled();
    expect(reader.abort).not.toHaveBeenCalled();
  });
});
