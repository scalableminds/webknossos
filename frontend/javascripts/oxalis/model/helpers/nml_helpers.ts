// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'saxo... Remove this comment to see the full error message
import Saxophone from "saxophone";
import _ from "lodash";
import type { APIBuildInfo } from "types/api_flow_types";
import {
  getMaximumGroupId,
  getMaximumTreeId,
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
import { findGroup } from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import messages from "messages";
import * as Utils from "libs/utils";
import {
  BoundingBoxType,
  IdentityTransform,
  TreeType,
  TreeTypeEnum,
  Vector3,
} from "oxalis/constants";
import Constants from "oxalis/constants";
import { location } from "libs/window";
import { coalesce } from "libs/utils";
import { type AdditionalCoordinate } from "types/api_flow_types";
import { getNodePosition } from "../accessors/skeletontracing_accessor";
import { getTransformsForSkeletonLayer } from "../accessors/dataset_accessor";

// NML Defaults
const DEFAULT_COLOR: Vector3 = [1, 0, 0];
const TASK_BOUNDING_BOX_COLOR: Vector3 = [0, 1, 0];
const DEFAULT_VIEWPORT = 0;
const DEFAULT_RESOLUTION = 0;
const DEFAULT_BITDEPTH = 0;
const DEFAULT_INTERPOLATION = false;
const DEFAULT_TIMESTAMP = 0;
const DEFAULT_ROTATION: Vector3 = [0, 0, 0];
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
  return string // the & character NEEDS to be escaped first, otherwise the escaped sequences will be escaped again
    .replace(/&/g, "&amp;")
    .replace(/>/g, "&gt;")
    .replace(/</g, "&lt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#xa;");
}

function mapColorToComponents(color: Vector3) {
  return {
    "color.r": color[0],
    "color.g": color[1],
    "color.b": color[2],
    "color.a": 1.0,
  };
}

function serializeTagWithChildren(
  name: string,
  properties: Record<string, (string | number | boolean) | null | undefined>,
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
  properties: Record<string, (string | number | boolean) | null | undefined>,
  closed: boolean = true,
): string {
  const maybeSpace = Object.keys(properties).length > 0 ? " " : "";
  return `<${name}${maybeSpace}${Object.keys(properties)
    .map((key) => {
      let valueStr = "";
      const value = properties[key];
      if (value != null) {
        valueStr = escape(value.toString());
      }

      return `${key}="${valueStr}"`;
    })
    .join(" ")}${closed ? " /" : ""}>`;
}

