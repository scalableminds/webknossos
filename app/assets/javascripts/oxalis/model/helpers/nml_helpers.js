// @flow

import _ from "lodash";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import messages from "messages";
import Saxophone from "@scalableminds/saxophone";
import Store from "oxalis/store";
import Date from "libs/date";
import DiffableMap from "libs/diffable_map";
import type {
  OxalisState,
  SkeletonTracingType,
  NodeMapType,
  TreeType,
  TreeMapType,
  TemporaryMutableTreeMapType,
} from "oxalis/store";
import EdgeCollection from "oxalis/model/edge_collection";

// NML Defaults
const DEFAULT_COLOR = [1, 0, 0];
const DEFAULT_VIEWPORT = 0;
const DEFAULT_RESOLUTION = 0;
const DEFAULT_BITDEPTH = 0;
const DEFAULT_INTERPOLATION = false;
const DEFAULT_TIMESTAMP = 0;
const DEFAULT_ROTATION = [0, 0, 0];

// SERIALIZE NML

function indent(array: Array<string>): Array<string> {
  // Use forEach instead of map for performance reasons
  array.forEach((line, index) => {
    array[index] = `  ${line}`;
  });
  return array;
}

function serializeTag(
  name: string,
  properties: { [string]: ?(string | number | boolean) },
  closed: boolean = true,
): string {
  return `<${name} ${Object.keys(properties)
    .map(key => `${key}="${properties[key] != null ? properties[key].toString() : ""}"`)
    .join(" ")}${closed ? " /" : ""}>`;
}

export function getNmlName(state: OxalisState): string {
  // Use the same naming convention as the backend
  const { activeUser, dataset, task, tracing } = state;
  if (tracing.name !== "") return `${tracing.name}.nml`;

  const datasetName = dataset.name;
  const tracingType = task ? task.id : "explorational";
  let userName = activeUser
    ? `${activeUser.firstName.slice(0, 1)}${activeUser.lastName}`.toLowerCase()
    : "";
  // Replace spaces in user names
  userName = userName.replace(/ /g, "_");
  const shortAnnotationId = tracing.annotationId.slice(-6);

  return `${datasetName}__${tracingType}__${userName}__${shortAnnotationId}.nml`;
}

export function serializeToNml(state: OxalisState, tracing: SkeletonTracingType): string {
  // Only visible trees will be serialized!
  // _.filter throws flow errors here, because the type definitions are wrong and I'm not able to fix them
  const visibleTrees = Object.keys(tracing.trees)
    .filter(treeId => tracing.trees[Number(treeId)].isVisible)
    .map(treeId => tracing.trees[Number(treeId)]);
  return [
    "<things>",
    ...indent(
      _.concat(
        serializeParameters(state),
        serializeTrees(visibleTrees),
        serializeBranchPoints(visibleTrees),
        serializeComments(visibleTrees),
      ),
    ),
    "</things>",
  ].join("\n");
}

function serializeParameters(state: OxalisState): Array<string> {
  const editPosition = getPosition(state.flycam).map(Math.round);
  const editRotation = getRotation(state.flycam);
  const userBB = state.tracing.userBoundingBox;
  return [
    "<parameters>",
    ...indent([
      serializeTag("experiment", {
        name: state.dataset.name,
        description: state.tracing.description,
      }),
      serializeTag("scale", {
        x: state.dataset.scale[0],
        y: state.dataset.scale[1],
        z: state.dataset.scale[2],
      }),
      serializeTag("offset", {
        x: 0,
        y: 0,
        z: 0,
      }),
      serializeTag("time", { ms: state.tracing.createdTimestamp }),
      serializeTag("editPosition", {
        x: editPosition[0],
        y: editPosition[1],
        z: editPosition[2],
      }),
      serializeTag("editRotation", {
        xRot: editRotation[0],
        yRot: editRotation[1],
        zRot: editRotation[2],
      }),
      serializeTag("zoomLevel", { zoom: state.flycam.zoomStep }),
      userBB != null
        ? serializeTag("userBoundingBox", {
            topLeftX: userBB.min[0],
            topLeftY: userBB.min[1],
            topLeftZ: userBB.min[2],
            width: userBB.max[0] - userBB.min[0],
            height: userBB.max[1] - userBB.min[1],
            depth: userBB.max[2] - userBB.min[2],
          })
        : "",
    ]),
    "</parameters>",
  ];
}

function serializeTrees(trees: Array<TreeType>): Array<string> {
  return _.flatten(
    trees.map(tree => [
      serializeTag(
        "thing",
        {
          id: tree.treeId,
          "color.r": tree.color[0],
          "color.g": tree.color[1],
          "color.b": tree.color[2],
          "color.a": 1.0,
          name: tree.name,
        },
        false,
      ),
      ...indent([
        "<nodes>",
        ...indent(serializeNodes(tree.nodes)),
        "</nodes>",
        "<edges>",
        ...indent(serializeEdges(tree.edges)),
        "</edges>",
      ]),
      "</thing>",
    ]),
  );
}

function serializeNodes(nodes: NodeMapType): Array<string> {
  return nodes.map(node => {
    const position = node.position.map(Math.round);
    return serializeTag("node", {
      id: node.id,
      radius: node.radius,
      x: position[0],
      y: position[1],
      z: position[2],
      rotX: node.rotation[0],
      rotY: node.rotation[1],
      rotZ: node.rotation[2],
      inVp: node.viewport,
      inMag: node.resolution,
      bitDepth: node.bitDepth,
      interpolation: node.interpolation,
      time: node.timestamp,
    });
  });
}

function serializeEdges(edges: EdgeCollection): Array<string> {
  return edges.map(edge => serializeTag("edge", { source: edge.source, target: edge.target }));
}

