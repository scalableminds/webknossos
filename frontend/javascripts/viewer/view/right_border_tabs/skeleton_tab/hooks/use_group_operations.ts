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
  setExpandedTreeGroupsByIdsAction,
  setTreeGroupAction,
  setTreeGroupsAction,
} from "viewer/model/actions/skeletontracing_actions";
import { getMaximumGroupId } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { TreeGroup } from "viewer/model/types/tree_types";
import Store from "viewer/store";
import {
  callDeep,
  createGroupHelper,
  createGroupToTreesMap,
  findGroup,
  getExpandedGroups,
  getGroupByIdWithSubgroups,
  MISSING_GROUP_ID,
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
};

export function useGroupOperations(deselectAllTrees: () => void): GroupOperations {
  const dispatch = useDispatch();
  const trees = useWkSelector((state) => enforceSkeletonTracing(state.annotation).trees);
  const treeGroups = useWkSelector((state) => enforceSkeletonTracing(state.annotation).treeGroups);
  const [groupIdPendingDeletion, setGroupIdPendingDeletion] = useState<number | null>(null);

  const createGroup = useCallback(
    (parentGroupId: number) => {
      const newGroupId = getMaximumGroupId(treeGroups) + 1;
      const newTreeGroups = createGroupHelper(
        treeGroups,
        `Group ${newGroupId}`,
        newGroupId,
        parentGroupId,
      );

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

      checkAndConfirmDeletingInitialNode(treeIdsToDelete)
        .then(() => {
          dispatch(
            batchUpdateGroupsAndTreesAction(
              updateTreeActions.concat([
                deleteTreesAction(treeIdsToDelete),
                setTreeGroupsAction(newTreeGroups),
              ]),
            ),
          );
        })
        // The user cancelled the initial-node confirmation; keep everything as is.
        .catch(() => {});
    },
    [dispatch, trees, treeGroups],
  );

  const requestGroupDeletion = useCallback(
    (groupId: number) => {
      const groupToTreesMap = createGroupToTreesMap(trees);
      // findGroup searches recursively so nested groups are found, too.
      const group = findGroup(treeGroups, groupId);

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

  // Uses the same action as all other expansion flows (tree switcher, context
  // menus) so that expansion state changes go through a single mechanism.
  const expandGroup = useCallback(
    (groupId: number) => {
      if (groupId === MISSING_GROUP_ID) {
        // The virtual root group is always expanded.
        return;
      }
      const expandedGroupIds = new Set(getExpandedGroups(treeGroups).map((group) => group.groupId));
      expandedGroupIds.add(groupId);
      dispatch(setExpandedTreeGroupsByIdsAction(expandedGroupIds));
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
      if (
        groupId === targetGroupId ||
        getGroupByIdWithSubgroups(treeGroups, groupId).includes(targetGroupId)
      ) {
        // Moving a group into itself or one of its descendants would create a cycle.
        return;
      }
      dispatch(setTreeGroupsAction(moveGroupsHelper(treeGroups, groupId, targetGroupId)));
      expandGroup(targetGroupId);
    },
    [dispatch, treeGroups, expandGroup],
  );

  return {
    groupIdPendingDeletion,
    createGroup,
    requestGroupDeletion,
    confirmGroupDeletion,
    cancelGroupDeletion,
    moveTreesToGroup,
    moveGroupToGroup,
  };
}
