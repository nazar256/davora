import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, Suspense, startTransition } from "react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FavouriteEntry } from "./model";
import { FavouritesStage } from "./FavouritesStage";

const browserPointerEnvironment = {
  elementFromPoint: (x: number, y: number) => document.elementFromPoint(x, y),
  addWindowListener: (
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: PointerEvent) => void,
    options?: AddEventListenerOptions
  ) => {
    window.addEventListener(type, listener, options);
    return () => window.removeEventListener(type, listener);
  }
} as const;

type ListenerType = "pointermove" | "pointerup" | "pointercancel";

interface ListenerRecord {
  readonly type: ListenerType;
  readonly listener: (event: PointerEvent) => void;
  readonly options: AddEventListenerOptions | undefined;
  removed: boolean;
}

function createPointerEnvironment() {
  const listeners: ListenerRecord[] = [];
  let target: Element | null = null;
  const elementFromPoint = vi.fn((_x: number, _y: number) => target);

  const environment = {
    elementFromPoint,
    addWindowListener: (type: ListenerType, listener: (event: PointerEvent) => void, options?: AddEventListenerOptions) => {
      const record: ListenerRecord = { type, listener, options, removed: false };
      listeners.push(record);
      return () => {
        if (!record.removed) {
          record.removed = true;
        }
      };
    },
    emit: (type: ListenerType, event: PointerEvent) => {
      for (const record of listeners) {
        if (record.type === type && !record.removed) {
          record.listener(event);
        }
      }
    },
    setTarget: (nextTarget: Element | null) => {
      target = nextTarget;
    },
    listeners
  } as const;

  return environment;
}

function pointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  // jsdom does not expose a PointerEvent constructor in every supported runner.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    clientX: 12,
    clientY: 34,
    preventDefault: vi.fn(),
    ...overrides
  } as unknown as PointerEvent;
}

function installPointerCapture(element: HTMLElement) {
  const setPointerCapture = vi.fn();
  Object.defineProperty(element, "setPointerCapture", { configurable: true, value: setPointerCapture });
  return setPointerCapture;
}

function firePointerDown(element: HTMLElement, pointerId = 1) {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(element, event);
}

function buildFavourite(
  overrides: Partial<FavouriteEntry> & Pick<FavouriteEntry, "path" | "name" | "isFolder">
): FavouriteEntry {
  return {
    accountId: "alpha",
    accountBackend: "mock",
    accountRootPath: ".davora-agent-test",
    cacheNamespace: "ns-alpha",
    addedAt: "2026-07-10T00:00:00.000Z",
    ...overrides
  };
}

const folderFavourite = buildFavourite({ path: "Projects", name: "Projects", isFolder: true });
const fileFavourite = buildFavourite({
  path: "Projects/roadmap.txt",
  name: "roadmap.txt",
  isFolder: false,
  mimeType: "text/plain"
});

function buildProps(overrides: Partial<ComponentProps<typeof FavouritesStage>> = {}) {
  return {
    entries: [folderFavourite, fileFavourite],
    offlineMode: false,
    pointerEnvironment: browserPointerEnvironment,
    onOpen: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn(),
    ...overrides
  };
}

