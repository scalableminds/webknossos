import {
  ArrowRightOutlined,
  DeleteOutlined,
  ExpandAltOutlined,
  FolderOutlined,
  PlusOutlined,
  ShrinkOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { type MenuProps, notification } from "antd";
import _ from "lodash";
import {
  LongUnitToShortUnitMap,
  type TreeType,
  TreeTypeEnum,
  type Vector3,
} from "oxalis/constants";
import type { Action } from "oxalis/model/actions/actions";
import type React from "react";
import { batchActions } from "redux-batched-actions";

import { ChangeColorMenuItemContent } from "components/color_picker";
import FastTooltip from "components/fast_tooltip";
import { formatLengthAsVx, formatNumberToLength } from "libs/format_utils";
import messages from "messages";
import {
  deleteTreeAction,
  setActiveTreeAction,
  setActiveTreeGroupAction,
  setExpandedTreeGroupsByKeysAction,
  setTreeColorAction,
  setTreeEdgeVisibilityAction,
  setTreeGroupAction,
  setTreeGroupsAction,
  setTreeNameAction,
  setTreeTypeAction,
  shuffleAllTreeColorsAction,
  shuffleTreeColorAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { getMaximumGroupId } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { Store, api } from "oxalis/singletons";
import type { Tree, TreeGroup, TreeMap } from "oxalis/store";
import EditableTextLabel from "oxalis/view/components/editable_text_label";
import {
  GroupTypeEnum,
  MISSING_GROUP_ID,
  type TreeNode,
  anySatisfyDeep,
  callDeep,
  createGroupToTreesMap,
  getGroupByIdWithSubgroups,
  getNodeKey,
  makeBasicGroupObject,
} from "oxalis/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { ColoredDotIcon } from "../segments_tab/segment_list_item";
import { HideTreeEdgesIcon } from "./hide_tree_edges_icon";

export type Props = {
  activeTreeId: number | null | undefined;
  activeGroupId: number | null | undefined;
  treeGroups: TreeGroup[];
  sortBy: string;
  trees: TreeMap;
  selectedTreeIds: number[];
  onSingleSelectTree: (treeId: number, dispatchSetActiveTree: boolean) => void;
  onMultiSelectTree: (treeId: number) => void;
  onRangeSelectTrees: (treeIds: number[]) => void;
  deselectAllTrees: () => void;
  onDeleteGroup: (arg0: number) => void;
  allowUpdate: boolean;
};

export function renderTreeNode(
  props: Props,
  onOpenContextMenu: (menu: MenuProps, event: React.MouseEvent<HTMLDivElement>) => void,
  hideContextMenu: () => void,
  node: TreeNode,
): React.ReactNode {
  const tree = props.trees[node.id];
  if (!tree) return null;

  const maybeProofreadingIcon =
    tree.type === TreeTypeEnum.AGGLOMERATE ? (
      <FastTooltip title="Agglomerate Skeleton">
        <i className="fas fa-clipboard-check icon-margin-right" />
      </FastTooltip>
    ) : null;

  return (
    <div
      onContextMenu={(evt) =>
        onOpenContextMenu(createMenuForTree(tree, props, hideContextMenu), evt)
      }
      style={{ wordBreak: "break-word" }}
    >
      <ColoredDotIcon colorRGBA={[...tree.color, 1.0]} />
      {`(${tree.nodes.size()}) `} {maybeProofreadingIcon}
      <EditableTextLabel
        value={tree.name}
        label="Tree Name"
        onChange={(newValue) => Store.dispatch(setTreeNameAction(newValue, tree.treeId))}
        hideEditIcon
        margin={0}
      />
      {(tree.metadata || []).length > 0 ? (
        <FastTooltip
          className="deemphasized icon-margin-left"
          title="This tree has assigned metadata properties."
        >
          <TagsOutlined />
        </FastTooltip>
      ) : null}
    </div>
  );
}

const createMenuForTree = (tree: Tree, props: Props, hideContextMenu: () => void): MenuProps => {
  const isEditingDisabled = !props.allowUpdate;
  const isAgglomerateSkeleton = tree.type === TreeTypeEnum.AGGLOMERATE;

  return {
    items: [
      {
        key: "changeTreeColor",
        disabled: isEditingDisabled,
        icon: <i className="fas fa-eye-dropper fa-sm " />,
        label: (
          <ChangeColorMenuItemContent
            title="Change Tree Color"
            isDisabled={isEditingDisabled}
            onSetColor={(color) => {
              setTreeColor(tree.treeId, color);
            }}
            rgb={tree.color}
          />
        ),
      },
      {
        key: "shuffleTreeColor",
        onClick: () => shuffleTreeColor(tree.treeId),
        title: "Shuffle Tree Color",
        disabled: isEditingDisabled,
        icon: <i className="fas fa-adjust" />,
        label: "Shuffle Tree Color",
      },
      {
        key: "deleteTree",
        onClick: () => {
          props.deselectAllTrees();
          Store.dispatch(deleteTreeAction(tree.treeId));
          hideContextMenu();
        },
        title: "Delete Tree",
        disabled: isEditingDisabled,
        icon: <i className="fas fa-trash" />,
        label: "Delete Tree",
      },
      {
        key: "measureSkeleton",
        onClick: () => {
          handleMeasureSkeletonLength(tree.treeId, tree.name);
          hideContextMenu();
        },
        title: "Measure Tree Length",
        icon: <i className="fas fa-ruler" />,
        label: "Measure Tree Length",
      },
      {
        key: "hideTree",
        onClick: () => {
          setActiveTree(tree.treeId);
          toggleHideInactiveTrees();
          hideContextMenu();
        },
        title: "Hide/Show All Other Trees",
        icon: <i className="fas fa-eye" />,
        label: "Hide/Show All Other Trees",
      },
      {
        key: "hideTreeEdges",
        onClick: () => {
          setActiveTree(tree.treeId);
          setTreeEdgesVisibility(tree.treeId, !tree.edgesAreVisible);
          hideContextMenu();
        },
        title: "Hide/Show Edges of This Tree",
        icon: <HideTreeEdgesIcon />,
        label: "Hide/Show Edges of This Tree",
      },
      isAgglomerateSkeleton
        ? {
            key: "convertToNormalSkeleton",
            onClick: () => {
              setTreeType(tree.treeId, TreeTypeEnum.DEFAULT);
              hideContextMenu();
            },
            title: "Convert to Normal Tree",
            icon: <span className="fas fa-clipboard-check" />,
            label: "Convert to Normal Tree",
          }
        : null,
    ],
  };
};

export function renderGroupNode(
  props: Props,
  onOpenContextMenu: (menu: MenuProps, event: React.MouseEvent<HTMLDivElement>) => void,
  hideContextMenu: () => void,
  node: TreeNode,
  expandedNodeKeys: string[],
) {
  // The root group must not be removed or renamed
  const { id, name } = node;

  // Make sure the displayed name is not empty
  const displayableName = name.trim() || "<Unnamed Group>";
  return (
    <div
      onContextMenu={(evt) =>
        onOpenContextMenu(
          createMenuForTreeGroup(props, hideContextMenu, node, expandedNodeKeys),
          evt,
        )
      }
      style={{ wordBreak: "break-word" }}
    >
      <FolderOutlined className="icon-margin-right" />
      <EditableTextLabel
        value={displayableName}
        label="Group Name"
        onChange={(newValue) => api.tracing.renameSkeletonGroup(id, newValue)}
        hideEditIcon
        margin={0}
      />
      {}
    </div>
  );
}

const createMenuForTreeGroup = (
  props: Props,
  hideContextMenu: () => void,
  node: TreeNode,
  expandedNodeKeys: string[],
): MenuProps => {
  const { id } = node;

  const isEditingDisabled = !props.allowUpdate;
  const hasSubgroup = anySatisfyDeep(node.children, (child) => child.type === GroupTypeEnum.GROUP);
  const labelForActiveItems = getLabelForActiveItems();

  function createGroup(groupId: number) {
    const newTreeGroups = _.cloneDeep(props.treeGroups);

    const newGroupId = getMaximumGroupId(newTreeGroups) + 1;
    const newGroup = makeBasicGroupObject(newGroupId, `Group ${newGroupId}`);

    if (groupId === MISSING_GROUP_ID) {
      newTreeGroups.push(newGroup);
    } else {
      callDeep(newTreeGroups, groupId, (item) => {
        item.children.push(newGroup);
      });
    }

    setUpdateTreeGroups(newTreeGroups);
    selectGroupById(props.deselectAllTrees, newGroupId);
  }

  function shuffleTreeGroupColors(groupId: number) {
    const groupToTreeMap = createGroupToTreesMap(props.trees);
    const groupIdWithSubgroups = getGroupByIdWithSubgroups(props.treeGroups, groupId);
    const shuffleTreeColorActions = groupIdWithSubgroups.flatMap((subGroupId) => {
      if (subGroupId in groupToTreeMap)
        return groupToTreeMap[subGroupId].map((tree) => shuffleTreeColorAction(tree.treeId));
      return [];
    });
    onBatchActions(shuffleTreeColorActions, "SHUFFLE_TREE_COLOR");
  }

  function setTreeGroupColor(groupId: number, color: Vector3) {
    const groupToTreeMap = createGroupToTreesMap(props.trees);
    const groupIdWithSubgroups = getGroupByIdWithSubgroups(props.treeGroups, groupId);
    const setTreeColorActions = groupIdWithSubgroups.flatMap((subGroupId) => {
      if (subGroupId in groupToTreeMap)
        return groupToTreeMap[subGroupId].map((tree) => setTreeColorAction(tree.treeId, color));
      return [];
    });
    onBatchActions(setTreeColorActions, "SET_TREE_COLOR");
  }

  function setAllTreesColor(color: Vector3) {
    const setTreeColorActions = Object.values(props.trees).map((tree) =>
      setTreeColorAction(tree.treeId, color),
    );
    onBatchActions(setTreeColorActions, "SET_TREE_COLOR");
  }

  function getLabelForActiveItems(): "trees" | "tree" | "group" | null {
    // Only one type of component can be selected. It is not possible to select multiple groups.
    if (props.selectedTreeIds.length > 0) {
      return "trees";
    } else if (props.activeTreeId != null) {
      return "tree";
    } else if (props.activeGroupId != null) {
      return "group";
    }
    return null;
  }

  function setExpansionOfAllSubgroupsTo(parentGroup: TreeNode, expanded: boolean) {
    if (parentGroup.id === MISSING_GROUP_ID) {
      if (!expanded) {
        setExpandedGroups(new Set([]));
      } else {
        const newGroups = props.treeGroups.flatMap((group) =>
          getGroupByIdWithSubgroups(props.treeGroups, group.groupId),
        );
        const expandedGroupKeys = newGroups.map((groupId) =>
          getNodeKey(GroupTypeEnum.GROUP, groupId),
        );
        setExpandedGroups(new Set(expandedGroupKeys));
      }
    } else {
      // group is not the root group
      const subGroups = getGroupByIdWithSubgroups(props.treeGroups, parentGroup.id).map((groupId) =>
        getNodeKey(GroupTypeEnum.GROUP, groupId),
      );
      if (expanded) {
        const newExpandedKeys = new Set([...expandedNodeKeys, ...subGroups]);
        setExpandedGroups(newExpandedKeys);
      } else {
        const parentGroupNode = getNodeKey(GroupTypeEnum.GROUP, parentGroup.id);
        // If the subgroups should be collapsed, do not collapse the group itself, if it was expanded before.
        const subGroupsWithoutParent = subGroups.filter((groupKey) => groupKey !== parentGroupNode);
        const newExpandedKeys = _.difference(expandedNodeKeys, subGroupsWithoutParent);
        setExpandedGroups(new Set(newExpandedKeys));
      }
    }
  }

  function onMoveWithContextAction(targetParentNode: TreeNode) {
    const activeComponent = getLabelForActiveItems();
    const targetGroupId = targetParentNode.id === MISSING_GROUP_ID ? null : targetParentNode.id;
    let allTreesToMove;
    if (activeComponent === "tree") {
      allTreesToMove = [props.activeTreeId];
    } else if (activeComponent === "trees") {
      allTreesToMove = props.selectedTreeIds;
    }
    if (allTreesToMove) {
      const moveActions = allTreesToMove.map((treeId) =>
        setTreeGroupAction(
          targetGroupId,
          // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
          treeId,
        ),
      );
      onBatchActions(moveActions, "SET_TREE_GROUP");
    } else if (activeComponent === "group" && props.activeGroupId != null) {
      api.tracing.moveSkeletonGroup(props.activeGroupId, targetGroupId);
    }
  }

  return {
    items: [
      {
        key: "create",
        onClick: () => {
          createGroup(id);
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
              onMoveWithContextAction(node);
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
        onClick: () => props.onDeleteGroup(id),
        icon: <DeleteOutlined />,
        label: "Delete group",
      },
      hasSubgroup
        ? {
            key: "collapseSubgroups",
            onClick: () => {
              setExpansionOfAllSubgroupsTo(node, false);
              hideContextMenu();
            },
            icon: <ShrinkOutlined />,
            label: "Collapse all subgroups",
          }
        : null,
      hasSubgroup
        ? {
            key: "expandSubgroups",
            onClick: () => {
              setExpansionOfAllSubgroupsTo(node, true);
              hideContextMenu();
            },
            icon: <ExpandAltOutlined />,
            label: "Expand all subgroups",
          }
        : null,
      {
        key: "hideTree",
        onClick: () => {
          setActiveTreeGroup(id);
          toggleHideInactiveTrees();
          hideContextMenu();
        },
        icon: <i className="fas fa-eye" />,
        label: "Hide/Show all other trees",
      },
      {
        key: "shuffleTreeGroupColors",
        onClick: () => {
          if (id === MISSING_GROUP_ID) shuffleAllTreeColors();
          else shuffleTreeGroupColors(id);
        },
        icon: <i className="fas fa-adjust" />,
        label: "Shuffle Tree Group Colors",
      },
      {
        key: "setTreeGroupColor",
        disabled: isEditingDisabled,
        icon: <i className="fas fa-eye-dropper fa-sm " />,
        label: (
          <ChangeColorMenuItemContent
            title="Change Tree Group Color"
            isDisabled={isEditingDisabled}
            onSetColor={(color) => {
              if (id === MISSING_GROUP_ID) setAllTreesColor(color);
              else setTreeGroupColor(id, color);
            }}
            rgb={[0.5, 0.5, 0.5]}
          />
        ),
      },
    ],
  };
};

function toggleHideInactiveTrees() {
  Store.dispatch(toggleInactiveTreesAction());
}

function shuffleAllTreeColors() {
  Store.dispatch(shuffleAllTreeColorsAction());
}

function setTreeType(treeId: number, type: TreeType) {
  Store.dispatch(setTreeTypeAction(treeId, type));
}

function setActiveTree(treeId: number) {
  Store.dispatch(setActiveTreeAction(treeId));
}
function setTreeColor(treeId: number, color: Vector3) {
  Store.dispatch(setTreeColorAction(treeId, color));
}

function shuffleTreeColor(treeId: number) {
  Store.dispatch(shuffleTreeColorAction(treeId));
}
function setTreeEdgesVisibility(treeId: number, edgesAreVisible: boolean) {
  Store.dispatch(setTreeEdgeVisibilityAction(treeId, edgesAreVisible));
}

export function onBatchActions(actions: Action[], actionName: string) {
  Store.dispatch(batchActions(actions, actionName));
}

export function setUpdateTreeGroups(treeGroups: TreeGroup[]) {
  Store.dispatch(setTreeGroupsAction(treeGroups));
}

export function selectGroupById(deselectAllTrees: () => void, groupId: number) {
  deselectAllTrees();
  setActiveTreeGroup(groupId);
}

function setActiveTreeGroup(groupId: number) {
  Store.dispatch(setActiveTreeGroupAction(groupId));
}

export function setExpandedGroups(expandedTreeGroups: Set<string>) {
  Store.dispatch(setExpandedTreeGroupsByKeysAction(expandedTreeGroups));
}

function handleMeasureSkeletonLength(treeId: number, treeName: string) {
  const dataSourceUnit = Store.getState().dataset.dataSource.scale.unit;
  const [lengthInUnit, lengthInVx] = api.tracing.measureTreeLength(treeId);

  notification.open({
    message: messages["tracing.tree_length_notification"](
      treeName,
      formatNumberToLength(lengthInUnit, LongUnitToShortUnitMap[dataSourceUnit]),
      formatLengthAsVx(lengthInVx),
    ),
    icon: <i className="fas fa-ruler" />,
  });
}
