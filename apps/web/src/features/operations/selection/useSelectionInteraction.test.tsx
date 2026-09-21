import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileEntry } from "@davora/shared";

import type { SelectionInteractionPorts } from "./ports";
import { useSelectionInteraction } from "./useSelectionInteraction";

function entry(path: string): FileEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    isFolder: false
  };
}

function createTimerPorts() {
  const timeoutCallbacks: Array<() => void> = [];
  const clearTimeoutMock = vi.fn();
  const setTimeoutMock = vi.fn((callback: () => void, _delayMs: number) => {
    timeoutCallbacks.push(callback);
    return timeoutCallbacks.length;
  });

  return {
    timeoutCallbacks,
    clearTimeoutMock,
    setTimeoutMock,
    timer: {
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock
    }
  };
}

function createPorts(overrides: Partial<SelectionInteractionPorts> = {}) {
  const timer = createTimerPorts();
  const batchToggle = vi.fn();
  const batchSelectAll = vi.fn();
  const batchDeselectPaths = vi.fn();
  const openMobileDetails = vi.fn();
  const closeMobileDetails = vi.fn();
  let selectedEntry: FileEntry | undefined;
  let mobileDetailsOpen = false;

  const ports: SelectionInteractionPorts = {
    timer: timer.timer,
    chrome: {
      isNarrowScreen: () => true,
      isMobileDetailsOpen: () => mobileDetailsOpen,
      openMobileDetails: (options) => {
        mobileDetailsOpen = true;
        openMobileDetails(options);
      },
      closeMobileDetails: () => {
        mobileDetailsOpen = false;
        closeMobileDetails();
      },
    },
    focused: {
      current: () => selectedEntry,
      select: (next) => {
        selectedEntry = next;
      },
      clear: () => {
        selectedEntry = undefined;
      },
      hasSelectedPreview: () => false,
      showMobileActions: vi.fn()
    },
    batch: {
      isSelected: vi.fn(() => false),
      toggle: batchToggle,
      selectAll: batchSelectAll,
      deselectPaths: batchDeselectPaths,
      clear: vi.fn()
    },
    scope: {
      isSearchActive: () => false,
      getCurrentPath: () => "Projects"
    },
    ...overrides
  };

  return {
    ports,
    timer,
    batchToggle,
    batchSelectAll,
    batchDeselectPaths,
    openMobileDetails,
    closeMobileDetails,
    currentFocusedSelection: () => selectedEntry,
    selectFocused: (next: FileEntry) => {
      selectedEntry = next;
    },
    clearFocused: () => { selectedEntry = undefined; },
    setMobileDetailsOpen: (next: boolean) => {
      mobileDetailsOpen = next;
    }
  };
}

function Harness({
  ports,
  canMarkForBatchDownload = true,
  isCurrentOperationHandler = true,
  isMarkBatchAllowed = true,
  onReady
}: {
  ports: SelectionInteractionPorts;
  canMarkForBatchDownload?: boolean;
  isCurrentOperationHandler?: boolean;
  isMarkBatchAllowed?: boolean;
  onReady: (controller: ReturnType<typeof useSelectionInteraction>) => void;
}) {
  const controller = useSelectionInteraction({
    ports,
    isCurrentOperationHandler: () => isCurrentOperationHandler,
    isMarkBatchAllowed: () => isMarkBatchAllowed,
    canMarkForBatchDownload: () => canMarkForBatchDownload
  });
  onReady(controller);
  return (
    <>
      <button type="button" onPointerDown={() => controller.startRowLongPressSelection(entry("Projects/report.pdf"))}>
        Hold row
      </button>
      <button type="button" onPointerUp={() => controller.clearRowLongPressTimer()}>
        Release row
      </button>
      <output data-testid="suppressed">{String(controller.getRowOpenSuppressed())}</output>
    </>
  );
}

