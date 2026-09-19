import { FileText, Folder, GripVertical, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { toDisplayPath } from "@davora/shared";

import { favouriteEntryKey, type FavouriteEntry } from "./model";
import type { FavouritesPointerEnvironment } from "./ports";
import { useFavouriteReorderInteraction } from "./useFavouriteReorderInteraction";

export interface FavouritesStageProps {
  readonly entries: readonly FavouriteEntry[];
  readonly offlineMode: boolean;
  readonly pointerEnvironment: FavouritesPointerEnvironment;
  readonly onOpen: (entry: FavouriteEntry) => void;
  readonly onRemove: (entry: FavouriteEntry) => void;
  readonly onReorder: (fromKey: string, toKey: string) => void;
}

export function FavouritesStage(props: FavouritesStageProps) {
  const interaction = useFavouriteReorderInteraction({
    environment: props.pointerEnvironment,
    onReorder: props.onReorder
  });

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    interaction.start(key);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <section aria-label="Favourites" className="nav-drawer-section nav-drawer-favourites">
      <p className="summary-label">Favourites</p>
      {props.entries.length > 0 ? (
        <div className="favourites-list">
          {props.entries.map((favourite) => {
            const key = favouriteEntryKey(favourite);
            return (
              <div
                className={`favourite-row${interaction.draggedKey === key ? " dragging" : ""}${favourite.unavailableReason ? " unavailable" : ""}`}
                data-favourite-key={key}
                draggable
                key={key}
                onDragEnd={interaction.stop}
                onDragOver={(event) => {
                  event.preventDefault();
                  interaction.moveBefore(key);
                }}
                onDragStart={(event) => {
                  interaction.start(key);
                  if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  interaction.stop();
                }}
              >
                <button
                  aria-label={`Drag ${favourite.name} favourite to reorder`}
                  className="favourite-drag-handle"
                  onPointerDown={(event) => startDrag(event, key)}
                  onPointerUp={interaction.stop}
                  type="button"
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <button
                  aria-label={`Open favourite ${favourite.isFolder ? "folder" : "file"} ${favourite.name}`}
                  className="favourite-open-button"
                  onClick={() => props.onOpen(favourite)}
                  type="button"
                >
                  {favourite.isFolder ? <Folder aria-hidden="true" className="favourite-icon favourite-icon-folder" /> : <FileText aria-hidden="true" className="favourite-icon" />}
                  <span className="favourite-title">{favourite.name}</span>
                  <span className="favourite-path">{toDisplayPath(favourite.path)}</span>
                  {favourite.unavailableReason ? <span className="favourite-stale">Unavailable</span> : null}
                </button>
                <button
                  aria-label={`Remove ${favourite.name} from Favourites`}
                  className="favourite-remove-button"
                  onClick={() => props.onRemove(favourite)}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="nav-drawer-empty">
          {props.offlineMode ? "No offline-available favourites in this workspace." : "Add files or folders from item actions."}
        </p>
      )}
    </section>
  );
}
