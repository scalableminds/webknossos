import Icon, {
  ArrowRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExpandAltOutlined,
  EyeOutlined,
  PlusOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";
import HideSkeletonEdgesIcon from "@images/icons/icon-hide-skeleton-edges.svg?react";
import InvertIcon from "@images/icons/icon-invert.svg?react";
import PipetteIcon from "@images/icons/icon-pipette.svg?react";
import ProofreadingIcon from "@images/icons/icon-proofreading.svg?react";
import RulerIcon from "@images/icons/icon-ruler.svg?react";
import type { MenuProps } from "antd";
import { ChangeColorMenuItemContent } from "components/color_picker";
import { useWkSelector } from "libs/react_hooks";
import cloneDeep from "lodash-es/cloneDeep";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { batchActions } from "redux-batched-actions";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  addTreesAndGroupsAction,
  deleteTreeAction,
  setActiveTreeAction,
  setActiveTreeGroupAction,
  setExpandedTreeGroupsByIdsAction,
  setTreeColorAction,
  setTreeEdgeVisibilityAction,
  setTreeTypeAction,
  shuffleAllTreeColorsAction,
  shuffleTreeColorAction,
  toggleInactiveTreesAction,
} from "viewer/model/actions/skeletontracing_actions";
import { TreeMap } from "viewer/model/types/tree_types";
import {
  createGroupToTreesMap,
  getExpandedGroups,
  getGroupByIdWithSubgroups,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import type { GroupUiNode, TreeUiNode } from "./hierarchy";
import type { GroupOperations } from "./hooks/use_group_operations";
import type { TreeSelection } from "./hooks/use_tree_selection";
import { showTreeLengthNotification } from "./measurements";

export type TreeContextMenuBuilder = (node: TreeUiNode) => MenuProps;
export type GroupContextMenuBuilder = (node: GroupUiNode) => MenuProps;

// The color/shuffle actions are dispatched as one batch so that they end up as a
// single undo step.
function batchTreeColorActions(actions: Action[], actionName: string): Action {
  return batchActions(actions, actionName) as unknown as Action;
}

export function useTreeContextMenuBuilder(
  selection: TreeSelection,
  hideContextMenu: () => void,
): TreeContextMenuBuilder {
  const dispatch = useDispatch();
  const allowUpdate = useWkSelector(mayEditAnnotation);

  return useCallback(
    (node: TreeUiNode): MenuProps => {
      const { tree } = node;
      const isEditingDisabled = !allowUpdate;
      const isAgglomerateTree = tree.type === TreeTypeEnum.AGGLOMERATE;

      return {
        items: [
          {
            key: "changeTreeColor",
            disabled: isEditingDisabled,
            icon: <Icon component={PipetteIcon} />,
            label: (
              <ChangeColorMenuItemContent
                key={`changeTreeColor-${tree.treeId}`}
                title="Change Tree Color"
                isDisabled={isEditingDisabled}
                onSetColor={(color) => dispatch(setTreeColorAction(tree.treeId, color))}
                rgb={tree.color}
              />
            ),
          },
          {
            key: "shuffleTreeColor",
            onClick: () => dispatch(shuffleTreeColorAction(tree.treeId)),
            title: "Shuffle Tree Color",
            disabled: isEditingDisabled,
            icon: <Icon component={InvertIcon} />,
            label: "Shuffle Tree Color",
          },
          {
            key: "duplicateTree",
            onClick: () => {
              const copyOfTree = { ...cloneDeep(tree), name: `${tree.name} (copy)` };
              const treeMap = new TreeMap([[tree.treeId, copyOfTree]]);
              dispatch(addTreesAndGroupsAction(treeMap, null, undefined, false));
              hideContextMenu();
            },
            title: "Duplicate Tree",
            disabled: isEditingDisabled,
            icon: <CopyOutlined />,
            label: "Duplicate Tree",
          },
          {
            key: "deleteTree",
            onClick: () => {
              selection.deselectAllTrees();
              dispatch(deleteTreeAction(tree.treeId));
              hideContextMenu();
            },
            title: "Delete Tree",
            disabled: isEditingDisabled,
            icon: <DeleteOutlined />,
            label: "Delete Tree",
          },
          {
            key: "measureTree",
            onClick: () => {
              showTreeLengthNotification(tree.treeId, tree.name);
              hideContextMenu();
            },
            title: "Measure Tree Length",
            icon: <Icon component={RulerIcon} />,
            label: "Measure Tree Length",
          },
          {
            key: "hideTree",
            onClick: () => {
              dispatch(setActiveTreeAction(tree.treeId));
              dispatch(toggleInactiveTreesAction());
              hideContextMenu();
            },
            title: "Hide/Show All Other Trees",
            icon: <EyeOutlined />,
            label: "Hide/Show All Other Trees",
          },
          {
            key: "hideTreeEdges",
            onClick: () => {
              dispatch(setActiveTreeAction(tree.treeId));
              dispatch(setTreeEdgeVisibilityAction(tree.treeId, !tree.edgesAreVisible));
              hideContextMenu();
            },
            title: "Hide/Show Edges of This Tree",
            icon: <Icon component={HideSkeletonEdgesIcon} aria-label="Hide Tree Edges Icon" />,
            label: "Hide/Show Edges of This Tree",
          },
          isAgglomerateTree
            ? {
                key: "convertToNormalTree",
                onClick: () => {
                  dispatch(setTreeTypeAction(tree.treeId, TreeTypeEnum.DEFAULT));
                  hideContextMenu();
                },
                title: "Convert to Normal Tree",
                icon: <Icon component={ProofreadingIcon} />,
                label: "Convert to Normal Tree",
              }
            : null,
        ],
      };
    },
    [dispatch, allowUpdate, selection, hideContextMenu],
  );
}

export function useGroupContextMenuBuilder(
  selection: TreeSelection,
  groupOperations: GroupOperations,
  hideContextMenu: () => void,
): GroupContextMenuBuilder {
  const dispatch = useDispatch();
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const trees = useWkSelector((state) => enforceSkeletonTracing(state.annotation).trees);
  const treeGroups = useWkSelector((state) => enforceSkeletonTracing(state.annotation).treeGroups);
  const activeTreeId = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).activeTreeId,
  );
  const activeGroupId = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).activeGroupId,
  );

  const setColorOfAllTrees = useCallback(
    (color: Vector3) => {
      const setColorActions = trees
        .values()
        .map((tree) => setTreeColorAction(tree.treeId, color))
        .toArray();
      dispatch(batchTreeColorActions(setColorActions, "SET_TREE_COLOR"));
    },
    [dispatch, trees],
  );

  // Dispatches one action per tree in the group and all its subgroups, batched into a
  // single undo step.
  const dispatchForGroupTrees = useCallback(
    (groupId: number, makeAction: (treeId: number) => Action, batchName: string) => {
      const groupToTreesMap = createGroupToTreesMap(trees);
      const actions = getGroupByIdWithSubgroups(treeGroups, groupId).flatMap((subGroupId) =>
        (groupToTreesMap[subGroupId] ?? []).map((tree) => makeAction(tree.treeId)),
      );
      dispatch(batchTreeColorActions(actions, batchName));
    },
    [dispatch, trees, treeGroups],
  );

  const setExpansionOfSubgroups = useCallback(
    (groupId: number, expanded: boolean) => {
      if (groupId === MISSING_GROUP_ID) {
        const allGroupIds = expanded
          ? treeGroups.flatMap((group) => getGroupByIdWithSubgroups(treeGroups, group.groupId))
          : [];
        dispatch(setExpandedTreeGroupsByIdsAction(new Set(allGroupIds)));
        return;
      }

      const expandedGroupIds = new Set(getExpandedGroups(treeGroups).map((group) => group.groupId));
      const subgroupIds = getGroupByIdWithSubgroups(treeGroups, groupId);
      for (const subgroupId of subgroupIds) {
        if (expanded) {
          expandedGroupIds.add(subgroupId);
        } else if (subgroupId !== groupId) {
          // Do not collapse the group itself, only its subgroups.
          expandedGroupIds.delete(subgroupId);
        }
      }
      dispatch(setExpandedTreeGroupsByIdsAction(expandedGroupIds));
    },
    [dispatch, treeGroups],
  );

  return useCallback(
    (node: GroupUiNode): MenuProps => {
      const groupId = node.group.groupId;
      const isEditingDisabled = !allowUpdate;
      const hasSubgroups = node.children.some((child) => child.type === "group");

      // Only one type of component can be active/selected at a time.
      const labelForActiveItems: "trees" | "tree" | "group" | null =
        selection.selectedTreeIds.length > 0
          ? "trees"
          : activeTreeId != null
            ? "tree"
            : activeGroupId != null
              ? "group"
              : null;

      const moveActiveItemsHere = () => {
        if (labelForActiveItems === "tree" && activeTreeId != null) {
          groupOperations.moveTreesToGroup([activeTreeId], groupId);
        } else if (labelForActiveItems === "trees") {
          groupOperations.moveTreesToGroup(selection.selectedTreeIds, groupId);
        } else if (labelForActiveItems === "group" && activeGroupId != null) {
          groupOperations.moveGroupToGroup(activeGroupId, groupId);
        }
      };

      return {
        items: [
          {
            key: "create",
            onClick: () => {
              groupOperations.createGroup(groupId);
              hideContextMenu();
            },
            disabled: isEditingDisabled,
            icon: <PlusOutlined />,
            label: "Create new group",
          },
          labelForActiveItems != null
            ? {
                key: "moveHere",
                onClick: () => {
                  moveActiveItemsHere();
                  hideContextMenu();
                },
                disabled: isEditingDisabled,
                icon: <ArrowRightOutlined />,
                label: `Move active ${labelForActiveItems} here`,
              }
            : null,
          {
            key: "delete",
            disabled: isEditingDisabled,
            onClick: () => {
              groupOperations.requestGroupDeletion(groupId);
              hideContextMenu();
            },
            icon: <DeleteOutlined />,
            label: "Delete group",
          },
          hasSubgroups
            ? {
                key: "collapseSubgroups",
                onClick: () => {
                  setExpansionOfSubgroups(groupId, false);
                  hideContextMenu();
                },
                icon: <ShrinkOutlined />,
                label: "Collapse all subgroups",
              }
            : null,
          hasSubgroups
            ? {
                key: "expandSubgroups",
                onClick: () => {
                  setExpansionOfSubgroups(groupId, true);
                  hideContextMenu();
                },
                icon: <ExpandAltOutlined />,
                label: "Expand all subgroups",
              }
            : null,
          {
            key: "hideTree",
            onClick: () => {
              dispatch(setActiveTreeGroupAction(groupId));
              dispatch(toggleInactiveTreesAction());
              hideContextMenu();
            },
            icon: <EyeOutlined />,
            label: "Hide/Show all other trees",
          },
          {
            key: "shuffleTreeGroupColors",
            onClick: () => {
              if (groupId === MISSING_GROUP_ID) {
                dispatch(shuffleAllTreeColorsAction());
              } else {
                dispatchForGroupTrees(groupId, shuffleTreeColorAction, "SHUFFLE_TREE_COLOR");
              }
            },
            icon: <Icon component={InvertIcon} />,
            label: "Shuffle Tree Group Colors",
          },
          {
            key: "setTreeGroupColor",
            disabled: isEditingDisabled,
            icon: <Icon component={PipetteIcon} />,
            label: (
              <ChangeColorMenuItemContent
                key={`changeTreeGroupColor-${groupId}`}
                title="Change Tree Group Color"
                isDisabled={isEditingDisabled}
                onSetColor={(color) => {
                  if (groupId === MISSING_GROUP_ID) {
                    setColorOfAllTrees(color);
                  } else {
                    dispatchForGroupTrees(
                      groupId,
                      (treeId) => setTreeColorAction(treeId, color),
                      "SET_TREE_COLOR",
                    );
                  }
                }}
                rgb={[0.5, 0.5, 0.5]}
              />
            ),
          },
        ],
      };
    },
    [
      dispatch,
      allowUpdate,
      selection.selectedTreeIds,
      activeTreeId,
      activeGroupId,
      groupOperations,
      hideContextMenu,
      setColorOfAllTrees,
      dispatchForGroupTrees,
      setExpansionOfSubgroups,
    ],
  );
}
