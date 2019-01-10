// @flow

import Saxophone from "@scalableminds/saxophone";
import _ from "lodash";

import type { APIBuildInfo } from "admin/api_flow_types";
import type { BoundingBoxType } from "oxalis/constants";
import { convertFrontendBoundingBoxToServer } from "oxalis/model/reducers/reducer_helpers";
import { getMaximumGroupId } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import Date from "libs/date";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import Store, {
  type NodeMap,
  type OxalisState,
  type SkeletonTracing,
  type TemporaryMutableTreeMap,
  type Tracing,
  type Tree,
  type TreeGroup,
  type TreeMap,
} from "oxalis/store";
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

// SERIALIZE NML

function indent(array: Array<string>): Array<string> {
  // Use forEach instead of map for performance reasons
  array.forEach((line, index) => {
    array[index] = `  ${line}`;
  });
  return array;
}

function escape(string: string): string {
  return (
    string
      // the & character NEEDS to be escaped first, otherwise the escaped sequences will be escaped again
      .replace(/&/g, "&amp;")
      .replace(/>/g, "&gt;")
      .replace(/</g, "&lt;")
      .replace(/'/g, "&apos;")
      .replace(/"/g, "&quot;")
      .replace(/\n/g, "&#xa;")
  );
}

function serializeTagWithChildren(
  name: string,
  properties: { [string]: ?(string | number | boolean) },
  children: Array<string>,
): Array<string> {
  // If there are no children, the tag will be self-closing
  return _.compact([
    serializeTag(name, properties, children.length === 0),
    ...indent(children),
    children.length === 0 ? null : `</${name}>`,
  ]);
}

function serializeTag(
  name: string,
  properties: { [string]: ?(string | number | boolean) },
  closed: boolean = true,
): string {
  return `<${name} ${Object.keys(properties)
    .map(key => `${key}="${properties[key] != null ? escape(properties[key].toString()) : ""}"`)
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

export function serializeToNml(
  state: OxalisState,
  annotation: Tracing,
  tracing: SkeletonTracing,
  buildInfo: APIBuildInfo,
): string {
  // Only visible trees will be serialized!
  // _.filter throws flow errors here, because the type definitions are wrong and I'm not able to fix them
  const visibleTrees = Object.keys(tracing.trees)
    .filter(treeId => tracing.trees[Number(treeId)].isVisible)
    .map(treeId => tracing.trees[Number(treeId)]);
  return [
    "<things>",
    ...indent(
      _.concat(
        serializeMetaInformation(state, annotation, buildInfo),
        serializeParameters(state, annotation, tracing),
        serializeTrees(visibleTrees),
        serializeBranchPoints(visibleTrees),
        serializeComments(visibleTrees),
        "<groups>",
        indent(serializeTreeGroups(tracing.treeGroups, visibleTrees)),
        "</groups>",
      ),
    ),
    "</things>",
  ].join("\n");
}

function serializeMetaInformation(
  state: OxalisState,
  annotation: Tracing,
  buildInfo: APIBuildInfo,
): Array<string> {
  return _.compact([
    serializeTag("meta", {
      name: "writer",
      content: "nml_helpers.js",
    }),
    serializeTag("meta", {
      name: "writerGitCommit",
      content: buildInfo.webknossos.commitHash,
    }),
    serializeTag("meta", {
      name: "timestamp",
      content: Date.now().toString(),
    }),
    serializeTag("meta", {
      name: "annotationId",
      content: annotation.annotationId,
    }),
    state.activeUser != null
      ? serializeTag("meta", {
          name: "username",
          content: `${state.activeUser.firstName} ${state.activeUser.lastName}`,
        })
      : "",
    state.task != null
      ? serializeTag("meta", {
          name: "taskId",
          content: state.task.id,
        })
      : "",
  ]);
}

function serializeBoundingBox(bb: ?BoundingBoxType, name: string): string {
  const serverBoundingBox = convertFrontendBoundingBoxToServer(bb);
  if (serverBoundingBox != null) {
    const { topLeft, width, height, depth } = serverBoundingBox;
    const [topLeftX, topLeftY, topLeftZ] = topLeft;
    return serializeTag(name, { topLeftX, topLeftY, topLeftZ, width, height, depth });
  }
  return "";
}

function serializeParameters(
  state: OxalisState,
  annotation: Tracing,
  skeletonTracing: SkeletonTracing,
): Array<string> {
  const editPosition = getPosition(state.flycam).map(Math.round);
  const editRotation = getRotation(state.flycam);
  const userBB = skeletonTracing.userBoundingBox;
  const taskBB = skeletonTracing.boundingBox;
  return [
    "<parameters>",
    ...indent(
      _.compact([
        serializeTag("experiment", {
          name: state.dataset.name,
          description: annotation.description,
          organization: state.dataset.owningOrganization,
        }),
        serializeTag("scale", {
          x: state.dataset.dataSource.scale[0],
          y: state.dataset.dataSource.scale[1],
          z: state.dataset.dataSource.scale[2],
        }),
        serializeTag("offset", {
          x: 0,
          y: 0,
          z: 0,
        }),
        serializeTag("time", { ms: skeletonTracing.createdTimestamp }),
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
        serializeBoundingBox(userBB, "userBoundingBox"),
        serializeBoundingBox(taskBB, "taskBoundingBox"),
      ]),
    ),
    "</parameters>",
  ];
}

function serializeTrees(trees: Array<Tree>): Array<string> {
  return _.flatten(
    trees.map(tree =>
      serializeTagWithChildren(
        "thing",
        {
          id: tree.treeId,
          "color.r": tree.color[0],
          "color.g": tree.color[1],
          "color.b": tree.color[2],
          "color.a": 1.0,
          name: tree.name,
          groupId: tree.groupId,
        },
        [
          "<nodes>",
          ...indent(serializeNodes(tree.nodes)),
          "</nodes>",
          "<edges>",
          ...indent(serializeEdges(tree.edges)),
          "</edges>",
        ],
      ),
    ),
  );
}

function serializeNodes(nodes: NodeMap): Array<string> {
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

function serializeBranchPoints(trees: Array<Tree>): Array<string> {
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

function serializeComments(trees: Array<Tree>): Array<string> {
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

function serializeTreeGroups(treeGroups: Array<TreeGroup>, trees: Array<Tree>): Array<string> {
  const deepFindTree = group =>
    trees.find(tree => tree.groupId === group.groupId) || _.some(group.children, deepFindTree);
  // Only serialize treeGroups that contain at least one tree at some level in their child hierarchy
  const nonEmptyTreeGroups = treeGroups.filter(deepFindTree);
  return _.flatten(
    nonEmptyTreeGroups.map(treeGroup =>
      serializeTagWithChildren(
        "group",
        { id: treeGroup.groupId, name: treeGroup.name },
        serializeTreeGroups(treeGroup.children, trees),
      ),
    ),
  );
}

// PARSE NML

class NmlParseError extends Error {
  constructor(...args) {
    super(...args);
    this.name = "NmlParseError";
  }
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

function _parseEntities(obj: Object, key: string): string {
  if (obj[key] == null) {
    throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
  }
  return Saxophone.parseEntities(obj[key]);
}

function findTreeByNodeId(trees: TreeMap, nodeId: number): ?Tree {
  return _.values(trees).find(tree => tree.nodes.has(nodeId));
}

function isTreeConnected(tree: Tree): boolean {
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

function getEdgeHash(source: number, target: number) {
  return source < target ? `${source}-${target}` : `${target}-${source}`;
}

function wrapInNewGroup(
  originalTrees: TreeMap,
  originalTreeGroups: Array<TreeGroup>,
  wrappingGroupName: string,
): [TreeMap, Array<TreeGroup>] {
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
  wrappingGroupName?: ?string,
): Promise<{ trees: TreeMap, treeGroups: Array<TreeGroup> }> {
  return new Promise((resolve, reject) => {
    const parser = new Saxophone();

    const trees: TemporaryMutableTreeMap = {};
    const treeGroups: Array<TreeGroup> = [];
    const existingNodeIds = new Set();
    const existingGroupIds = new Set();
    const existingEdges = new Set();
    let currentTree: ?Tree = null;
    let currentGroup: ?TreeGroup = null;
    const groupIdToParent: { [number]: ?TreeGroup } = {};
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
            const groupId = _parseInt(attr, "groupId", -1);
            currentTree = {
              treeId: _parseInt(attr, "id"),
              color: [
                _parseFloat(attr, "color.r", DEFAULT_COLOR[0]),
                _parseFloat(attr, "color.g", DEFAULT_COLOR[1]),
                _parseFloat(attr, "color.b", DEFAULT_COLOR[2]),
              ],
              name: _parseEntities(attr, "name"),
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
            if (currentTree != null && !isTreeConnected(currentTree))
              throw new NmlParseError(
                `${messages["nml.tree_not_connected"]} ${currentTree.treeId}`,
              );
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
        if (wrappingGroupName != null) {
          const [wrappedTrees, wrappedTreeGroups] = wrapInNewGroup(
            trees,
            treeGroups,
            wrappingGroupName,
          );
          resolve({
            trees: wrappedTrees,
            treeGroups: wrappedTreeGroups,
          });
        } else {
          resolve({ trees, treeGroups });
        }
      })
      .on("error", reject);

    parser.parse(nmlString);
  });
}
