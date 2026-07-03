import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Modal } from "antd";
import { useWkSelector } from "libs/react_hooks";
import cloneDeep from "lodash-es/cloneDeep";
import messages from "messages";
import React, { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { enforceSkeletonTracing, getTree } from "viewer/model/accessors/skeletontracing_accessor";
import {
  type BatchableUpdateTreeAction,
  batchUpdateGroupsAndTreesAction,
  deleteTreesAction,
  setActiveTreeGroupAction,
  setTreeGroupAction,
  setTreeGroupsAction,
} from "viewer/model/actions/skeletontracing_actions";
import { getMaximumGroupId } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { TreeGroup } from "viewer/model/types/tree_types";
import Store from "viewer/store";
import {
  callDeep,
  createGroupToTreesMap,
  MISSING_GROUP_ID,
  makeBasicGroupObject,
  mapGroups,
  moveGroupsHelper,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";

// Let the user confirm the deletion of the initial node (node with id 1) of a task.
export function checkAndConfirmDeletingInitialNode(treeIds: number[]): Promise<void> {
  const state = Store.getState();
  const skeletonTracing = enforceSkeletonTracing(state.annotation);

  const hasNodeWithIdOne = (id: number) => getTree(skeletonTracing, id)?.nodes.has(1);

  const needsCheck = state.task != null && treeIds.find(hasNodeWithIdOne) != null;
  return new Promise<void>((resolve, reject) => {
    if (needsCheck) {
      Modal.confirm({
        title: messages["tracing.delete_tree_with_initial_node"],
        onOk: () => resolve(),
        onCancel: () => reject(),
      });
    } else {
      resolve();
    }
  });
}

export type GroupOperations = {
  // Group id for which the "keep vs. delete children" modal is currently shown.
  groupIdPendingDeletion: number | null;
  createGroup: (parentGroupId: number) => void;
  // Starts the deletion flow (which may show confirmation dialogs, depending on the group).
  requestGroupDeletion: (groupId: number) => void;
  confirmGroupDeletion: (deleteChildren: boolean) => void;
  cancelGroupDeletion: () => void;
  moveTreesToGroup: (treeIds: number[], targetGroupId: number) => void;
  moveGroupToGroup: (groupId: number, targetGroupId: number) => void;
  expandGroup: (groupId: number) => void;
};

export function useGroupOperations(deselectAllTrees: () => void): GroupOperations {
  const dispatch = useDispatch();
  const trees = useWkSelector((state) => enforceSkeletonTracing(state.annotation).trees);
  const treeGroups = useWkSelector((state) => enforceSkeletonTracing(state.annotation).treeGroups);
  const [groupIdPendingDeletion, setGroupIdPendingDeletion] = useState<number | null>(null);

  const createGroup = useCallback(
    (parentGroupId: number) => {
      const newTreeGroups = cloneDeep(treeGroups);
      const newGroupId = getMaximumGroupId(newTreeGroups) + 1;
      const newGroup = makeBasicGroupObject(newGroupId, `Group ${newGroupId}`);

      if (parentGroupId === MISSING_GROUP_ID) {
        newTreeGroups.push(newGroup);
      } else {
        callDeep(newTreeGroups, parentGroupId, (group) => {
          group.children.push(newGroup);
        });
      }

      dispatch(setTreeGroupsAction(newTreeGroups));
      deselectAllTrees();
      dispatch(setActiveTreeGroupAction(newGroupId));
    },
    [dispatch, treeGroups, deselectAllTrees],
  );

  const deleteGroup = useCallback(
    (groupId: number, deleteChildren: boolean) => {
      const groupToTreesMap = createGroupToTreesMap(trees);
      let newTreeGroups = cloneDeep(treeGroups);
      let treeIdsToDelete: number[] = [];

      if (groupId === MISSING_GROUP_ID) {
        // Special case: delete the root group and all children (aka everything).
        treeIdsToDelete = trees
          .values()
          .map((tree) => tree.treeId)
          .toArray();
        newTreeGroups = [];
      }

      const updateTreeActions: BatchableUpdateTreeAction[] = [];
      callDeep(newTreeGroups, groupId, (group, index, parentsChildren, parentGroupId) => {
        const subtrees = groupToTreesMap[groupId] ?? [];
        // Remove the group itself.
        parentsChildren.splice(index, 1);

        if (!deleteChildren) {
          // Move the group's subgroups and trees to the parent group.
          parentsChildren.push(...group.children);
          for (const tree of subtrees) {
            updateTreeActions.push(
              setTreeGroupAction(
                parentGroupId === MISSING_GROUP_ID ? null : parentGroupId,
                tree.treeId,
              ),
            );
          }
          return;
        }

        // Collect all trees of the group and its subgroups for deletion.
        const collectTreeIdsRecursively = (currentGroup: TreeGroup) => {
          const currentSubtrees = groupToTreesMap[currentGroup.groupId] ?? [];
          treeIdsToDelete = treeIdsToDelete.concat(currentSubtrees.map((tree) => tree.treeId));
          currentGroup.children.forEach(collectTreeIdsRecursively);
        };
        collectTreeIdsRecursively(group);
      });

      checkAndConfirmDeletingInitialNode(treeIdsToDelete).then(() => {
        dispatch(
          batchUpdateGroupsAndTreesAction(
            updateTreeActions.concat([
              deleteTreesAction(treeIdsToDelete),
              setTreeGroupsAction(newTreeGroups),
            ]),
          ),
        );
      });
    },
    [dispatch, trees, treeGroups],
  );

  const requestGroupDeletion = useCallback(
    (groupId: number) => {
      const groupToTreesMap = createGroupToTreesMap(trees);
      const group = treeGroups.find((currentGroup) => currentGroup.groupId === groupId);

      if (group != null && group.children.length === 0 && groupToTreesMap[groupId] == null) {
        // The group is empty, delete it without asking.
        deleteGroup(groupId, false);
      } else if (groupId === MISSING_GROUP_ID) {
        // Ask whether all children of the root group should be deleted
        // (doesn't need the recursive/not-recursive distinction, since
        // the root group itself cannot be removed).
        Modal.confirm({
          title: "Do you want to delete all trees and groups?",
          icon: React.createElement(ExclamationCircleOutlined),
          okType: "danger",
          okText: "Delete",
          onOk: () => deleteGroup(groupId, false),
        });
      } else {
        setGroupIdPendingDeletion(groupId);
      }
    },
    [trees, treeGroups, deleteGroup],
  );

  const confirmGroupDeletion = useCallback(
    (deleteChildren: boolean) => {
      setGroupIdPendingDeletion(null);
      if (groupIdPendingDeletion != null) {
        deleteGroup(groupIdPendingDeletion, deleteChildren);
      }
    },
    [groupIdPendingDeletion, deleteGroup],
  );

  const cancelGroupDeletion = useCallback(() => {
    setGroupIdPendingDeletion(null);
  }, []);

  const expandGroup = useCallback(
    (groupId: number) => {
      const newGroups = mapGroups(treeGroups, (group) =>
        group.groupId === groupId && !group.isExpanded ? { ...group, isExpanded: true } : group,
      );
      dispatch(setTreeGroupsAction(newGroups));
    },
    [dispatch, treeGroups],
  );

  const moveTreesToGroup = useCallback(
    (treeIds: number[], targetGroupId: number) => {
      const moveActions: BatchableUpdateTreeAction[] = treeIds.map((treeId) =>
        setTreeGroupAction(targetGroupId === MISSING_GROUP_ID ? null : targetGroupId, treeId),
      );
      dispatch(batchUpdateGroupsAndTreesAction(moveActions));
      expandGroup(targetGroupId);
    },
    [dispatch, expandGroup],
  );

  const moveGroupToGroup = useCallback(
    (groupId: number, targetGroupId: number) => {
      const updatedTreeGroups = moveGroupsHelper(treeGroups, groupId, targetGroupId);
      const newGroups = mapGroups(updatedTreeGroups, (group) =>
        group.groupId === targetGroupId && !group.isExpanded
          ? { ...group, isExpanded: true }
          : group,
      );
      dispatch(setTreeGroupsAction(newGroups));
    },
    [dispatch, treeGroups],
  );

  return {
    groupIdPendingDeletion,
    createGroup,
    requestGroupDeletion,
    confirmGroupDeletion,
    cancelGroupDeletion,
    moveTreesToGroup,
    moveGroupToGroup,
    expandGroup,
  };
}
