// @flow

import Saxophone from "@scalableminds/saxophone";
import _ from "lodash";

import {
  getMaximumGroupId,
  getMaximumTreeId,
} from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import Date from "libs/date";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import { findGroup } from "oxalis/view/right-menu/tree_hierarchy_view_helpers";
import { type MutableTreeMap, type MutableTree, type TreeGroup } from "oxalis/store";
import messages from "messages";

// NML Defaults
const DEFAULT_COLOR = [1, 0, 0];
const DEFAULT_VIEWPORT = 0;
const DEFAULT_RESOLUTION = 0;
const DEFAULT_BITDEPTH = 0;
const DEFAULT_INTERPOLATION = false;
const DEFAULT_TIMESTAMP = 0;
const DEFAULT_ROTATION = [0, 0, 0];
const DEFAULT_GROUP_ID = null;
const DEFAULT_RADIUS = 30;

export class NmlParseError extends Error {
  name = "NmlParseError";
}

function _parseInt(obj: Object, key: string, defaultValue?: number): number {
  if (obj[key] == null || obj[key].length === 0) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }
  return Number.parseInt(obj[key], 10);
}

function _parseFloat(obj: Object, key: string, defaultValue?: number): number {
  if (obj[key] == null || obj[key].length === 0) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }
  return Number.parseFloat(obj[key]);
}

function _parseTimestamp(obj: Object, key: string, defaultValue?: number): number {
  const timestamp = _parseInt(obj, key, defaultValue);
  const isValid = new Date(timestamp).getTime() > 0;
  if (!isValid) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.invalid_timestamp"]} ${key}`);
    } else {
      return defaultValue;
    }
  }
  return timestamp;
}

function _parseBool(obj: Object, key: string, defaultValue?: boolean): boolean {
  if (obj[key] == null || obj[key].length === 0) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }
  return obj[key] === "true";
}

function _parseEntities(obj: Object, key: string, defaultValue?: string): string {
  if (obj[key] == null) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }
  return Saxophone.parseEntities(obj[key]);
}

function connectedComponentsOfTree(tree: MutableTree): Array<Array<number>> {
  // Breadth-First Search that finds the connected component of the node with id startNodeId
  // and marks all visited nodes as true in the visited map
  const bfs = (startNodeId: number, edges: EdgeCollection, visited: Map<number, boolean>) => {
    const queue = [startNodeId];
    const component = [];
    visited.set(startNodeId, true);
    while (queue.length > 0) {
      const nodeId = queue.shift();
      component.push(nodeId);
      const curEdges = edges.getEdgesForNode(nodeId);

      for (const edge of curEdges) {
        if (nodeId === edge.target && !visited.get(edge.source)) {
          queue.push(edge.source);
          visited.set(edge.source, true);
        } else if (!visited.get(edge.target)) {
          queue.push(edge.target);
          visited.set(edge.target, true);
        }
      }
    }
    return component;
  };

  const components = [];
  const visited = new Map();

  for (const node of tree.nodes.values()) {
    if (!visited.get(node.id)) {
      components.push(bfs(node.id, tree.edges, visited));
    }
  }

  return components;
}

function splitTreeIntoComponents(
  tree: MutableTree,
  treeGroups: Array<TreeGroup>,
  maxTreeId: number,
): Array<MutableTree> {
  const components = connectedComponentsOfTree(tree);

  if (components.length <= 1) return [tree];

  // If there is more than one component, split the tree into its components
  // and wrap the split trees in a new group
  const newGroupId = getMaximumGroupId(treeGroups) + 1;
  const newGroup = {
    name: tree.name,
    groupId: newGroupId,
    children: [],
  };

  const newTrees = [];
  for (let i = 0; i < components.length; i++) {
    const nodeIds = components[i];
    const nodeIdsSet = new Set(nodeIds);

    // Only consider outgoing edges as otherwise each edge would be collected twice
    const edges = nodeIds.flatMap(nodeId => tree.edges.getOutgoingEdgesForNode(nodeId));

    const newTree = {
      treeId: maxTreeId + 1 + i,
      color: tree.color,
      name: `${tree.name}_${i}`,
      comments: tree.comments.filter(comment => nodeIdsSet.has(comment.nodeId)),
      nodes: new DiffableMap(nodeIds.map(nodeId => [nodeId, tree.nodes.get(nodeId)])),
      branchPoints: tree.branchPoints.filter(bp => nodeIdsSet.has(bp.nodeId)),
      timestamp: tree.timestamp,
      edges: EdgeCollection.loadFromArray(edges),
      isVisible: tree.isVisible,
      groupId: newGroupId,
    };

    newTrees.push(newTree);
  }

  // If the tree is part of a group, insert the new group into the tree's group,
  // otherwise insert the new group into the root group
  if (tree.groupId != null) {
    const parentGroup = findGroup(treeGroups, tree.groupId);
    if (parentGroup == null)
      throw Error("Assertion Error: Tree's group is not part of the group tree.");
    parentGroup.children.push(newGroup);
  } else {
    treeGroups.push(newGroup);
  }

  return newTrees;
}

