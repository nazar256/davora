import type { FileEntry } from "@davora/shared";
import { describe, expect, it, vi } from "vitest";

import { createOperationContextToken } from "../policy";
import type { CopyMovePickerSnapshot } from "./model";
import { runCopyMoveSubmitOrchestration } from "./orchestration";
import type { CopyMoveOrchestrationPorts } from "./orchestrationPorts";
import type { CopyMoveTaskSpec } from "./tasks";
import { issueMutationAttemptToken } from "../mutation/attempt";

function ownership(context = createOperationContextToken()) {
  const attempt = issueMutationAttemptToken({
    workflowIdentity: 1, context, path: "", pathGeneration: 0, ownershipGeneration: 0,
    mountGeneration: 1, domainIdentity: "test", intent: { kind: "copy", count: 1 }
  });
  return {
    attempt,
    completeDestination: vi.fn(() => true),
    failAttempt: vi.fn()
  };
}

function entry(path: string): FileEntry {
  return { path, name: path.split("/").pop() ?? path, isFolder: false };
}

function resolved(source: FileEntry, destinationPath: string, options: { overwrite?: boolean; merge?: boolean } = {}) {
  return { source, destinationPath, overwrite: options.overwrite ?? false, merge: options.merge ?? false };
}

function picker(overrides: Partial<CopyMovePickerSnapshot> = {}): CopyMovePickerSnapshot {
  const context = overrides.context ?? createOperationContextToken();
  return {
    context,
    kind: "copyMove",
    sourceEntries: [entry("notes.txt")],
    batch: false,
    folderPath: "Archive",
    name: "notes.txt",
    nameEdited: false,
    manualPath: "Archive/notes.txt",
    manualMode: false,
    entries: [],
    loading: false,
    ...overrides
  };
}

type MutableFixture = CopyMoveOrchestrationPorts & {
  setContextAllowed(next: boolean): void;
  enqueued: CopyMoveTaskSpec[];
};

function ports(overrides: Partial<CopyMoveOrchestrationPorts> = {}): MutableFixture {
  const enqueued: CopyMoveTaskSpec[] = [];
  let contextAllowed = true;
  const defaultPorts: CopyMoveOrchestrationPorts = {
    context: {
      isCurrentOperationContext: vi.fn(() => true),
      isContextAllowed: vi.fn(() => contextAllowed)
    },
    presentation: {
      setActionError: vi.fn(),
      setStatus: vi.fn()
    },
    labels: {
      toDisplayPath: (path: string) => `/${path}`
    },
    tasks: {
      enqueue: vi.fn((spec: CopyMoveTaskSpec) => {
        enqueued.push(spec);
      })
    }
  };

  const fixture: MutableFixture = {
    ...defaultPorts,
    ...overrides,
    context: { ...defaultPorts.context, ...overrides.context },
    presentation: { ...defaultPorts.presentation, ...overrides.presentation },
    labels: { ...defaultPorts.labels, ...overrides.labels },
    tasks: overrides.tasks ?? defaultPorts.tasks,
    enqueued,
    setContextAllowed(next: boolean) {
      contextAllowed = next;
    }
  };

  fixture.context.isContextAllowed = vi.fn(() => contextAllowed);
  if (!overrides.tasks) {
    fixture.tasks.enqueue = vi.fn((spec: CopyMoveTaskSpec) => {
      enqueued.push(spec);
    });
  }

  return fixture;
}

