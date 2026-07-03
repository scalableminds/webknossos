import type { BasicDataNode } from "antd/es/tree";
import orderBy from "lodash-es/orderBy";
import type { Tree, TreeGroup, TreeMap } from "viewer/model/types/tree_types";
import {
  createGroupToTreesMap,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";

export type TreeSortBy = "name" | "timestamp";

/*
 * The skeleton hierarchy is modeled as a discriminated union that antd's <Tree />
 * can consume directly (via its generic treeData + titleRender). Each node carries
 * its domain object (Tree or TreeGroup), so consumers never need to convert
 * between store data and widget data.
 */
export type TreeUiNode = BasicDataNode & {
  type: "tree";
  key: string;
  tree: Tree;
  isLeaf: true;
  children?: undefined;
};

export type GroupUiNode = BasicDataNode & {
  type: "group";
  key: string;
  group: TreeGroup;
  children: SkeletonUiNode[];
  // Whether any tree exists in this group or one of its descendants.
  containsTrees: boolean;
};

export type SkeletonUiNode = TreeUiNode | GroupUiNode;

export function getTreeNodeKey(treeId: number): string {
  return `tree-${treeId}`;
}

export function getGroupNodeKey(groupId: number): string {
  return `group-${groupId}`;
}

export function getNodeName(node: SkeletonUiNode): string {
  return node.type === "tree" ? node.tree.name : node.group.name;
}

export function isRootGroupNode(node: SkeletonUiNode): boolean {
  return node.type === "group" && node.group.groupId === MISSING_GROUP_ID;
}

export type SkeletonHierarchy = {
  // The (virtual) root group node wrapping all top-level groups and trees.
  // This is what should be passed to the antd Tree as treeData.
  roots: [GroupUiNode];
  // All nodes (including the root group) in rendered (DFS) order.
  flatNodes: SkeletonUiNode[];
  // Keys of visible trees and of groups whose descendant trees are all visible.
  checkedKeys: string[];
  // Keys of expanded groups (derived from TreeGroup.isExpanded).
  expandedKeys: string[];
  treeNodesById: Map<number, TreeUiNode>;
  groupNodesById: Map<number, GroupUiNode>;
  nodesByKey: Map<string, SkeletonUiNode>;
};

// Groups are sorted by name (or kept before trees when sorting by timestamp),
// trees are sorted by the user-selected sort property.
function getSortValue(node: SkeletonUiNode, sortBy: TreeSortBy): string | number {
  if (node.type === "tree") {
    return node.tree[sortBy];
  }
  return sortBy === "name" ? node.group.name : 0;
}

export function buildSkeletonHierarchy(
  trees: TreeMap,
  treeGroups: TreeGroup[],
  sortBy: TreeSortBy,
): SkeletonHierarchy {
  const groupToTreesMap = createGroupToTreesMap(trees);
  const treeNodesById = new Map<number, TreeUiNode>();
  const groupNodesById = new Map<number, GroupUiNode>();
  const nodesByKey = new Map<string, SkeletonUiNode>();
  const checkedKeySet = new Set<string>();
  const expandedKeys: string[] = [];

  const buildTreeNode = (tree: Tree): TreeUiNode => {
    const node: TreeUiNode = {
      type: "tree",
      key: getTreeNodeKey(tree.treeId),
      tree,
      isLeaf: true,
    };
    treeNodesById.set(tree.treeId, node);
    nodesByKey.set(node.key, node);
    if (tree.isVisible) {
      checkedKeySet.add(node.key);
    }
    return node;
  };

  const buildGroupNode = (group: TreeGroup): GroupUiNode => {
    const childGroupNodes = group.children.map(buildGroupNode);
    const treeNodes = (groupToTreesMap[group.groupId] ?? []).map(buildTreeNode);
    const children = orderBy(
      [...childGroupNodes, ...treeNodes],
      [(node) => getSortValue(node, sortBy)],
      ["asc"],
    );

    const node: GroupUiNode = {
      type: "group",
      key: getGroupNodeKey(group.groupId),
      group,
      children,
      containsTrees:
        treeNodes.length > 0 || childGroupNodes.some((childNode) => childNode.containsTrees),
      // Groups without any content cannot be toggled.
      disableCheckbox: children.length === 0,
    };
    groupNodesById.set(group.groupId, node);
    nodesByKey.set(node.key, node);

    // A group counts as visible if all its tree-containing children are visible.
    // Empty subgroups do not influence the checked state of their parents.
    const isChecked = children.every((child) =>
      child.type === "tree"
        ? child.tree.isVisible
        : checkedKeySet.has(child.key) || !child.containsTrees,
    );
    if (isChecked) {
      checkedKeySet.add(node.key);
    }
    if (group.isExpanded ?? true) {
      expandedKeys.push(node.key);
    }
    return node;
  };

  const rootGroup: TreeGroup = {
    name: "Root",
    groupId: MISSING_GROUP_ID,
    children: treeGroups,
    isExpanded: true,
  };
  const rootNode = buildGroupNode(rootGroup);

  const flatNodes: SkeletonUiNode[] = [];
  const collectDepthFirst = (node: SkeletonUiNode) => {
    flatNodes.push(node);
    if (node.type === "group") {
      node.children.forEach(collectDepthFirst);
    }
  };
  collectDepthFirst(rootNode);

  return {
    roots: [rootNode],
    flatNodes,
    checkedKeys: Array.from(checkedKeySet),
    expandedKeys,
    treeNodesById,
    groupNodesById,
    nodesByKey,
  };
}
