import { type DataNode } from "antd/es/tree";
import Toast from "libs/toast";
import _ from "lodash";
import Constants, { Vector3, Vector6 } from "oxalis/constants";
import { mapGroupsWithRoot } from "oxalis/model/accessors/skeletontracing_accessor";
import { Store, api } from "oxalis/singletons";
import type { Tree, TreeGroup, SegmentMap, Segment, TreeMap, SegmentGroup } from "oxalis/store";
import * as Utils from "libs/utils";
import { updateSegmentAction } from "oxalis/model/actions/volumetracing_actions";

export const MISSING_GROUP_ID = -1;

export enum GroupTypeEnum {
  GROUP = "Group",
  TREE = "Tree",
}

export interface TreeNode extends DataNode {
  name: string;
  id: number;
  expanded: boolean;
  isChecked: boolean;
  containsTrees: boolean;
  timestamp: number;
  type: GroupTypeEnum;
  children: TreeNode[];
}

export function makeBasicGroupObject(
  groupId: number,
  name: string,
  children: TreeGroup[] = [],
): TreeGroup {
  return {
    groupId,
    name,
    children,
  };
}

function makeTreeNode(
  id: number,
  name: string,
  type: GroupTypeEnum,
  optionalProperties: Partial<TreeNode> = {},
): TreeNode {
  return {
    key: getNodeKey(type, id),
    id,
    type,
    title: name,
    name,
    timestamp: 0,
    children: [],
    expanded: true,
    isChecked: true,
    containsTrees: false,
    ...optionalProperties,
  };
}

function makeTreeNodeFromTree(tree: Tree): TreeNode {
  return makeTreeNode(tree.treeId, tree.name, GroupTypeEnum.TREE, {
    isChecked: tree.isVisible,
    timestamp: tree.timestamp,
    containsTrees: true,
  });
}

function makeTreeNodeFromGroup(group: TreeGroup, optionalProperties: Partial<TreeNode>): TreeNode {
  return makeTreeNode(group.groupId, group.name, GroupTypeEnum.GROUP, optionalProperties);
}

export function insertTreesAndTransform(
  groups: TreeGroup[],
  groupToTreesMap: Record<number, Tree[]>,
  sortBy: string,
): TreeNode[] {
  // Insert all trees into their respective groups in the group hierarchy and transform groups to tree nodes
  return groups.map((group) => {
    const { groupId } = group;

    // Groups are always sorted by name and appear before the trees, trees are sorted according to the sortBy prop
    const trees = _.orderBy(groupToTreesMap[groupId] || [], [sortBy], ["asc"]).map(
      makeTreeNodeFromTree,
    );

    const treeNodeChildren = insertTreesAndTransform(
      group.children,
      groupToTreesMap,
      sortBy,
    ).concat(trees);
    const treeNode = makeTreeNodeFromGroup(group, {
      // Ensure that groups are always at the top when sorting by timestamp
      timestamp: 0,
      children: _.orderBy(treeNodeChildren, [sortBy], ["asc"]),
      disableCheckbox: treeNodeChildren.length === 0,
      expanded: group.isExpanded == null || group.isExpanded,
      isChecked: treeNodeChildren.every(
        // Groups that don't contain any trees should not influence the state of their parents
        (groupOrTree) => groupOrTree.isChecked || !groupOrTree.containsTrees,
      ),
      containsTrees:
        trees.length > 0 || treeNodeChildren.some((groupOrTree) => groupOrTree.containsTrees),
    });
    return treeNode;
  });
}
export function callDeep(
  groups: TreeGroup[],
  groupId: number,
  callback: (
    group: TreeGroup,
    index: number,
    treeGroups: TreeGroup[],
    parentGroupId: number | null | undefined,
  ) => void,
  parentGroupId: number | null | undefined = MISSING_GROUP_ID,
) {
  // Deeply traverse the group hierarchy and execute the callback function when the treeNode with id groupId is found
  groups.forEach((group: TreeGroup, index: number, array: TreeGroup[]) => {
    if (group.groupId === groupId) {
      callback(group, index, array, parentGroupId);
    } else if (group.children) {
      callDeep(group.children, groupId, callback, group.groupId);
    }
  });
}
export function callDeepWithChildren(
  groups: TreeGroup[],
  groupId: number | undefined,
  callback: (
    group: TreeGroup,
    index: number,
    treeGroups: TreeGroup[],
    parentGroupId: number | null | undefined,
  ) => void,
  parentGroupId: number | null | undefined = MISSING_GROUP_ID,
  isWithinTargetGroup: boolean = false,
) {
  // Deeply traverse the group hierarchy and execute the callback function when the treeNode with id groupId is found
  groups.forEach((group: TreeGroup, index: number, array: TreeGroup[]) => {
    const shouldVisit = isWithinTargetGroup || group.groupId === groupId;

    if (shouldVisit) {
      callback(group, index, array, parentGroupId);
    }

    if (group.children) {
      callDeepWithChildren(group.children, groupId, callback, group.groupId, shouldVisit);
    }
  });
}

