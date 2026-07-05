import type { BasicDataNode } from "antd/es/tree";
import sortBy from "lodash-es/sortBy";
import { getSegmentName } from "viewer/model/accessors/volumetracing_accessor";
import type { Segment, SegmentGroup, SegmentMap } from "viewer/store";
import {
  createGroupToSegmentsMap,
  getGroupNodeKey,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";

/*
 * The segment hierarchy is modeled as a discriminated union that antd's <Tree />
 * can consume directly (via its generic treeData + titleRender). Each node carries
 * its domain object (Segment or SegmentGroup), so consumers never need to convert
 * between store data and widget data.
 */
export type SegmentUiNode = BasicDataNode & {
  type: "segment";
  key: string;
  segment: Segment;
  isLeaf: true;
  children?: undefined;
};

export type SegmentGroupUiNode = BasicDataNode & {
  type: "group";
  key: string;
  group: SegmentGroup;
  children: SegmentsUiNode[];
};

export type SegmentsUiNode = SegmentUiNode | SegmentGroupUiNode;

export function getSegmentUiNodeKey(segmentId: number): string {
  return `segment-${segmentId}`;
}

// Group nodes must be keyed with getGroupNodeKey, because the Redux store
// tracks the expansion state of segment groups by exactly these keys
// (see setExpandedSegmentGroupsAction).
export const getGroupUiNodeKey = getGroupNodeKey;

export function getUiNodeName(node: SegmentsUiNode): string {
  return node.type === "segment"
    ? getSegmentName(node.segment)
    : node.group.name || "<Unnamed Group>";
}

export function isRootGroupNode(node: SegmentsUiNode): boolean {
  return node.type === "group" && node.group.groupId === MISSING_GROUP_ID;
}

export type SegmentsHierarchy = {
  // The (virtual) root group node wrapping all top-level groups and segments.
  // This is what should be passed to the antd Tree as treeData.
  roots: [SegmentGroupUiNode];
  // All nodes (including the root group) in rendered (DFS) order.
  flatNodes: SegmentsUiNode[];
  // Keys of the visible segments. The checked state of groups is derived
  // from their children by antd itself.
  checkedKeys: string[];
  // Keys of expanded groups (derived from SegmentGroup.isExpanded).
  expandedKeys: string[];
  groupNodesById: Map<number, SegmentGroupUiNode>;
  nodesByKey: Map<string, SegmentsUiNode>;
};

export function buildSegmentHierarchy(
  segments: SegmentMap | null | undefined,
  segmentGroups: SegmentGroup[],
): SegmentsHierarchy {
  const groupToSegmentsMap = segments != null ? createGroupToSegmentsMap(segments) : {};
  const groupNodesById = new Map<number, SegmentGroupUiNode>();
  const nodesByKey = new Map<string, SegmentsUiNode>();
  const checkedKeys: string[] = [];
  const expandedKeys: string[] = [];

  const buildSegmentNode = (segment: Segment): SegmentUiNode => {
    const node: SegmentUiNode = {
      type: "segment",
      key: getSegmentUiNodeKey(segment.id),
      segment,
      isLeaf: true,
    };
    nodesByKey.set(node.key, node);
    if (segment.isVisible) {
      checkedKeys.push(node.key);
    }
    return node;
  };

  const buildGroupNode = (group: SegmentGroup): SegmentGroupUiNode => {
    // Subgroups are sorted by id and appear before the segments (which are
    // sorted by id, too).
    const childGroupNodes = sortBy(group.children, "groupId").map(buildGroupNode);
    const segmentNodes = sortBy(groupToSegmentsMap[group.groupId] ?? [], "id").map(
      buildSegmentNode,
    );

    const node: SegmentGroupUiNode = {
      type: "group",
      key: getGroupUiNodeKey(group.groupId),
      group,
      children: [...childGroupNodes, ...segmentNodes],
    };
    groupNodesById.set(group.groupId, node);
    nodesByKey.set(node.key, node);

    if (group.isExpanded ?? true) {
      expandedKeys.push(node.key);
    }
    return node;
  };

  const rootGroup: SegmentGroup = {
    name: "Root",
    groupId: MISSING_GROUP_ID,
    children: segmentGroups,
    isExpanded: true,
  };
  const rootNode = buildGroupNode(rootGroup);

  const flatNodes: SegmentsUiNode[] = [];
  const collectDepthFirst = (node: SegmentsUiNode) => {
    flatNodes.push(node);
    if (node.type === "group") {
      node.children.forEach(collectDepthFirst);
    }
  };
  collectDepthFirst(rootNode);

  return {
    roots: [rootNode],
    flatNodes,
    checkedKeys,
    expandedKeys,
    groupNodesById,
    nodesByKey,
  };
}
