import { Modal } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  deselectActiveTreeAction,
  deselectActiveTreeGroupAction,
  setActiveTreeAction,
  setActiveTreeGroupAction,
} from "viewer/model/actions/skeletontracing_actions";

export type TreeSelection = {
  selectedTreeIds: number[];
  selectSingleTree: (treeId: number) => void;
  multiSelectTree: (treeId: number) => void;
  selectTrees: (treeIds: number[]) => void;
  selectGroup: (groupId: number) => void;
  deselectAllTrees: () => void;
};

/*
 * Manages which trees are selected in the tab. The selection follows the active tree
 * (which can change through actions outside of this tab), but supports transient
 * multi- and range-selections on top of it.
 */
export function useTreeSelection(): TreeSelection {
  const dispatch = useDispatch();
  const activeTreeId = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).activeTreeId,
  );
  const [selectedTreeIds, setSelectedTreeIds] = useState<number[]>(
    activeTreeId != null ? [activeTreeId] : [],
  );
  // Multi-selecting dispatches deselectActiveTreeAction (the active tree becomes part
  // of the multi selection instead). That store change must not clear the selection
  // it just created, so the next active-tree sync is suppressed.
  const suppressNextActiveTreeSync = useRef(false);

  useEffect(() => {
    if (suppressNextActiveTreeSync.current) {
      suppressNextActiveTreeSync.current = false;
      return;
    }
    setSelectedTreeIds(activeTreeId != null ? [activeTreeId] : []);
  }, [activeTreeId]);

  const selectSingleTree = useCallback(
    (treeId: number) => {
      setSelectedTreeIds([treeId]);
      dispatch(setActiveTreeAction(treeId));
    },
    [dispatch],
  );

  const multiSelectTree = useCallback(
    (treeId: number) => {
      if (selectedTreeIds.includes(treeId)) {
        if (selectedTreeIds.length === 2) {
          // Only one tree remains selected -> make it the active tree again.
          const remainingTreeId = selectedTreeIds.find((id) => id !== treeId);
          if (remainingTreeId != null) {
            dispatch(setActiveTreeAction(remainingTreeId));
          }
          setSelectedTreeIds([]);
        } else {
          setSelectedTreeIds(selectedTreeIds.filter((id) => id !== treeId));
        }
        return;
      }

      dispatch(deselectActiveTreeGroupAction());

      if (selectedTreeIds.length === 0 && activeTreeId != null) {
        // The first multi-selected tree also pulls the active tree into the selection.
        setSelectedTreeIds([treeId, activeTreeId]);
        suppressNextActiveTreeSync.current = true;
        dispatch(deselectActiveTreeAction());
      } else {
        setSelectedTreeIds([...selectedTreeIds, treeId]);
      }
    },
    [dispatch, selectedTreeIds, activeTreeId],
  );

  const selectTrees = useCallback(
    (treeIds: number[]) => {
      dispatch(deselectActiveTreeGroupAction());
      setSelectedTreeIds(treeIds);
    },
    [dispatch],
  );

  const deselectAllTrees = useCallback(() => {
    setSelectedTreeIds([]);
  }, []);

  const selectGroup = useCallback(
    (groupId: number) => {
      const activateGroup = () => {
        setSelectedTreeIds([]);
        dispatch(setActiveTreeGroupAction(groupId));
      };

      if (selectedTreeIds.length > 1) {
        Modal.confirm({
          title: "Do you really want to select this group?",
          content: `You have ${selectedTreeIds.length} selected Trees. Do you really want to select this group?
        This will deselect all selected trees.`,
          onOk: activateGroup,
          onCancel() {},
        });
      } else {
        activateGroup();
      }
    },
    [dispatch, selectedTreeIds],
  );

  return {
    selectedTreeIds,
    selectSingleTree,
    multiSelectTree,
    selectTrees,
    selectGroup,
    deselectAllTrees,
  };
}