describe("useSelectionInteraction", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("schedules a 450ms long-press timer only on narrow screens with batch download enabled", () => {
    const fixture = createPorts();
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    render(
      <Harness
        ports={fixture.ports}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      controller?.startRowLongPressSelection(entry("Projects/report.pdf"));
    });

    expect(fixture.timer.setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 450);
    expect(fixture.batchToggle).not.toHaveBeenCalled();
  });

  it("does not schedule long-press when batch download is unavailable", () => {
    const fixture = createPorts();
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    render(
      <Harness
        ports={fixture.ports}
        canMarkForBatchDownload={false}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      controller?.startRowLongPressSelection(entry("Projects/report.pdf"));
    });

    expect(fixture.timer.setTimeoutMock).not.toHaveBeenCalled();
  });

  it("clears the timer on pointer up and suppresses open while handled after timer fire", () => {
    const fixture = createPorts();
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    render(
      <Harness
        ports={fixture.ports}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /Hold row/i }));
    expect(fixture.timer.setTimeoutMock).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(screen.getByRole("button", { name: /Release row/i }));
    expect(fixture.timer.clearTimeoutMock).toHaveBeenCalled();

    act(() => {
      controller?.startRowLongPressSelection(entry("Projects/report.pdf"));
    });
    act(() => {
      fixture.timer.timeoutCallbacks.at(-1)?.();
    });
    expect(fixture.batchToggle).toHaveBeenCalledTimes(1);
    expect(controller?.getRowOpenSuppressed()).toBe(true);
  });

  it("clears scheduled long-press timers on unmount", () => {
    const fixture = createPorts();
    const { unmount } = render(
      <Harness
        ports={fixture.ports}
        onReady={() => undefined}
      />
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /Hold row/i }));
    unmount();
    expect(fixture.timer.clearTimeoutMock).toHaveBeenCalled();
  });

  it("re-reads latest ports and gates when the long-press timer fires", () => {
    let currentPath = "Projects";
    let markBatchAllowed = true;
    const fixture = createPorts({
      scope: {
        isSearchActive: () => false,
        getCurrentPath: () => currentPath
      }
    });
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    const { rerender } = render(
      <Harness
        ports={fixture.ports}
        isMarkBatchAllowed={markBatchAllowed}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      controller?.startRowLongPressSelection(entry("Projects/report.pdf"));
    });

    currentPath = "Archive";
    markBatchAllowed = false;
    rerender(
      <Harness
        ports={fixture.ports}
        isMarkBatchAllowed={markBatchAllowed}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      fixture.timer.timeoutCallbacks.at(-1)?.();
    });

    expect(fixture.batchToggle).not.toHaveBeenCalled();

    markBatchAllowed = true;
    currentPath = "Projects";
    rerender(
      <Harness
        ports={fixture.ports}
        isMarkBatchAllowed={markBatchAllowed}
        onReady={(next) => {
          controller = next;
        }}
      />
    );
    act(() => {
      controller?.startRowLongPressSelection(entry("Projects/report.pdf"));
    });
    act(() => {
      fixture.timer.timeoutCallbacks.at(-1)?.();
    });
    expect(fixture.batchToggle).toHaveBeenCalledWith(entry("Projects/report.pdf"), {
      kind: "browse",
      folderPath: "Projects"
    });
  });

  it("does not toggle batch selection when the operation handler is replaced before the timer fires", () => {
    let currentOperationHandler = true;
    const fixture = createPorts();
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    const { rerender } = render(
      <Harness
        ports={fixture.ports}
        isCurrentOperationHandler={currentOperationHandler}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      controller?.startRowLongPressSelection(entry("Projects/report.pdf"));
    });

    currentOperationHandler = false;
    rerender(
      <Harness
        ports={fixture.ports}
        isCurrentOperationHandler={currentOperationHandler}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      fixture.timer.timeoutCallbacks.at(-1)?.();
    });

    expect(fixture.batchToggle).not.toHaveBeenCalled();
    expect(controller?.getRowOpenSuppressed()).toBe(false);
  });

  it("does not apply a long-press started in a replaced path scope", () => {
    let currentPath = "Projects";
    const fixture = createPorts({
      scope: {
        isSearchActive: () => false,
        getCurrentPath: () => currentPath
      }
    });
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    const { rerender } = render(
      <Harness
        ports={fixture.ports}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      controller?.startRowLongPressSelection(entry("Projects/report.pdf"));
    });

    currentPath = "Archive";
    rerender(
      <Harness
        ports={fixture.ports}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      fixture.timer.timeoutCallbacks.at(-1)?.();
    });

    expect(fixture.batchToggle).not.toHaveBeenCalled();
  });

  it("keeps a long-press alive when the scope port object is recreated with the same semantic identity", () => {
    const fixture = createPorts();
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    const { rerender } = render(
      <Harness
        ports={fixture.ports}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      controller?.startRowLongPressSelection(entry("Projects/report.pdf"));
    });

    fixture.ports.scope = {
      isSearchActive: () => false,
      getCurrentPath: () => "Projects"
    };
    rerender(
      <Harness
        ports={fixture.ports}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      fixture.timer.timeoutCallbacks.at(-1)?.();
    });

    expect(fixture.batchToggle).toHaveBeenCalledWith(entry("Projects/report.pdf"), {
      kind: "browse",
      folderPath: "Projects"
    });
    expect(controller?.getRowOpenSuppressed()).toBe(true);
  });

  it("opens mobile details when re-tapping the same entry with details closed", () => {
    const fixture = createPorts();
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    const item = entry("Projects/report.pdf");
    fixture.ports.focused.select(item);

    render(
      <Harness
        ports={fixture.ports}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    act(() => {
      controller?.toggleEntrySelection(item);
    });

    expect(fixture.ports.focused.current()).toBe(item);
    expect(fixture.openMobileDetails).toHaveBeenCalledWith({ pushHistory: undefined });
  });

  it("forwards select-all toggles through the batch ports with the current browse origin", () => {
    const fixture = createPorts();
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;
    const entries = [entry("Projects/a.txt"), entry("Projects/b.txt")];

    render(
      <Harness
        ports={fixture.ports}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    let accepted: boolean | undefined;
    act(() => {
      accepted = controller?.toggleSelectAllEntries(entries);
    });

    expect(accepted).toBe(true);
    expect(fixture.batchSelectAll).toHaveBeenCalledWith(entries, { kind: "browse", folderPath: "Projects" });
    expect(fixture.batchDeselectPaths).not.toHaveBeenCalled();
  });

  it("rejects select-all toggles when the operation handler is stale", () => {
    const fixture = createPorts();
    let controller: ReturnType<typeof useSelectionInteraction> | undefined;

    render(
      <Harness
        ports={fixture.ports}
        isCurrentOperationHandler={false}
        onReady={(next) => {
          controller = next;
        }}
      />
    );

    let accepted: boolean | undefined;
    act(() => {
      accepted = controller?.toggleSelectAllEntries([entry("Projects/a.txt")]);
    });

    expect(accepted).toBe(false);
    expect(fixture.batchSelectAll).not.toHaveBeenCalled();
    expect(fixture.batchDeselectPaths).not.toHaveBeenCalled();
  });
});