function getEdgeHash(source: number, target: number) {
  return source < target ? `${source}-${target}` : `${target}-${source}`;
}

export function wrapInNewGroup(
  originalTrees: MutableTreeMap,
  _originalTreeGroups: ?Array<TreeGroup>,
  wrappingGroupName: string,
): [MutableTreeMap, Array<TreeGroup>] {
  const originalTreeGroups = _originalTreeGroups || [];
  // It does not matter whether the group id is used in the active tracing, since
  // this case will be handled during import, anyway. The group id just shouldn't clash
  // with the nml itself.
  const unusedGroupId = getMaximumGroupId(originalTreeGroups) + 1;
  const trees = _.mapValues(originalTrees, tree => ({
    ...tree,
    // Give parentless trees the new treeGroup as parent
    groupId: tree.groupId || unusedGroupId,
  }));
  const treeGroups = [
    // Create a new tree group which holds the old ones
    {
      name: wrappingGroupName,
      groupId: unusedGroupId,
      children: originalTreeGroups,
    },
  ];

  return [trees, treeGroups];
}

export function parseNml(
  nmlString: string,
): Promise<{ trees: MutableTreeMap, treeGroups: Array<TreeGroup>, datasetName: ?string }> {
  return new Promise((resolve, reject) => {
    const parser = new Saxophone();

    const trees: MutableTreeMap = {};
    const treeGroups: Array<TreeGroup> = [];
    const existingNodeIds = new Set();
    const existingGroupIds = new Set();
    const existingEdges = new Set();
    let currentTree: ?MutableTree = null;
    let currentGroup: ?TreeGroup = null;
    const groupIdToParent: { [number]: ?TreeGroup } = {};
    const nodeIdToTreeId = {};
    let datasetName = null;
    parser
      .on("tagopen", node => {
        const attr = Saxophone.parseAttrs(node.attrs);
        switch (node.name) {
          case "experiment": {
            datasetName = attr.name;
            break;
          }
          case "thing": {
            const groupId = _parseInt(attr, "groupId", -1);
            currentTree = {
              treeId: _parseInt(attr, "id"),
              color: [
                _parseFloat(attr, "color.r", DEFAULT_COLOR[0]),
                _parseFloat(attr, "color.g", DEFAULT_COLOR[1]),
                _parseFloat(attr, "color.b", DEFAULT_COLOR[2]),
              ],
              // In Knossos NMLs, there is usually a tree comment instead of a name
              name: _parseEntities(attr, "name", "") || _parseEntities(attr, "comment", ""),
              comments: [],
              nodes: new DiffableMap(),
              branchPoints: [],
              timestamp: Date.now(),
              edges: new EdgeCollection(),
              isVisible: _parseFloat(attr, "color.a") !== 0,
              groupId: groupId >= 0 ? groupId : DEFAULT_GROUP_ID,
            };
            if (trees[currentTree.treeId] != null)
              throw new NmlParseError(`${messages["nml.duplicate_tree_id"]} ${currentTree.treeId}`);
            trees[currentTree.treeId] = currentTree;
            break;
          }
          case "node": {
            const nodeId = _parseInt(attr, "id");
            const currentNode = {
              id: nodeId,
              position: [_parseFloat(attr, "x"), _parseFloat(attr, "y"), _parseFloat(attr, "z")],
              rotation: [
                _parseFloat(attr, "rotX", DEFAULT_ROTATION[0]),
                _parseFloat(attr, "rotY", DEFAULT_ROTATION[1]),
                _parseFloat(attr, "rotZ", DEFAULT_ROTATION[2]),
              ],
              interpolation: _parseBool(attr, "interpolation", DEFAULT_INTERPOLATION),
              bitDepth: _parseInt(attr, "bitDepth", DEFAULT_BITDEPTH),
              viewport: _parseInt(attr, "inVp", DEFAULT_VIEWPORT),
              resolution: _parseInt(attr, "inMag", DEFAULT_RESOLUTION),
              radius: _parseFloat(attr, "radius", DEFAULT_RADIUS),
              timestamp: _parseTimestamp(attr, "time", DEFAULT_TIMESTAMP),
            };
            if (currentTree == null)
              throw new NmlParseError(`${messages["nml.node_outside_tree"]} ${currentNode.id}`);
            if (existingNodeIds.has(currentNode.id))
              throw new NmlParseError(`${messages["nml.duplicate_node_id"]} ${currentNode.id}`);
            nodeIdToTreeId[nodeId] = currentTree.treeId;
            currentTree.nodes.mutableSet(currentNode.id, currentNode);
            existingNodeIds.add(currentNode.id);
            break;
          }
          case "edge": {
            const currentEdge = {
              source: _parseInt(attr, "source"),
              target: _parseInt(attr, "target"),
            };
            const edgeHash = getEdgeHash(currentEdge.source, currentEdge.target);
            if (currentTree == null)
              throw new NmlParseError(
                `${messages["nml.edge_outside_tree"]} ${JSON.stringify(currentEdge)}`,
              );
            if (
              !(
                currentTree.nodes.has(currentEdge.source) &&
                currentTree.nodes.has(currentEdge.target)
              )
            )
              throw new NmlParseError(
                `${messages["nml.edge_with_invalid_node"]} ${JSON.stringify(currentEdge)}`,
              );
            if (currentEdge.source === currentEdge.target)
              throw new NmlParseError(
                `${messages["nml.edge_with_same_source_target"]} ${JSON.stringify(currentEdge)}`,
              );
            if (existingEdges.has(edgeHash))
              throw new NmlParseError(
                `${messages["nml.duplicate_edge"]} ${JSON.stringify(currentEdge)}`,
              );
            currentTree.edges.addEdge(currentEdge, true);
            existingEdges.add(edgeHash);
            break;
          }
          case "comment": {
            const currentComment = {
              nodeId: _parseInt(attr, "node"),
              content: _parseEntities(attr, "content"),
            };
            const tree = trees[nodeIdToTreeId[currentComment.nodeId]];
            if (tree == null)
              throw new NmlParseError(
                `${messages["nml.comment_without_tree"]} ${currentComment.nodeId}`,
              );
            tree.comments.push(currentComment);
            break;
          }
          case "branchpoint": {
            const currentBranchpoint = {
              nodeId: _parseInt(attr, "id"),
              timestamp: _parseInt(attr, "time", DEFAULT_TIMESTAMP),
            };
            const tree = trees[nodeIdToTreeId[currentBranchpoint.nodeId]];
            if (tree == null)
              throw new NmlParseError(
                `${messages["nml.branchpoint_without_tree"]} ${currentBranchpoint.nodeId}`,
              );
            tree.branchPoints.push(currentBranchpoint);
            break;
          }
          case "group": {
            const newGroup = {
              groupId: _parseInt(attr, "id"),
              name: _parseEntities(attr, "name"),
              children: [],
            };
            if (existingGroupIds.has(newGroup.groupId))
              throw new NmlParseError(`${messages["nml.duplicate_group_id"]} ${newGroup.groupId}`);
            if (currentGroup != null) {
              currentGroup.children.push(newGroup);
            } else {
              treeGroups.push(newGroup);
            }
            existingGroupIds.add(newGroup.groupId);
            if (!node.isSelfClosing) {
              // If the xml tag is self-closing, there won't be a separate tagclose event!
              groupIdToParent[newGroup.groupId] = currentGroup;
              currentGroup = newGroup;
            }
            break;
          }
          default:
            break;
        }
      })
      .on("tagclose", node => {
        switch (node.name) {
          case "thing": {
            if (currentTree != null) {
              if (currentTree.nodes.size() > 0) {
                const timestamp = _.min(currentTree.nodes.map(n => n.timestamp));
                trees[currentTree.treeId].timestamp = timestamp;
              }
            }
            currentTree = null;
            break;
          }
          case "group": {
            if (currentGroup != null) {
              currentGroup = groupIdToParent[currentGroup.groupId];
            }
            break;
          }
          case "groups": {
            _.forEach(trees, tree => {
              if (tree.groupId != null && !existingGroupIds.has(tree.groupId)) {
                throw new NmlParseError(
                  `${messages["nml.tree_with_missing_group_id"]} ${tree.groupId}`,
                );
              }
            });
            break;
          }
          default:
            break;
        }
      })
      .on("end", () => {
        // Split potentially unconnected trees
        const originalTreeIds = Object.keys(trees);
        for (const treeId of originalTreeIds) {
          const tree = trees[Number(treeId)];
          const maxTreeId = getMaximumTreeId(trees);
          const newTrees = splitTreeIntoComponents(tree, treeGroups, maxTreeId);
          if (_.size(newTrees) > 1) {
            delete trees[tree.treeId];
            for (const newTree of newTrees) {
              trees[newTree.treeId] = newTree;
            }
          }
        }
        resolve({ trees, treeGroups, datasetName });
      })
      .on("error", reject);

    parser.parse(nmlString);
  });
}