function serializeBranchPoints(trees: Array<TreeType>): Array<string> {
  const branchPoints = _.flatten(trees.map(tree => tree.branchPoints));
  return [
    "<branchpoints>",
    ...indent(
      branchPoints.map(branchPoint =>
        serializeTag("branchpoint", { id: branchPoint.nodeId, time: branchPoint.timestamp }),
      ),
    ),
    "</branchpoints>",
  ];
}

function serializeComments(trees: Array<TreeType>): Array<string> {
  const comments = _.flatten(trees.map(tree => tree.comments));
  return [
    "<comments>",
    ...indent(
      comments.map(comment =>
        serializeTag("comment", { node: comment.nodeId, content: comment.content }),
      ),
    ),
    "</comments>",
  ];
}

// PARSE NML

class NmlParseError extends Error {
  constructor(...args) {
    super(...args);
    this.name = "NmlParseError";
  }
}

function _parseInt(obj: Object, key: string, defaultValue?: number): number {
  if (obj[key] == null) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }
  return Number.parseInt(obj[key], 10);
}

function _parseFloat(obj: Object, key: string, defaultValue?: number): number {
  if (obj[key] == null) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }
  return Number.parseFloat(obj[key]);
}

function _parseBool(obj: Object, key: string, defaultValue?: boolean): boolean {
  if (obj[key] == null) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }
  return obj[key] === "true";
}

function findTreeByNodeId(trees: TreeMapType, nodeId: number): ?TreeType {
  return _.values(trees).find(tree => tree.nodes.has(nodeId));
}

function isTreeConnected(tree: TreeType): boolean {
  const visitedNodes = new Map();

  if (tree.nodes.size() > 0) {
    // Get the first element from the nodes map
    const nodeQueue = [Number(tree.nodes.keys().next().value)];
    // Breadth-First search that marks all reachable nodes as visited
    while (nodeQueue.length !== 0) {
      const nodeId = nodeQueue.shift();
      visitedNodes.set(nodeId, true);
      const edges = tree.edges.getEdgesForNode(nodeId);
      // If there are no edges for a node, the tree is not connected
      if (edges == null) break;

      for (const edge of edges) {
        if (nodeId === edge.target && !visitedNodes.get(edge.source)) {
          nodeQueue.push(edge.source);
        } else if (!visitedNodes.get(edge.target)) {
          nodeQueue.push(edge.target);
        }
      }
    }
  }

  // If the size of the visitedNodes map is the same as the number of nodes, the tree is connected
  return _.size(visitedNodes) === tree.nodes.size();
}

export function parseNml(nmlString: string): Promise<TreeMapType> {
  return new Promise((resolve, reject) => {
    const parser = new Saxophone();

    const trees: TemporaryMutableTreeMapType = {};
    const existingNodeIds = new Set();
    let currentTree: ?TreeType = null;
    parser
      .on("tagopen", node => {
        const attr = Saxophone.parseAttrs(node.attrs);
        switch (node.name) {
          case "experiment": {
            if (attr.name !== Store.getState().dataset.name) {
              throw new NmlParseError(messages["nml.different_dataset"]);
            }
            break;
          }
          case "thing": {
            currentTree = {
              treeId: _parseInt(attr, "id"),
              color: [
                _parseFloat(attr, "color.r", DEFAULT_COLOR[0]),
                _parseFloat(attr, "color.g", DEFAULT_COLOR[1]),
                _parseFloat(attr, "color.b", DEFAULT_COLOR[2]),
              ],
              name: attr.name,
              comments: [],
              nodes: new DiffableMap(),
              branchPoints: [],
              timestamp: Date.now(),
              edges: new EdgeCollection(),
              isVisible: _parseFloat(attr, "color.a") !== 0,
            };
            if (trees[currentTree.treeId] != null)
              throw new NmlParseError(`${messages["nml.duplicate_tree_id"]} ${currentTree.treeId}`);
            trees[currentTree.treeId] = currentTree;
            break;
          }
          case "node": {
            const currentNode = {
              id: _parseInt(attr, "id"),
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
              radius: _parseFloat(attr, "radius"),
              timestamp: _parseInt(attr, "time", DEFAULT_TIMESTAMP),
            };
            if (currentTree == null)
              throw new NmlParseError(`${messages["nml.node_outside_tree"]} ${currentNode.id}`);
            if (existingNodeIds.has(currentNode.id))
              throw new NmlParseError(`${messages["nml.duplicate_node_id"]} ${currentNode.id}`);
            currentTree.nodes.mutableSet(currentNode.id, currentNode);
            existingNodeIds.add(currentNode.id);
            break;
          }
          case "edge": {
            const currentEdge = {
              source: _parseInt(attr, "source"),
              target: _parseInt(attr, "target"),
            };
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
            currentTree.edges.addEdge(currentEdge, true);
            break;
          }
          case "comment": {
            const currentComment = {
              nodeId: _parseInt(attr, "node"),
              content: attr.content,
            };
            const tree = findTreeByNodeId(trees, currentComment.nodeId);
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
            const tree = findTreeByNodeId(trees, currentBranchpoint.nodeId);
            if (tree == null)
              throw new NmlParseError(
                `${messages["nml.branchpoint_without_tree"]} ${currentBranchpoint.nodeId}`,
              );
            tree.branchPoints.push(currentBranchpoint);
            break;
          }
          default:
            break;
        }
      })
      .on("tagclose", node => {
        if (node.name === "thing" && currentTree != null) {
          if (!isTreeConnected(currentTree))
            throw new NmlParseError(`${messages["nml.tree_not_connected"]} ${currentTree.treeId}`);
          currentTree = null;
        }
      })
      .on("end", () => {
        resolve(trees);
      })
      .on("error", reject);

    parser.parse(nmlString);
  });
}