export function findGroup(groups: TreeGroup[], groupId: number): TreeGroup | null | undefined {
  let foundGroup = null;
  callDeep(groups, groupId, (group, _index, _groups) => {
    foundGroup = group;
  });
  return foundGroup;
}

export function findParentIdForGroupId(
  groups: TreeGroup[],
  groupId: number,
): number | undefined | null {
  let foundParentGroupId: number | undefined | null = null;
  callDeep(groups, groupId, (_group, _index, _groups, parentGroupId) => {
    foundParentGroupId = parentGroupId;
  });
  return foundParentGroupId;
}

export function forEachTreeNode(groups: TreeNode[], callback: (arg0: TreeNode) => void) {
  for (const group of groups) {
    callback(group);

    if (group.children) {
      forEachTreeNode(group.children, callback);
    }
  }
}
export function anySatisfyDeep(groups: TreeNode[], testFunction: (arg0: TreeNode) => boolean) {
  for (const group of groups) {
    if (testFunction(group)) {
      return true;
    }

    if (group.children) {
      if (anySatisfyDeep(group.children, testFunction)) {
        return true;
      }
    }
  }

  return false;
}

export function findTreeNode(groups: TreeNode[], id: number, callback: (arg0: TreeNode) => any) {
  for (const group of groups) {
    if (group.id === id) {
      callback(group);
    } else if (group.children) {
      findTreeNode(group.children, id, callback);
    }
  }
}

export function createGroupToTreesMap(trees: TreeMap): Record<number, Tree[]> {
  return _.groupBy(trees, (tree) => (tree.groupId != null ? tree.groupId : MISSING_GROUP_ID));
}

export function createGroupToSegmentsMap(segments: SegmentMap): Record<number, Segment[]> {
  const groupToSegments: Record<number, Segment[]> = {};
  for (const segment of segments.values()) {
    const { groupId } = segment;
    const keyId = groupId || MISSING_GROUP_ID;

    groupToSegments[keyId] ||= [];
    groupToSegments[keyId].push(segment);
  }

  return groupToSegments;
}

export function getGroupByIdWithSubgroups(
  treeGroups: TreeGroup[],
  groupId: number | undefined,
): number[] {
  const groupWithSubgroups: number[] = [];
  callDeepWithChildren(treeGroups, groupId, (treeGroup) => {
    groupWithSubgroups.push(treeGroup.groupId);
  });
  return groupWithSubgroups;
}

export function moveGroupsHelper(
  groups: TreeGroup[] | SegmentGroup[],
  groupId: number,
  targetGroupId: number | null | undefined,
): TreeGroup[] | SegmentGroup[] {
  const movedGroup = findGroup(groups, groupId);
  if (!movedGroup) {
    throw new Error("Could not find group to move");
  }

  const groupsWithoutDraggedGroup = mapGroupsWithRoot(groups, (parentGroup) => ({
    ...parentGroup,
    children: parentGroup.children.filter((subgroup) => subgroup.groupId !== movedGroup.groupId),
  }));
  const newGroups = mapGroupsWithRoot(groupsWithoutDraggedGroup, (parentGroup) => ({
    ...parentGroup,
    children:
      parentGroup.groupId === targetGroupId
        ? parentGroup.children.concat([movedGroup])
        : parentGroup.children,
  }));
  return newGroups;
}

