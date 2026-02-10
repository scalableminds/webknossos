import type { DataNode } from "antd/es/tree";
import cloneDeep from "lodash-es/cloneDeep";
import groupBy from "lodash-es/groupBy";
import orderBy from "lodash-es/orderBy";
import memoizeOne from "memoize-one";
import type { Tree, TreeGroup, TreeMap } from "viewer/model/types/tree_types";
import type { Segment, SegmentGroup, SegmentMap } from "viewer/store";
import type { SegmentHierarchyNode } from "../segments_tab/segments_view_helper";

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
    isExpanded: false,
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
    const trees = orderBy(groupToTreesMap[groupId] || [], [sortBy], ["asc"]).map(
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
      children: orderBy(treeNodeChildren, [sortBy], ["asc"]),
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

export function findGroup(groups: TreeGroup[], groupId: number): TreeGroup | null {
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

function forEachTreeNode(groups: TreeNode[], callback: (arg0: TreeNode) => void) {
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

function _createGroupToTreesMap(trees: TreeMap): Record<number, Tree[]> {
  return groupBy(trees.values().toArray(), (tree) =>
    tree.groupId != null ? tree.groupId : MISSING_GROUP_ID,
  );
}

export const createGroupToTreesMap = memoizeOne(_createGroupToTreesMap);

export function createGroupToParentMap(
  groups: TreeGroup[],
): Record<number, number | null | undefined> {
  const groupToParentId: Record<number, number | null | undefined> = {};
  function insertParentId(group: TreeGroup) {
    if (group.children) {
      group.children.forEach((child) => {
        groupToParentId[child.groupId] = group.groupId;
        insertParentId(child);
      });
    }
  }
  groups.forEach((group) => {
    insertParentId(group);
  });
  return groupToParentId;
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

export function getExpandedGroups(groups: TreeGroup[]): TreeGroup[] {
  return deepFlatFilter(groups, (group) => group.isExpanded ?? true);
}

export function getGroupByIdWithSubgroups(
  treeGroups: TreeGroup[],
  groupId: number | undefined,
): number[] {
  /*
   * Given a nested array of groups and a group id,
   * returns the ids of the given group and all its
   * subgroups.
   */
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
  if (targetGroupId == null) {
    // Guard against explicitly passed null or undefined.
    targetGroupId = MISSING_GROUP_ID;
  }
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

export function createGroupHelper(
  segmentGroups: TreeGroup[],
  name: string | null | undefined,
  newGroupId: number,
  parentGroupId: number | null | undefined,
) {
  if (parentGroupId == null) {
    // Guard against explicitly passed null or undefined.
    parentGroupId = MISSING_GROUP_ID;
  }

  const newSegmentGroups = cloneDeep(segmentGroups);
  const newGroup = {
    name: name || `Group ${newGroupId}`,
    groupId: newGroupId,
    children: [],
  };

  if (parentGroupId === MISSING_GROUP_ID) {
    newSegmentGroups.push(newGroup);
  } else {
    callDeep(newSegmentGroups, parentGroupId, (item) => {
      item.children.push(newGroup);
    });
  }
  return { newSegmentGroups, newGroupId };
}

export function deepFlatFilter<T extends TreeNode | TreeGroup | SegmentHierarchyNode>(
  nodes: T[],
  predicate: (node: T) => boolean,
): T[] {
  // Apply a deep "filter" function to a Tree/Group hierarchy structure, traversing along their children.
  // The resulting items are flattened into a single array.
  return nodes.reduce((acc: T[], node: T) => {
    if (predicate(node)) {
      acc.push(node);
    }
    if (node.children) {
      acc.push(...deepFlatFilter(node.children as T[], predicate));
    }
    return acc;
  }, []);
}

export function getNodeKey(type: GroupTypeEnum, id: number): string {
  return `${type}-${id.toString()}`;
}

export function getGroupNodeKey(groupId: number): string {
  return getNodeKey(GroupTypeEnum.GROUP, groupId);
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

export function additionallyExpandGroup<T extends string | number>(
  groups: TreeGroup[],
  groupId: number | null | undefined,
  groupIdToKey: (groupId: number) => T,
): Set<T> | null {
  if (!groupId) {
    return null;
  }
  const groupToParentGroupId = createGroupToParentMap(groups);
  const expandedGroups = new Set(
    getExpandedGroups(groups).map((group) => groupIdToKey(group.groupId)),
  );
  let currentGroupId: number | undefined | null = groupId;
  while (currentGroupId) {
    expandedGroups.add(groupIdToKey(currentGroupId));
    currentGroupId = groupToParentGroupId[currentGroupId];
  }
  return expandedGroups;
}

function mapGroupsWithRoot(groups: TreeGroup[], fn: (g: TreeGroup) => TreeGroup): TreeGroup[] {
  // Add the virtual root group so that the map function can also mutate
  // the high-level elements (e.g., filtering elements in the first level).
  return mapGroups(
    [
      {
        name: "Root",
        groupId: MISSING_GROUP_ID,
        children: groups,
      },
    ],
    fn,
  )[0].children; // Read the root group's children again
}

function mapGroupAndChildrenHelper(group: TreeGroup, fn: (g: TreeGroup) => TreeGroup): TreeGroup {
  const newChildren = mapGroups(group.children, fn);
  return fn({ ...group, children: newChildren });
}

export function mapGroups(groups: TreeGroup[], fn: (g: TreeGroup) => TreeGroup): TreeGroup[] {
  return groups.map((group) => mapGroupAndChildrenHelper(group, fn));
}
