import { useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";

type AdditionalSelection = {
  // The active bounding box the additional selection was made for.
  activeId: number | null;
  ids: number[];
};

const EMPTY_ADDITIONAL_SELECTION: AdditionalSelection = { activeId: null, ids: [] };

// The selection of the bounding box list is derived from the store's active bounding box,
// which is always the first selected box (and the one filled in the viewports). Ctrl/Cmd-clicks
// add further boxes, which stay selected only as long as the active box doesn't change.
// Thus, changes of the active box made elsewhere (e.g. clicking a box in a viewport, or
// deleting the active box) are reflected in the list without syncing two separate states.
export default function useBoundingBoxSelection(userBoundingBoxes: UserBoundingBox[]) {
  const dispatch = useDispatch();
  const activeId = useWkSelector((state) => state.uiInformation.activeUserBoundingBoxId) ?? null;
  const [additionalSelection, setAdditionalSelection] = useState<AdditionalSelection>(
    EMPTY_ADDITIONAL_SELECTION,
  );

  const selectedIds = useMemo(() => {
    const existingIds = new Set(userBoundingBoxes.map((bbox) => bbox.id));
    if (activeId == null || !existingIds.has(activeId)) {
      return [];
    }
    const additionalIds =
      additionalSelection.activeId === activeId
        ? additionalSelection.ids.filter((id) => id !== activeId && existingIds.has(id))
        : [];
    return [activeId, ...additionalIds];
  }, [activeId, additionalSelection, userBoundingBoxes]);

  // Selects the given boxes. The first one becomes the active bounding box.
  const setSelection = useCallback(
    (ids: number[]) => {
      const [nextActiveId = null, ...additionalIds] = ids;
      setAdditionalSelection({ activeId: nextActiveId, ids: additionalIds });
      dispatch(setActiveUserBoundingBoxId(nextActiveId));
    },
    [dispatch],
  );

  const clearSelection = useCallback(() => setSelection([]), [setSelection]);

  // Adds the box to or removes it from the selection. If the active box is removed,
  // the next selected box becomes active.
  const toggleSelection = useCallback(
    (id: number) =>
      setSelection(
        selectedIds.includes(id) ? selectedIds.filter((key) => key !== id) : [...selectedIds, id],
      ),
    [selectedIds, setSelection],
  );

  return { activeId, selectedIds, setSelection, clearSelection, toggleSelection };
}