export function deepFlatFilter(
  nodes: TreeNode[],
  predicate: (node: TreeNode) => boolean,
): TreeNode[] {
  // Apply a deep "filter" function to a Tree/Group hierarchy structure, traversing along their children.
  // The resulting items are flattened into a single array.
  return nodes.reduce((acc: TreeNode[], node: TreeNode) => {
    if (predicate(node)) {
      acc.push(node);
    }
    if (node.children) {
      acc.push(...deepFlatFilter(node.children, predicate));
    }
    return acc;
  }, []);
}

export function getNodeKey(type: GroupTypeEnum, id: number): string {
  return `${type}-${id.toString()}`;
}

export function getNodeKeyFromNode(node: TreeNode): string {
  return getNodeKey(node.type, node.id);
}

export function findParentGroupNode(nodes: TreeNode[], parentGroupId: number): TreeNode | null {
  let foundParentNode: TreeNode | null = null;
  forEachTreeNode(nodes, (node) => {
    if (node.type === GroupTypeEnum.GROUP && node.id === parentGroupId) {
      foundParentNode = node;
    }
  });
  return foundParentNode;
}

export const registerSegmentsForBoundingBox = async (value: Vector6, bbName: string) => {
  const min: Vector3 = [value[0], value[1], value[2]];
  const max: Vector3 = [value[0] + value[3], value[1] + value[4], value[2] + value[5]];

  const shape = Utils.computeShapeFromBoundingBox({ min, max });
  const volume = Math.ceil(shape[0] * shape[1] * shape[2]);
  const maxVolume = Constants.REGISTER_SEGMENTS_BB_MAX_VOLUME_VX;
  if (volume > maxVolume) {
    Toast.error(
      "The volume of the bounding box is too large, please reduce the size of the bounding box.",
    );
    return;
  } else if (volume > maxVolume / 8) {
    Toast.warning(
      "The volume of the bounding box is very large, registering all segments might take a while.",
    );
  }

  const segmentationLayerName = api.data.getSegmentationLayerNames()[0];
  const data = await api.data.getDataForBoundingBox(segmentationLayerName, {
    min,
    max,
  });

  const segmentIdToPosition = new Map();
  let idx = 0;
  for (let z = min[2]; z < max[2]; z++) {
    for (let y = min[1]; y < max[1]; y++) {
      for (let x = min[0]; x < max[0]; x++) {
        const id = data[idx];
        if (!segmentIdToPosition.has(id)) {
          segmentIdToPosition.set(id, [x, y, z]);
        }
        idx++;
      }
    }
  }

  const segmentIds = Array.from(segmentIdToPosition.entries());
  const maxNoSegments = Constants.REGISTER_SEGMENTS_BB_MAX_NO_SEGMENTS;
  const halfMaxNoSegments = maxNoSegments / 2;
  if (segmentIds.length > maxNoSegments) {
    Toast.error(
      `The bounding box contains more than ${maxNoSegments} segments. Please reduce the size of the bounding box.`,
    );
    return;
  } else if (segmentIds.length > halfMaxNoSegments) {
    Toast.warning(
      `The bounding box contains more than ${halfMaxNoSegments} segments. Registering all segments might take a while.`,
    );
  }

  const groupId = api.tracing.createSegmentGroup(
    `Segments for BBox ${bbName}`,
    -1,
    segmentationLayerName,
  );
  for (const [segmentId, position] of segmentIdToPosition.entries()) {
    api.tracing.registerSegment(segmentId, position, undefined, segmentationLayerName);
    Store.dispatch(
      updateSegmentAction(segmentId, { groupId, id: segmentId }, segmentationLayerName),
    );
  }
};