describe("runCopyMoveSubmitOrchestration", () => {
  it("enqueues a single copy task, dismisses the picker, and announces the queued status", () => {
    const adapter = ports();
    const currentPicker = picker();
    const owner = ownership(currentPicker.context);

    runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive/notes.txt",
      targets: [resolved(entry("notes.txt"), "Archive/notes.txt")],
      skipped: [],
      applySizeRule: true,
      accountId: "account-1",
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.enqueued).toHaveLength(1);
    const spec = adapter.enqueued[0];
    expect(spec).toMatchObject({
      operation: "copy",
      destinationPath: "Archive/notes.txt",
      accountId: "account-1",
      accountName: "Workspace",
      context: currentPicker.context,
      intent: { kind: "copy", count: 1 },
      label: "notes.txt",
      skipped: [],
      targets: [{ destinationPath: "Archive/notes.txt", mode: "write" }]
    });
    expect(spec?.targets[0]?.source.path).toBe("notes.txt");
    expect(owner.completeDestination).toHaveBeenCalledWith(owner.attempt, currentPicker.context);
    expect(adapter.presentation.setStatus).toHaveBeenCalledWith("Copying 1 item to /Archive/notes.txt in Workspace…");
  });

  it("enqueues a batch move with mapped target modes and an item-count label", () => {
    const adapter = ports();
    const currentPicker = picker({ batch: true, sourceEntries: [entry("a.txt"), entry("b.txt"), entry("Docs")] });
    const owner = ownership(currentPicker.context);
    const folderSource = { ...entry("Docs"), isFolder: true };

    runCopyMoveSubmitOrchestration({
      operation: "move",
      picker: currentPicker,
      destinationPath: "Archive",
      targets: [
        resolved(entry("a.txt"), "Archive/a.txt", { overwrite: true }),
        resolved(entry("b.txt"), "Archive/b (1).txt"),
        resolved(folderSource, "Archive/Docs", { merge: true })
      ],
      skipped: [entry("c.txt")],
      applySizeRule: true,
      accountId: "account-1",
      accountName: "Workspace",
      ...owner
    }, adapter);

    const spec = adapter.enqueued[0];
    expect(spec).toMatchObject({
      operation: "move",
      label: "3 items",
      intent: { kind: "move", count: 3 },
      applySizeRule: true
    });
    expect(spec?.targets.map((target) => target.mode)).toEqual(["overwrite", "write", "merge"]);
    expect(spec?.skipped.map((item) => item.path)).toEqual(["c.txt"]);
    expect(adapter.presentation.setStatus).toHaveBeenCalledWith("Moving 4 items to /Archive in Workspace…");
  });

  it("does not enqueue or dismiss when the picker context is no longer allowed", () => {
    const adapter = ports();
    adapter.setContextAllowed(false);
    const currentPicker = picker();
    const owner = ownership(currentPicker.context);

    runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive/notes.txt",
      targets: [resolved(entry("notes.txt"), "Archive/notes.txt")],
      skipped: [],
      applySizeRule: true,
      accountId: "account-1",
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.enqueued).toHaveLength(0);
    expect(owner.completeDestination).not.toHaveBeenCalled();
    expect(owner.failAttempt).toHaveBeenCalledWith(owner.attempt, "This action is no longer available.");
    expect(adapter.presentation.setStatus).not.toHaveBeenCalled();
  });

  it("refuses to enqueue without an account id", () => {
    const adapter = ports();
    const currentPicker = picker();
    const owner = ownership(currentPicker.context);

    runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive/notes.txt",
      targets: [resolved(entry("notes.txt"), "Archive/notes.txt")],
      skipped: [],
      applySizeRule: true,
      accountId: undefined,
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(adapter.enqueued).toHaveLength(0);
    expect(owner.failAttempt).toHaveBeenCalledWith(owner.attempt, "This action needs an active account.");
    expect(owner.completeDestination).not.toHaveBeenCalled();
  });

  it("fails the attempt when the task enqueue throws", () => {
    const adapter = ports();
    adapter.tasks.enqueue = vi.fn(() => {
      throw new Error("ledger unavailable");
    });
    const currentPicker = picker();
    const owner = ownership(currentPicker.context);

    runCopyMoveSubmitOrchestration({
      operation: "copy",
      picker: currentPicker,
      destinationPath: "Archive",
      targets: [resolved(entry("notes.txt"), "Archive/notes.txt")],
      skipped: [],
      applySizeRule: false,
      accountId: "account-1",
      accountName: "Workspace",
      ...owner
    }, adapter);

    expect(owner.failAttempt).toHaveBeenCalledWith(owner.attempt, "ledger unavailable");
    expect(owner.completeDestination).not.toHaveBeenCalled();
    expect(adapter.presentation.setStatus).not.toHaveBeenCalled();
  });
});
