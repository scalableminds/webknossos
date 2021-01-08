// @flow

import Saxophone from "saxophone";
import _ from "lodash";

import type { APIBuildInfo } from "types/api_flow_types";
import {
  getMaximumGroupId,
  getMaximumTreeId,
  DEFAULT_NODE_RADIUS,
} from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import Date from "libs/date";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import type {
  UserBoundingBox,
  NodeMap,
  OxalisState,
  SkeletonTracing,
  MutableTreeMap,
  Tracing,
  Tree,
  MutableTree,
  TreeGroup,
  BoundingBoxObject,
} from "oxalis/store";
import { findGroup } from "oxalis/view/right-menu/tree_hierarchy_view_helpers";
import messages from "messages";
import { computeArrayFromBoundingBox, computeBoundingBoxFromBoundingBoxObject } from "libs/utils";
import type { BoundingBoxType, Vector3 } from "oxalis/constants";

// NML Defaults
const DEFAULT_COLOR = [1, 0, 0];
const TASK_BOUNDING_BOX_COLOR = [0, 1, 0];
const DEFAULT_VIEWPORT = 0;
const DEFAULT_RESOLUTION = 0;
const DEFAULT_BITDEPTH = 0;
const DEFAULT_INTERPOLATION = false;
const DEFAULT_TIMESTAMP = 0;
const DEFAULT_ROTATION = [0, 0, 0];
const DEFAULT_GROUP_ID = null;
const DEFAULT_USER_BOUNDING_BOX_VISIBILITY = true;

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