function serializeXmlComment(comment: string) {
  return `<!-- ${comment} -->`;
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
  applyTransform: boolean,
): string {
  // Only visible trees will be serialized!
  const visibleTrees = Utils.values(tracing.trees).filter((tree) => tree.isVisible);
  return [
    "<things>",
    ...indent(
      _.concat(
        serializeMetaInformation(state, annotation, buildInfo),
        serializeParameters(state, annotation, tracing, applyTransform),
        serializeTrees(state, visibleTrees, applyTransform),
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

function serializeTaskBoundingBox(
  boundingBox: BoundingBoxType | null | undefined,
  tagName: string,
): string {
  if (boundingBox) {
    const boundingBoxArray = Utils.computeArrayFromBoundingBox(boundingBox);
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
  const boundingBoxArray = Utils.computeArrayFromBoundingBox(boundingBox);
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
  applyTransform: boolean,
): Array<string> {
  const editPosition = getPosition(state.flycam).map(Math.round);
  const editPositionAdditionalCoordinates = state.flycam.additionalCoordinates;
  const { additionalAxes } = skeletonTracing;

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
          wkUrl: `${location.protocol}//${location.host}`,
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
        serializeTag("time", {
          ms: skeletonTracing.createdTimestamp,
        }),
        serializeTag("editPosition", {
          x: editPosition[0],
          y: editPosition[1],
          z: editPosition[2],
          ...additionalCoordinatesToObject(editPositionAdditionalCoordinates || []),
        }),
        serializeTag("editRotation", {
          xRot: editRotation[0],
          yRot: editRotation[1],
          zRot: editRotation[2],
        }),
        serializeTag("zoomLevel", {
          zoom: state.flycam.zoomStep,
        }),
        ...userBBoxes.map((userBB) => serializeUserBoundingBox(userBB, "userBoundingBox")),
        serializeTaskBoundingBox(taskBB, "taskBoundingBox"),

        ...(additionalAxes.length > 0
          ? serializeTagWithChildren(
              "additionalAxes",
              {},
              additionalAxes.map((coord) =>
                serializeTag("additionalAxis", {
                  name: coord.name,
                  index: coord.index,
                  start: coord.bounds[0],
                  end: coord.bounds[1],
                }),
              ),
            )
          : []),

        ...(applyTransform ? serializeTransform(state) : []),
      ]),
    ),
    "</parameters>",
  ];
}

function serializeTransform(state: OxalisState): string[] {
  const transform = getTransformsForSkeletonLayer(
    state.dataset,
    state.datasetConfiguration.nativelyRenderedLayerName,
  );

  if (transform === IdentityTransform) {
    return [];
  }

  if (transform.type === "affine") {
    return [
      serializeXmlComment(
        "The node positions in this file were transformed using the following affine transform:",
      ),
      serializeTag("transform", {
        type: "affine",
        matrix: `[${transform.affineMatrix.join(",")}]`,
        positionsAreTransformed: true,
      }),
    ];
  } else {
    const correspondences = _.zip(
      transform.scaledTps.unscaledSourcePoints,
      transform.scaledTps.unscaledTargetPoints,
    ) as Array<[Vector3, Vector3]>;
    return [
      serializeXmlComment(
        "The node positions in this file were transformed using a thin plate spline that was derived from the following correspondences:",
      ),
      ...serializeTagWithChildren(
        "transform",
        {
          type: "thin_plate_spline",
          positionsAreTransformed: true,
        },
        correspondences.map((pair) =>
          serializeTag("correspondence", {
            source: `[${pair[0].join(",")}]`,
            target: `[${pair[1].join(",")}]`,
          }),
        ),
      ),
    ];
  }
}

function serializeTrees(
  state: OxalisState,
  trees: Array<Tree>,
  applyTransform: boolean,
): Array<string> {
  return _.flatten(
    trees.map((tree) =>
      serializeTagWithChildren(
        "thing",
        {
          id: tree.treeId,
          ...mapColorToComponents(tree.color),
          name: tree.name,
          groupId: tree.groupId,
          type: tree.type,
        },
        [
          "<nodes>",
          ...indent(serializeNodes(state, tree.nodes, applyTransform)),
          "</nodes>",
          "<edges>",
          ...indent(serializeEdges(tree.edges)),
          "</edges>",
        ],
      ),
    ),
  );
}

function serializeNodes(
  state: OxalisState,
  nodes: NodeMap,
  applyTransform: boolean,
): Array<string> {
  return nodes.map((node) => {
    const position = (
      applyTransform ? getNodePosition(node, state) : node.untransformedPosition
    ).map(Math.floor);
    const maybeProperties = additionalCoordinatesToObject(node.additionalCoordinates || []);

    return serializeTag("node", {
      id: node.id,
      radius: node.radius,
      x: Math.trunc(position[0]),
      y: Math.trunc(position[1]),
      z: Math.trunc(position[2]),
      ...maybeProperties,
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

function getAdditionalCoordinateLabel(useConciseStyle: boolean) {
  return useConciseStyle ? "pos" : "additionalCoordinate";
}

export function additionalCoordinateToKeyValue(
  coord: AdditionalCoordinate,
  useConciseStyle: boolean = false,
): [string, number] {
  const label = getAdditionalCoordinateLabel(useConciseStyle);
  return [
    // Export additional coordinates like this:
    // additionalCoordinate-t="10"
    // Don't capitalize coord.name, because it it's not reversible for
    // names that are already capitalized.
    `${label}-${coord.name}`,
    coord.value,
  ];
}

export function parseAdditionalCoordinateKey(
  key: string,
  expectConciseStyle: boolean = false,
): string {
  const label = getAdditionalCoordinateLabel(expectConciseStyle);
  return key.split(`${label}-`)[1];
}

function additionalCoordinatesToObject(additionalCoordinates: AdditionalCoordinate[]) {
  return Object.fromEntries(
    additionalCoordinates.map((coord) => additionalCoordinateToKeyValue(coord)),
  );
}

function serializeEdges(edges: EdgeCollection): Array<string> {
  return edges.map((edge) =>
    serializeTag("edge", {
      source: edge.source,
      target: edge.target,
    }),
  );
}

function serializeBranchPoints(trees: Array<Tree>): Array<string> {
  const branchPoints = _.flatten(trees.map((tree) => tree.branchPoints));

  return [
    "<branchpoints>",
    ...indent(
      branchPoints.map((branchPoint) =>
        serializeTag("branchpoint", {
          id: branchPoint.nodeId,
          time: branchPoint.timestamp,
        }),
      ),
    ),
    "</branchpoints>",
  ];
}

function serializeComments(trees: Array<Tree>): Array<string> {
  const comments = _.flatten(trees.map((tree) => tree.comments));

  return [
    "<comments>",
    ...indent(
      comments.map((comment) =>
        serializeTag("comment", {
          node: comment.nodeId,
          content: comment.content,
        }),
      ),
    ),
    "</comments>",
  ];
}

function serializeTreeGroups(treeGroups: Array<TreeGroup>, trees: Array<Tree>): Array<string> {
  const deepFindTree = (group: TreeGroup): boolean =>
    trees.find((tree) => tree.groupId === group.groupId) != null ||
    _.some(group.children, deepFindTree);

  // Only serialize treeGroups that contain at least one tree at some level in their child hierarchy
  const nonEmptyTreeGroups = treeGroups.filter(deepFindTree);
  return _.flatten(
    nonEmptyTreeGroups.map((treeGroup) =>
      serializeTagWithChildren(
        "group",
        {
          id: treeGroup.groupId,
          name: treeGroup.name,
        },
        serializeTreeGroups(treeGroup.children, trees),
      ),
    ),
  );
}

// PARSE NML
export class NmlParseError extends Error {
  name = "NmlParseError";
}

function _parseInt(obj: Record<string, string>, key: string, defaultValue?: number): number {
  if (obj[key] == null || obj[key].length === 0) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }

  return Number.parseInt(obj[key], 10);
}

function _parseFloat(obj: Record<string, string>, key: string, defaultValue?: number): number {
  if (obj[key] == null || obj[key].length === 0) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }

  return Number.parseFloat(obj[key]);
}

function _parseTimestamp(obj: Record<string, string>, key: string, defaultValue?: number): number {
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

function _parseBool(obj: Record<string, string>, key: string, defaultValue?: boolean): boolean {
  if (obj[key] == null || obj[key].length === 0) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }

  return obj[key] === "true";
}

function _parseColor(obj: Record<string, string>, defaultColor: Vector3): Vector3 {
  const color = [
    _parseFloat(obj, "color.r", defaultColor[0]),
    _parseFloat(obj, "color.g", defaultColor[1]),
    _parseFloat(obj, "color.b", defaultColor[2]),
  ];
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
  return color;
}

function _parseTreeType(
  obj: Record<string, string>,
  key: string,
  defaultValue?: TreeType,
): TreeType {
  if (obj[key] == null || obj[key].length === 0) {
    if (defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return defaultValue;
    }
  }

  const treeType = coalesce(TreeTypeEnum, obj[key]);

  if (treeType != null) {
    return treeType;
  } else {
    throw new NmlParseError(`${messages["nml.invalid_tree_type"]} ${key}`);
  }
}

function _parseEntities(obj: Record<string, string>, key: string, defaultValue?: string): string {
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
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number | undefined' is not assig... Remove this comment to see the full error message
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

  // @ts-expect-error ts-migrate(2322) FIXME: Type '(number | undefined)[][]' is not assignable ... Remove this comment to see the full error message
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
    const edges = nodeIds.flatMap((nodeId) => tree.edges.getOutgoingEdgesForNode(nodeId));
    const newTree = {
      treeId: maxTreeId + 1 + i,
      color: tree.color,
      name: `${tree.name}_${i}`,
      comments: tree.comments.filter((comment) => nodeIdsSet.has(comment.nodeId)),
      nodes: new DiffableMap(nodeIds.map((nodeId) => [nodeId, tree.nodes.getOrThrow(nodeId)])),
      branchPoints: tree.branchPoints.filter((bp) => nodeIdsSet.has(bp.nodeId)),
      timestamp: tree.timestamp,
      edges: EdgeCollection.loadFromArray(edges),
      isVisible: tree.isVisible,
      groupId: newGroupId,
      type: tree.type,
      edgesAreVisible: tree.edgesAreVisible,
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
  _originalTreeGroups: Array<TreeGroup> | null | undefined,
  wrappingGroupName: string,
): [MutableTreeMap, Array<TreeGroup>] {
  const originalTreeGroups = _originalTreeGroups || [];
  // It does not matter whether the group id is used in the active tracing, since
  // this case will be handled during import, anyway. The group id just shouldn't clash
  // with the nml itself.
  const unusedGroupId = getMaximumGroupId(originalTreeGroups) + 1;

  const trees = _.mapValues(originalTrees, (tree) => ({
    ...tree,
    // Give parentless trees the new treeGroup as parent
    groupId: tree.groupId != null ? tree.groupId : unusedGroupId,
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
  const isProposedIdUsed = userBoundingBoxes.some((userBB) => userBB.id === proposedId);

  if (!isProposedIdUsed) {
    return proposedId;
  }

  const maxId = Math.max(...userBoundingBoxes.map((userBB) => userBB.id));
  return maxId + 1;
}

function parseBoundingBoxObject(attr: Record<any, any>): BoundingBoxObject {
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
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ topLeft: number[]; width: number; height: ... Remove this comment to see the full error message
  return boundingBoxObject;
}

export function parseNml(nmlString: string): Promise<{
  trees: MutableTreeMap;
  treeGroups: Array<TreeGroup>;
  containedVolumes: boolean;
  userBoundingBoxes: Array<UserBoundingBox>;
  datasetName: string | null | undefined;
}> {
  return new Promise((resolve, reject) => {
    const parser = new Saxophone();
    const trees: MutableTreeMap = {};
    const treeGroups: Array<TreeGroup> = [];
    const existingNodeIds = new Set();
    const existingTreeGroupIds = new Set();
    const existingEdges = new Set();
    let currentTree: MutableTree | null | undefined = null;
    let currentTreeGroup: TreeGroup | null | undefined = null;
    let containedVolumes = false;
    let isParsingVolumeTag = false;

    const treeGroupIdToParent: Record<number, TreeGroup | null | undefined> = {};
    const nodeIdToTreeId: Record<number, number> = {};
    const userBoundingBoxes: UserBoundingBox[] = [];
    let datasetName: string | null = null;
    parser
      .on("tagopen", (node: Record<string, string>) => {
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
              type: _parseTreeType(attr, "type", TreeTypeEnum.DEFAULT),
              edgesAreVisible: _parseBool(attr, "edgesAreVisible", true),
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
              untransformedPosition: [
                Math.trunc(_parseFloat(attr, "x")),
                Math.trunc(_parseFloat(attr, "y")),
                Math.trunc(_parseFloat(attr, "z")),
              ] as Vector3,
              // Parse additional coordinates, like additionalCoordinate-t="10"
              additionalCoordinates: Object.keys(attr)
                .map((key) => [key, parseAdditionalCoordinateKey(key)])
                .filter(([_key, name]) => name != null)
                .map(([key, name]) => ({
                  name,
                  value: _parseFloat(attr, key, 0),
                })) as AdditionalCoordinate[],
              rotation: [
                _parseFloat(attr, "rotX", DEFAULT_ROTATION[0]),
                _parseFloat(attr, "rotY", DEFAULT_ROTATION[1]),
                _parseFloat(attr, "rotZ", DEFAULT_ROTATION[2]),
              ] as Vector3,
              interpolation: _parseBool(attr, "interpolation", DEFAULT_INTERPOLATION),
              bitDepth: _parseInt(attr, "bitDepth", DEFAULT_BITDEPTH),
              viewport: _parseInt(attr, "inVp", DEFAULT_VIEWPORT),
              resolution: _parseInt(attr, "inMag", DEFAULT_RESOLUTION),
              radius: _parseFloat(attr, "radius", Constants.DEFAULT_NODE_RADIUS),
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
            if (isParsingVolumeTag) {
              return;
            }
            const newGroup = {
              groupId: _parseInt(attr, "id"),
              name: _parseEntities(attr, "name"),
              children: [],
            };
            if (existingTreeGroupIds.has(newGroup.groupId)) {
              throw new NmlParseError(`${messages["nml.duplicate_group_id"]} ${newGroup.groupId}`);
            }

            if (currentTreeGroup != null) {
              currentTreeGroup.children.push(newGroup);
            } else {
              treeGroups.push(newGroup);
            }

            existingTreeGroupIds.add(newGroup.groupId);

            if (!node.isSelfClosing) {
              // If the xml tag is self-closing, there won't be a separate tagclose event!
              treeGroupIdToParent[newGroup.groupId] = currentTreeGroup;
              currentTreeGroup = newGroup;
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
              boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(boundingBoxObject),
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
              boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(boundingBoxObject),
              color: TASK_BOUNDING_BOX_COLOR,
              id: userBoundingBoxId,
              isVisible: DEFAULT_USER_BOUNDING_BOX_VISIBILITY,
              name: "task bounding box",
            };
            userBoundingBoxes.push(userBoundingBox);
            break;
          }

          case "volume": {
            isParsingVolumeTag = true;
            containedVolumes = true;
          }

          default:
            break;
        }
      })
      .on("tagclose", (node: Record<string, string>) => {
        switch (node.name) {
          case "thing": {
            if (currentTree != null) {
              if (currentTree.nodes.size() > 0) {
                const timestamp = _.min(currentTree.nodes.map((n) => n.timestamp));

                // @ts-expect-error ts-migrate(2322) FIXME: Type 'number | undefined' is not assignable to typ... Remove this comment to see the full error message
                trees[currentTree.treeId].timestamp = timestamp;
              }
            }

            currentTree = null;
            break;
          }

          case "group": {
            if (!isParsingVolumeTag) {
              if (currentTreeGroup != null) {
                currentTreeGroup = treeGroupIdToParent[currentTreeGroup.groupId];
              }
            }

            break;
          }

          case "groups": {
            if (!isParsingVolumeTag) {
              _.forEach(trees, (tree) => {
                if (tree.groupId != null && !existingTreeGroupIds.has(tree.groupId)) {
                  throw new NmlParseError(
                    `${messages["nml.tree_with_missing_group_id"]} ${tree.groupId}`,
                  );
                }
              });
            }

            break;
          }

          case "volume": {
            isParsingVolumeTag = false;
          }

          default:
            break;
        }
      })
      .on("finish", () => {
        // Split potentially unconnected trees
        const originalTrees = Utils.values(trees);
        let maxTreeId = getMaximumTreeId(trees);

        for (const tree of originalTrees) {
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

        resolve({
          trees,
          treeGroups,
          datasetName,
          userBoundingBoxes,
          containedVolumes,
        });
      })
      .on("error", reject);
    parser.parse(nmlString);
  });
}