describe("FavouritesStage", () => {
  afterEach(cleanup);

  it("shows online empty copy when no entries are passed", () => {
    render(<FavouritesStage {...buildProps({ entries: [], offlineMode: false })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    expect(within(section).getByText("Add files or folders from item actions.")).toBeInTheDocument();
  });

  it("shows offline empty copy when no entries are passed in offline mode", () => {
    render(<FavouritesStage {...buildProps({ entries: [], offlineMode: true })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    expect(within(section).getByText("No offline-available favourites in this workspace.")).toBeInTheDocument();
  });

  it("labels folder and file open buttons with accessible names", () => {
    render(<FavouritesStage {...buildProps()} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    expect(within(section).getByRole("button", { name: /Open favourite folder Projects/i })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /Open favourite file roadmap.txt/i })).toBeInTheDocument();
  });

  it("shows an unavailable marker when a favourite has an unavailable reason", () => {
    render(
      <FavouritesStage
        {...buildProps({
          entries: [buildFavourite({ ...fileFavourite, unavailableReason: "Missing on server" })]
        })}
      />
    );

    const section = screen.getByRole("region", { name: /Favourites/i });
    expect(within(section).getByText("Unavailable")).toBeInTheDocument();
    const unavailableRow = within(section).getByText("Unavailable").closest<HTMLElement>(".favourite-row");
    expect(unavailableRow).toHaveAttribute("draggable", "true");
    expect(within(section).getByRole("button", { name: /Open favourite file roadmap.txt/i })).toBeInTheDocument();
  });

  it("invokes onRemove when a favourite shortcut is removed", () => {
    const onRemove = vi.fn();
    render(<FavouritesStage {...buildProps({ onRemove })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    fireEvent.click(within(section).getByRole("button", { name: /Remove roadmap.txt from Favourites/i }));

    expect(onRemove).toHaveBeenCalledWith(fileFavourite);
  });

  it("invokes onReorder when a favourite row is dragged over another row", () => {
    const onReorder = vi.fn();
    render(<FavouritesStage {...buildProps({ onReorder })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    const projectRow = within(section).getByLabelText(/Drag Projects favourite/i).closest(".favourite-row");
    const fileRow = within(section).getByLabelText(/Drag roadmap.txt favourite/i).closest(".favourite-row");
    expect(projectRow).not.toBeNull();
    expect(fileRow).not.toBeNull();

    fireEvent.dragStart(fileRow!);
    fireEvent.dragOver(projectRow!);
    fireEvent.dragEnd(fileRow!);

    expect(onReorder).toHaveBeenCalledWith("file:Projects/roadmap.txt", "folder:Projects");
  });

  it("keeps native drag state, move semantics, drop prevention, and effectAllowed stable", () => {
    const onReorder = vi.fn();
    render(<FavouritesStage {...buildProps({ onReorder })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    const projectRow = within(section).getByLabelText(/Drag Projects favourite/i).closest<HTMLElement>(".favourite-row");
    const fileRow = within(section).getByLabelText(/Drag roadmap.txt favourite/i).closest<HTMLElement>(".favourite-row");
    expect(projectRow).not.toBeNull();
    expect(fileRow).not.toBeNull();

    const dataTransfer = { effectAllowed: "none" };
    fireEvent.dragStart(fileRow!, { dataTransfer });
    expect(fileRow).toHaveClass("dragging");
    expect(dataTransfer.effectAllowed).toBe("move");

    const sameRowOver = new Event("dragover", { bubbles: true, cancelable: true });
    fireEvent(fileRow!, sameRowOver);
    expect(sameRowOver.defaultPrevented).toBe(true);
    expect(onReorder).not.toHaveBeenCalled();

    const targetRowOver = new Event("dragover", { bubbles: true, cancelable: true });
    fireEvent(projectRow!, targetRowOver);
    expect(targetRowOver.defaultPrevented).toBe(true);
    expect(onReorder).toHaveBeenCalledWith("file:Projects/roadmap.txt", "folder:Projects");

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    fireEvent(fileRow!, drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(fileRow).not.toHaveClass("dragging");

    fireEvent.dragStart(fileRow!, { dataTransfer });
    expect(fileRow).toHaveClass("dragging");
    fireEvent.dragEnd(fileRow!);
    expect(fileRow).not.toHaveClass("dragging");
  });

  it("starts pointer drags, captures the initiating pointer, and installs one listener of each type", () => {
    const pointerEnvironment = createPointerEnvironment();
    render(<FavouritesStage {...buildProps({ pointerEnvironment })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    const handle = within(section).getByRole("button", { name: /Drag roadmap.txt favourite/i });
    const capture = installPointerCapture(handle);

    firePointerDown(handle, 9);

    expect(capture).toHaveBeenCalledWith(9);
    expect(within(section).getByLabelText(/Drag roadmap.txt favourite/i).closest(".favourite-row")).toHaveClass("dragging");
    expect(pointerEnvironment.listeners.map(({ type }) => type)).toEqual(["pointermove", "pointerup", "pointercancel"]);
    expect(pointerEnvironment.listeners[0]?.options).toEqual({ passive: false });
    expect(pointerEnvironment.listeners.slice(1).every(({ options }) => options === undefined)).toBe(true);
  });

  it("prevents pointer move defaults and resolves target descendants while ignoring invalid targets", () => {
    const pointerEnvironment = createPointerEnvironment();
    const onReorder = vi.fn();
    render(<FavouritesStage {...buildProps({ onReorder, pointerEnvironment })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    const handle = within(section).getByRole("button", { name: /Drag roadmap.txt favourite/i });
    installPointerCapture(handle);
    const projectRow = within(section).getByLabelText(/Drag Projects favourite/i).closest<HTMLElement>(".favourite-row");
    const fileRow = within(section).getByLabelText(/Drag roadmap.txt favourite/i).closest<HTMLElement>(".favourite-row");
    expect(projectRow).not.toBeNull();
    expect(fileRow).not.toBeNull();

    firePointerDown(handle);
    const descendant = document.createElement("span");
    projectRow!.querySelector(".favourite-title")?.append(descendant);

    const descendantMove = pointerEvent();
    pointerEnvironment.setTarget(descendant);
    pointerEnvironment.emit("pointermove", descendantMove);
    expect(descendantMove.preventDefault).toHaveBeenCalledTimes(1);
    expect(pointerEnvironment.elementFromPoint).toHaveBeenCalledWith(12, 34);
    expect(onReorder).toHaveBeenCalledWith("file:Projects/roadmap.txt", "folder:Projects");

    for (const invalidTarget of [null, document.createElement("div"), document.createElement("span"), fileRow]) {
      const move = pointerEvent();
      pointerEnvironment.setTarget(invalidTarget);
      pointerEnvironment.emit("pointermove", move);
      expect(move.preventDefault).toHaveBeenCalledTimes(1);
    }
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(within(section).getByLabelText(/Drag roadmap.txt favourite/i).closest(".favourite-row")).toHaveClass("dragging");
  });

  it.each(["pointerup", "pointercancel"] as const)("stops and removes all listeners on %s", (terminalEvent) => {
    const pointerEnvironment = createPointerEnvironment();
    render(<FavouritesStage {...buildProps({ pointerEnvironment })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    const handle = within(section).getByRole("button", { name: /Drag roadmap.txt favourite/i });
    installPointerCapture(handle);
    firePointerDown(handle);
    act(() => pointerEnvironment.emit(terminalEvent, pointerEvent()));

    expect(pointerEnvironment.listeners.filter(({ removed }) => removed)).toHaveLength(3);
    act(() => pointerEnvironment.emit(terminalEvent, pointerEvent()));
    expect(pointerEnvironment.listeners.filter(({ removed }) => removed)).toHaveLength(3);
    expect(within(section).getByLabelText(/Drag roadmap.txt favourite/i).closest(".favourite-row")).not.toHaveClass("dragging");
  });

  it("stops pointer drags when the initiating handle receives pointerup", async () => {
    const pointerEnvironment = createPointerEnvironment();
    render(<FavouritesStage {...buildProps({ pointerEnvironment })} />);
    const section = screen.getByRole("region", { name: /Favourites/i });
    const handle = within(section).getByRole("button", { name: /Drag roadmap.txt favourite/i });
    installPointerCapture(handle);
    firePointerDown(handle);

    await act(async () => {
      fireEvent.pointerUp(handle);
    });
    expect(pointerEnvironment.listeners.filter(({ removed }) => removed)).toHaveLength(3);
    expect(within(section).getByLabelText(/Drag roadmap.txt favourite/i).closest(".favourite-row")).not.toHaveClass("dragging");
  });

  it("routes the latest reorder callback without resubscribing active pointer listeners", () => {
    const pointerEnvironment = createPointerEnvironment();
    const firstOnReorder = vi.fn();
    const secondOnReorder = vi.fn();
    const { rerender } = render(<FavouritesStage {...buildProps({ onReorder: firstOnReorder, pointerEnvironment })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    const handle = within(section).getByRole("button", { name: /Drag roadmap.txt favourite/i });
    installPointerCapture(handle);
    firePointerDown(handle);
    const addCount = pointerEnvironment.listeners.length;
    rerender(<FavouritesStage {...buildProps({ onReorder: secondOnReorder, pointerEnvironment })} />);

    const projectRow = within(screen.getByRole("region", { name: /Favourites/i })).getByLabelText(/Drag Projects favourite/i).closest<HTMLElement>(".favourite-row");
    pointerEnvironment.setTarget(projectRow);
    pointerEnvironment.emit("pointermove", pointerEvent());

    expect(firstOnReorder).not.toHaveBeenCalled();
    expect(secondOnReorder).toHaveBeenCalledWith("file:Projects/roadmap.txt", "folder:Projects");
    expect(pointerEnvironment.listeners).toHaveLength(addCount);
    expect(pointerEnvironment.listeners.filter(({ removed }) => removed)).toHaveLength(0);
  });

  it("rebinds all active listeners when the pointer environment is replaced", () => {
    const firstEnvironment = createPointerEnvironment();
    const secondEnvironment = createPointerEnvironment();
    const onReorder = vi.fn();
    const { rerender } = render(<FavouritesStage {...buildProps({ onReorder, pointerEnvironment: firstEnvironment })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    const handle = within(section).getByRole("button", { name: /Drag roadmap.txt favourite/i });
    installPointerCapture(handle);
    firePointerDown(handle);
    rerender(<FavouritesStage {...buildProps({ onReorder, pointerEnvironment: secondEnvironment })} />);

    expect(firstEnvironment.listeners.filter(({ removed }) => removed)).toHaveLength(3);
    expect(secondEnvironment.listeners).toHaveLength(3);
    const projectRow = within(screen.getByRole("region", { name: /Favourites/i })).getByLabelText(/Drag Projects favourite/i).closest<HTMLElement>(".favourite-row");
    secondEnvironment.setTarget(projectRow);
    secondEnvironment.emit("pointermove", pointerEvent());
    expect(onReorder).toHaveBeenCalledWith("file:Projects/roadmap.txt", "folder:Projects");
  });

  it("keeps committed pointer ownership when a replacement render suspends before commit", () => {
    const pointerEnvironment = createPointerEnvironment();
    const replacementEnvironment = createPointerEnvironment();
    const onReorder = vi.fn();
    const never = new Promise<never>(() => undefined);
    function SuspendedStage(props: ComponentProps<typeof FavouritesStage> & { readonly suspend: boolean }) {
      if (props.suspend) {
        throw never;
      }
      return <FavouritesStage {...props} />;
    }
    const { rerender, unmount } = render(
      <Suspense fallback={<p>Loading replacement</p>}>
        <SuspendedStage {...buildProps({ onReorder, pointerEnvironment })} suspend={false} />
      </Suspense>
    );

    const section = screen.getByRole("region", { name: /Favourites/i });
    const handle = within(section).getByRole("button", { name: /Drag roadmap.txt favourite/i });
    installPointerCapture(handle);
    firePointerDown(handle);

    act(() => {
      startTransition(() => {
        rerender(
          <Suspense fallback={<p>Loading replacement</p>}>
            <SuspendedStage {...buildProps({ onReorder, pointerEnvironment: replacementEnvironment })} suspend={true} />
          </Suspense>
        );
      });
    });

    const projectRow = within(screen.getByRole("region", { name: /Favourites/i })).getByLabelText(/Drag Projects favourite/i).closest<HTMLElement>(".favourite-row");
    pointerEnvironment.setTarget(projectRow);
    pointerEnvironment.emit("pointermove", pointerEvent());
    expect(onReorder).toHaveBeenCalledWith("file:Projects/roadmap.txt", "folder:Projects");
    expect(replacementEnvironment.listeners).toHaveLength(0);
    unmount();
  });

  it("cleans listeners on unmount and keeps late events inert under StrictMode", () => {
    const pointerEnvironment = createPointerEnvironment();
    const onReorder = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <FavouritesStage {...buildProps({ onReorder, pointerEnvironment })} />
      </StrictMode>
    );

    const section = screen.getByRole("region", { name: /Favourites/i });
    const handle = within(section).getByRole("button", { name: /Drag roadmap.txt favourite/i });
    installPointerCapture(handle);
    firePointerDown(handle);
    expect(pointerEnvironment.listeners).toHaveLength(3);
    unmount();

    expect(pointerEnvironment.listeners.filter(({ removed }) => removed)).toHaveLength(3);
    pointerEnvironment.setTarget(document.body);
    pointerEnvironment.emit("pointermove", pointerEvent());
    pointerEnvironment.emit("pointerup", pointerEvent());
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("renders only the filtered entries passed as props", () => {
    render(<FavouritesStage {...buildProps({ entries: [folderFavourite] })} />);

    const section = screen.getByRole("region", { name: /Favourites/i });
    expect(within(section).getByRole("button", { name: /Open favourite folder Projects/i })).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /Open favourite file roadmap.txt/i })).not.toBeInTheDocument();
  });
});