function mapColorToComponents(color: Vector3) {
  return { "color.r": color[0], "color.g": color[1], "color.b": color[2], "color.a": 1.0 };
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
  const annotationTypeOrTaskId = task ? task.id : "explorational";
  let userName = activeUser
    ? `${activeUser.firstName.slice(0, 1)}${activeUser.lastName}`.toLowerCase()
    : "";
  // Replace spaces in user names
  userName = userName.replace(/ /g, "_");
  const shortAnnotationId = tracing.annotationId.slice(-6);

  return `${datasetName}__${annotationTypeOrTaskId}__${userName}__${shortAnnotationId}.nml`;
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

function serializeTaskBoundingBox(boundingBox: ?BoundingBoxType, tagName: string): string {
  if (boundingBox) {
    const boundingBoxArray = computeArrayFromBoundingBox(boundingBox);
    const [topLeftX, topLeftY, topLeftZ, width, height, depth] = boundingBoxArray;
    return serializeTag(tagName, {
      topLeftX,
      topLeftY,
      topLeftZ,
      width,
      height,
      depth,
    });
  }
  return "";
}

function serializeUserBoundingBox(bb: UserBoundingBox, tagName: string): string {
  const { boundingBox, id, name, isVisible } = bb;
  const boundingBoxArray = computeArrayFromBoundingBox(boundingBox);
  const [topLeftX, topLeftY, topLeftZ, width, height, depth] = boundingBoxArray;
  const color = bb.color ? mapColorToComponents(bb.color) : {};
  return serializeTag(tagName, {
    topLeftX,
    topLeftY,
    topLeftZ,
    width,
    height,
    depth,
    ...color,
    id,
    name,
    isVisible,
  });
}

function serializeParameters(
  state: OxalisState,
  annotation: Tracing,
  skeletonTracing: SkeletonTracing,
): Array<string> {
  const editPosition = getPosition(state.flycam).map(Math.round);
  const editRotation = getRotation(state.flycam);
  const userBBoxes = skeletonTracing.userBoundingBoxes;
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
        ...userBBoxes.map(userBB => serializeUserBoundingBox(userBB, "userBoundingBox")),
        serializeTaskBoundingBox(taskBB, "taskBoundingBox"),
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
          ...mapColorToComponents(tree.color),
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
    const position = node.position.map(Math.floor);
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

function _parseColor(obj: Object, defaultColor: Vector3): Vector3 {
  const color = [
    _parseFloat(obj, "color.r", defaultColor[0]),
    _parseFloat(obj, "color.g", defaultColor[1]),
    _parseFloat(obj, "color.b", defaultColor[2]),
  ];
  return color;
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

function getUnusedUserBoundingBoxId(
  userBoundingBoxes: Array<UserBoundingBox>,
  proposedId: number = 0,
): number {
  const isProposedIdUsed = userBoundingBoxes.some(userBB => userBB.id === proposedId);
  if (!isProposedIdUsed) {
    return proposedId;
  }
  const maxId = Math.max(...userBoundingBoxes.map(userBB => userBB.id));
  return maxId + 1;
}

function parseBoundingBoxObject(attr): BoundingBoxObject {
  const boundingBoxObject = {
    topLeft: [
      _parseInt(attr, "topLeftX"),
      _parseInt(attr, "topLeftY"),
      _parseInt(attr, "topLeftZ"),
    ],
    width: _parseInt(attr, "width"),
    height: _parseInt(attr, "height"),
    depth: _parseInt(attr, "depth"),
  };
  return boundingBoxObject;
}

export function parseNml(
  nmlString: string,
): Promise<{
  trees: MutableTreeMap,
  treeGroups: Array<TreeGroup>,
  userBoundingBoxes: Array<UserBoundingBox>,
  datasetName: ?string,
}> {
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
    const userBoundingBoxes = [];
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
              color: _parseColor(attr, DEFAULT_COLOR),
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
              radius: _parseFloat(attr, "radius", DEFAULT_NODE_RADIUS),
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
          case "userBoundingBox": {
            const parsedUserBoundingBoxId = _parseInt(attr, "id", 0);
            const userBoundingBoxId = getUnusedUserBoundingBoxId(
              userBoundingBoxes,
              parsedUserBoundingBoxId,
            );
            const boundingBoxObject = parseBoundingBoxObject(attr);
            const userBoundingBox = {
              boundingBox: computeBoundingBoxFromBoundingBoxObject(boundingBoxObject),
              color: _parseColor(attr, DEFAULT_COLOR),
              id: userBoundingBoxId,
              isVisible: _parseBool(attr, "isVisible", DEFAULT_USER_BOUNDING_BOX_VISIBILITY),
              name: _parseEntities(attr, "name", `user bounding box ${userBoundingBoxId}`),
            };
            userBoundingBoxes.push(userBoundingBox);
            break;
          }
          case "taskBoundingBox": {
            const userBoundingBoxId = getUnusedUserBoundingBoxId(userBoundingBoxes);
            const boundingBoxObject = parseBoundingBoxObject(attr);
            const userBoundingBox = {
              boundingBox: computeBoundingBoxFromBoundingBoxObject(boundingBoxObject),
              color: TASK_BOUNDING_BOX_COLOR,
              id: userBoundingBoxId,
              isVisible: DEFAULT_USER_BOUNDING_BOX_VISIBILITY,
              name: "task bounding box",
            };
            userBoundingBoxes.push(userBoundingBox);
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
      .on("finish", () => {
        // Split potentially unconnected trees
        const originalTreeIds = Object.keys(trees);
        let maxTreeId = getMaximumTreeId(trees);
        for (const treeId of originalTreeIds) {
          const tree = trees[Number(treeId)];
          const newTrees = splitTreeIntoComponents(tree, treeGroups, maxTreeId);
          const newTreesSize = _.size(newTrees);
          if (newTreesSize > 1) {
            delete trees[tree.treeId];
            for (const newTree of newTrees) {
              trees[newTree.treeId] = newTree;
            }
            maxTreeId += newTreesSize;
          }
        }
        resolve({ trees, treeGroups, datasetName, userBoundingBoxes });
      })
      .on("error", reject);

    parser.parse(nmlString);
  });
}
