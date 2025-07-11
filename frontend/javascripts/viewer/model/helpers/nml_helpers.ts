import Date from "libs/date";
import DiffableMap from "libs/diffable_map";
import * as Utils from "libs/utils";
import { coalesce } from "libs/utils";
import { location } from "libs/window";
import _ from "lodash";
import messages from "messages";
import Saxophone from "saxophone";
import type { APIBuildInfoWk, MetadataEntryProto } from "types/api_types";
import type { AdditionalCoordinate } from "types/api_types";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import { IdentityTransform, type TreeType, TreeTypeEnum, type Vector3 } from "viewer/constants";
import Constants from "viewer/constants";
import { getPosition, getRotation } from "viewer/model/accessors/flycam_accessor";
import EdgeCollection from "viewer/model/edge_collection";
import {
  getMaximumGroupId,
  getMaximumTreeId,
} from "viewer/model/reducers/skeletontracing_reducer_helpers";
import {
  type MutableNode,
  type MutableTree,
  MutableTreeMap,
  type NodeMap,
  type Tree,
  type TreeGroup,
} from "viewer/model/types/tree_types";
import type {
  BoundingBoxObject,
  SkeletonTracing,
  StoreAnnotation,
  UserBoundingBox,
  WebknossosState,
} from "viewer/store";
import { findGroup } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { getTransformsForSkeletonLayer } from "../accessors/dataset_layer_transformation_accessor";
import { getNodePosition } from "../accessors/skeletontracing_accessor";
import { min } from "./iterator_utils";

// NML Defaults
const DEFAULT_COLOR: Vector3 = [1, 0, 0];
const TASK_BOUNDING_BOX_COLOR: Vector3 = [0, 1, 0];
const DEFAULT_VIEWPORT = 0;
const DEFAULT_MAG = 0;
const DEFAULT_BITDEPTH = 0;
const DEFAULT_INTERPOLATION = false;
const DEFAULT_TIMESTAMP = 0;
const DEFAULT_ROTATION: Vector3 = [0, 0, 0];
const DEFAULT_GROUP_ID = null;
const DEFAULT_USER_BOUNDING_BOX_VISIBILITY = true;

// SERIALIZE NML
function indent(array: string[]): string[] {
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
  children: string[],
): string[] {
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

export function getNmlName(state: WebknossosState): string {
  // Use the same naming convention as the backend
  const { activeUser, dataset, task, annotation } = state;
  if (annotation.name !== "") return `${annotation.name}.nml`;
  const datasetName = dataset.name;
  const annotationTypeOrTaskId = task ? task.id : "explorational";
  let userName = activeUser
    ? `${activeUser.firstName.slice(0, 1)}${activeUser.lastName}`.toLowerCase()
    : "";
  // Replace spaces in user names
  userName = userName.replace(/ /g, "_");
  const shortAnnotationId = annotation.annotationId.slice(-6);
  return `${datasetName}__${annotationTypeOrTaskId}__${userName}__${shortAnnotationId}.nml`;
}
export function serializeToNml(
  state: WebknossosState,
  annotation: StoreAnnotation,
  tracing: SkeletonTracing,
  buildInfo: APIBuildInfoWk,
  applyTransform: boolean,
): string {
  // Only visible trees will be serialized!
  const visibleTrees = tracing.trees
    .values()
    .filter((tree) => tree.isVisible)
    .toArray();

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
  state: WebknossosState,
  annotation: StoreAnnotation,
  buildInfo: APIBuildInfoWk,
): string[] {
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
  boundingBox: BoundingBoxMinMaxType | null | undefined,
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
  state: WebknossosState,
  annotation: StoreAnnotation,
  skeletonTracing: SkeletonTracing,
  applyTransform: boolean,
): string[] {
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
          datasetId: state.dataset.id,
          name: state.dataset.directoryName,
          description: annotation.description,
          organization: state.dataset.owningOrganization,
          wkUrl: `${location.protocol}//${location.host}`,
        }),
        serializeTag("scale", {
          x: state.dataset.dataSource.scale.factor[0],
          y: state.dataset.dataSource.scale.factor[1],
          z: state.dataset.dataSource.scale.factor[2],
          unit: state.dataset.dataSource.scale.unit,
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

function serializeTransform(state: WebknossosState): string[] {
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

function serializeTrees(state: WebknossosState, trees: Tree[], applyTransform: boolean): string[] {
  return trees.flatMap((tree) => {
    const metadataString = serializeMetadata(tree.metadata);

    return serializeTagWithChildren(
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
        ...(metadataString.length > 0
          ? ["<metadata>", ...indent(metadataString), "</metadata>"]
          : []),
      ],
    );
  });
}

function serializeNodes(state: WebknossosState, nodes: NodeMap, applyTransform: boolean): string[] {
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
      inMag: node.mag,
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

function serializeEdges(edges: EdgeCollection): string[] {
  return edges.map((edge) =>
    serializeTag("edge", {
      source: edge.source,
      target: edge.target,
    }),
  );
}

function serializeMetadata(metadata: MetadataEntryProto[]): string[] {
  return metadata.map((prop) => {
    const values: any = {};
    if (prop.stringValue != null) {
      values.stringValue = prop.stringValue;
    } else if (prop.boolValue != null) {
      values.boolValue = prop.boolValue ? "true" : "false";
    } else if (prop.numberValue != null) {
      values.numberValue = `${prop.numberValue}`;
    } else if (prop.stringListValue != null) {
      for (let i = 0; i < prop.stringListValue.length; i++) {
        values[`stringListValue-${i}`] = prop.stringListValue[i];
      }
    }

    return serializeTag("metadataEntry", { key: prop.key, ...values });
  });
}

function serializeBranchPoints(trees: Tree[]): string[] {
  const branchPoints = trees.flatMap((tree) => tree.branchPoints);

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

function serializeComments(trees: Tree[]): string[] {
  const comments = trees.flatMap((tree) => tree.comments);

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

function serializeTreeGroups(treeGroups: TreeGroup[], trees: Tree[]): string[] {
  const deepFindTree = (group: TreeGroup): boolean =>
    trees.find((tree) => tree.groupId === group.groupId) != null ||
    group.children.some(deepFindTree);

  // Only serialize treeGroups that contain at least one tree at some level in their child hierarchy
  const nonEmptyTreeGroups = treeGroups.filter(deepFindTree);
  return nonEmptyTreeGroups.flatMap((treeGroup) =>
    serializeTagWithChildren(
      "group",
      {
        id: treeGroup.groupId,
        name: treeGroup.name,
        ...(treeGroup.isExpanded ? {} : { isExpanded: treeGroup.isExpanded }),
      },
      serializeTreeGroups(treeGroup.children, trees),
    ),
  );
}

// PARSE NML
export class NmlParseError extends Error {
  name = "NmlParseError";
}

function _parseInt<T>(
  obj: Record<string, string>,
  key: string,
  options?: {
    defaultValue: number | T;
  },
): number | T {
  if (obj[key] == null || obj[key].length === 0) {
    if (options == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return options.defaultValue;
    }
  }

  return Number.parseInt(obj[key], 10);
}

function _parseFloat<T>(
  obj: Record<string, string>,
  key: string,
  options?: {
    defaultValue: number | T;
  },
): number | T {
  if (obj[key] == null || obj[key].length === 0) {
    if (options == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return options.defaultValue;
    }
  }

  return Number.parseFloat(obj[key]);
}

function _parseStringArray(
  obj: Record<string, string>,
  prefix: string,
  options?: {
    defaultValue: string[] | undefined;
  },
): string[] | undefined {
  const indices = Object.keys(obj)
    .map((key) => key.split(`${prefix}-`))
    .filter((splitElements) => splitElements.length === 2)
    .map((splitElements) => Number.parseInt(splitElements[1], 10));
  if (indices.length === 0) {
    if (options) {
      return options.defaultValue;
    } else {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${prefix}`);
    }
  }
  indices.sort((a, b) => a - b);
  return indices.map((idx) => obj[`${prefix}-${idx}`]);
}

function _parseTimestamp(
  obj: Record<string, string>,
  key: string,
  options?: {
    defaultValue: number | undefined;
  },
): number {
  const timestamp = _parseInt(obj, key, options);

  const isValid = timestamp != null && new Date(timestamp).getTime() > 0;

  if (!isValid) {
    if (options?.defaultValue == null) {
      throw new NmlParseError(`${messages["nml.invalid_timestamp"]} ${key}`);
    } else {
      return options.defaultValue;
    }
  }

  return timestamp;
}

function _parseBool<T>(
  obj: Record<string, string>,
  key: string,
  options?: {
    defaultValue: boolean | T;
  },
): boolean | T {
  if (obj[key] == null || obj[key].length === 0) {
    if (options == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return options.defaultValue;
    }
  }

  return obj[key] === "true";
}

function _parseColor(obj: Record<string, string>, defaultColor: Vector3): Vector3 {
  const color = [
    _parseFloat(obj, "color.r", { defaultValue: defaultColor[0] }),
    _parseFloat(obj, "color.g", { defaultValue: defaultColor[1] }),
    _parseFloat(obj, "color.b", { defaultValue: defaultColor[2] }),
  ];
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
  return color;
}

function _parseTreeType(
  obj: Record<string, string>,
  key: string,
  options?: {
    defaultValue: TreeType;
  },
): TreeType {
  if (obj[key] == null || obj[key].length === 0) {
    if (options?.defaultValue == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return options.defaultValue;
    }
  }

  const treeType = coalesce(TreeTypeEnum, obj[key]);

  if (treeType != null) {
    return treeType;
  } else {
    throw new NmlParseError(`${messages["nml.invalid_tree_type"]} ${key}`);
  }
}

function _parseEntities<T>(
  obj: Record<string, string>,
  key: string,
  options?: {
    defaultValue: string | T;
  },
): string | T {
  if (obj[key] == null) {
    if (options == null) {
      throw new NmlParseError(`${messages["nml.expected_attribute_missing"]} ${key}`);
    } else {
      return options.defaultValue;
    }
  }

  return Saxophone.parseEntities(obj[key]);
}

function connectedComponentsOfTree(tree: MutableTree): Array<number[]> {
  // Breadth-First Search that finds the connected component of the node with id startNodeId
  // and marks all visited nodes as true in the visited map
  const bfs = (startNodeId: number, edges: EdgeCollection, visited: Map<number, boolean>) => {
    const queue = [startNodeId];
    const component = [];
    visited.set(startNodeId, true);

    while (queue.length > 0) {
      const nodeId = queue.shift() as number;
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
  treeGroups: TreeGroup[],
  maxTreeId: number,
): MutableTree[] {
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
    const newTree: MutableTree = {
      ...tree,
      treeId: maxTreeId + 1 + i,
      name: `${tree.name}_${i}`,
      comments: tree.comments.filter((comment) => nodeIdsSet.has(comment.nodeId)),
      nodes: new DiffableMap(nodeIds.map((nodeId) => [nodeId, tree.nodes.getOrThrow(nodeId)])),
      branchPoints: tree.branchPoints.filter((bp) => nodeIdsSet.has(bp.nodeId)),
      edges: EdgeCollection.loadFromArray(edges),
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
  _originalTreeGroups: TreeGroup[] | null | undefined,
  wrappingGroupName: string,
): [MutableTreeMap, TreeGroup[]] {
  const originalTreeGroups = _originalTreeGroups || [];
  // It does not matter whether the group id is used in the active tracing, since
  // this case will be handled during import, anyway. The group id just shouldn't clash
  // with the nml itself.
  const unusedGroupId = getMaximumGroupId(originalTreeGroups) + 1;
  const trees = originalTrees.clone();

  for (const tree of originalTrees.values()) {
    trees.mutableSet(tree.treeId, {
      ...tree,
      // Give parentless trees the new treeGroup as parent
      groupId: tree.groupId != null ? tree.groupId : unusedGroupId,
    });
  }

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
  userBoundingBoxes: UserBoundingBox[],
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

function parseMetadataEntry(attr: Record<any, any>): MetadataEntryProto {
  const stringValue = _parseEntities(attr, "stringValue", { defaultValue: undefined });
  const boolValue = _parseBool(attr, "boolValue", { defaultValue: undefined });
  const numberValue = _parseFloat(attr, "numberValue", { defaultValue: undefined });
  const stringListValue = _parseStringArray(attr, "stringListValue", { defaultValue: undefined });
  const prop: MetadataEntryProto = {
    key: _parseEntities(attr, "key"),
    stringValue,
    boolValue,
    numberValue,
    stringListValue,
  };
  const compactProp = Object.fromEntries(
    Object.entries(prop).filter(([_k, v]) => v !== undefined),
  ) as MetadataEntryProto;
  if (Object.entries(compactProp).length !== 2) {
    throw new NmlParseError(
      `Could not parse user-defined property. Expected exactly one key and one value. Got: ${Object.keys(
        compactProp,
      )}`,
    );
  }

  return compactProp;
}

export function parseNml(nmlString: string): Promise<{
  trees: MutableTreeMap;
  treeGroups: TreeGroup[];
  containedVolumes: boolean;
  userBoundingBoxes: UserBoundingBox[];
  datasetName: string | null | undefined;
}> {
  return new Promise((resolve, reject) => {
    const parser = new Saxophone();
    const trees: MutableTreeMap = new MutableTreeMap();
    const treeGroups: TreeGroup[] = [];
    const existingNodeIds = new Set();
    const existingTreeGroupIds = new Set();
    const existingEdges = new Set();
    let currentTree: MutableTree | null | undefined = null;
    let currentTreeGroup: TreeGroup | null | undefined = null;
    let currentNode: MutableNode | null | undefined = null;
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
            const groupId = _parseInt(attr, "groupId", { defaultValue: -1 });

            currentTree = {
              treeId: _parseInt(attr, "id"),
              color: _parseColor(attr, DEFAULT_COLOR),
              // In Knossos NMLs, there is usually a tree comment instead of a name
              name:
                _parseEntities(attr, "name", { defaultValue: "" }) ||
                _parseEntities(attr, "comment", { defaultValue: "" }),
              comments: [],
              nodes: new DiffableMap(),
              branchPoints: [],
              timestamp: Date.now(),
              edges: new EdgeCollection(),
              isVisible: _parseFloat(attr, "color.a") !== 0,
              groupId: groupId >= 0 ? groupId : DEFAULT_GROUP_ID,
              type: _parseTreeType(attr, "type", { defaultValue: TreeTypeEnum.DEFAULT }),
              edgesAreVisible: _parseBool(attr, "edgesAreVisible", { defaultValue: true }),
              metadata: [],
            };

            if (trees.getNullable(currentTree.treeId) != null)
              throw new NmlParseError(`${messages["nml.duplicate_tree_id"]} ${currentTree.treeId}`);
            trees.mutableSet(currentTree.treeId, currentTree);

            break;
          }

          case "node": {
            const nodeId = _parseInt<never>(attr, "id");

            currentNode = {
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
                  value: _parseFloat(attr, key, { defaultValue: 0 }),
                })) as AdditionalCoordinate[],
              rotation: [
                _parseFloat(attr, "rotX", { defaultValue: DEFAULT_ROTATION[0] }),
                _parseFloat(attr, "rotY", { defaultValue: DEFAULT_ROTATION[1] }),
                _parseFloat(attr, "rotZ", { defaultValue: DEFAULT_ROTATION[2] }),
              ] as Vector3,
              interpolation: _parseBool(attr, "interpolation", {
                defaultValue: DEFAULT_INTERPOLATION,
              }),
              bitDepth: _parseInt(attr, "bitDepth", { defaultValue: DEFAULT_BITDEPTH }),
              viewport: _parseInt(attr, "inVp", { defaultValue: DEFAULT_VIEWPORT }),
              mag: _parseInt(attr, "inMag", { defaultValue: DEFAULT_MAG }),
              radius: _parseFloat(attr, "radius", { defaultValue: Constants.DEFAULT_NODE_RADIUS }),
              timestamp: _parseTimestamp(attr, "time", { defaultValue: DEFAULT_TIMESTAMP }),
            };
            if (currentTree == null)
              throw new NmlParseError(`${messages["nml.node_outside_tree"]} ${currentNode.id}`);
            if (existingNodeIds.has(currentNode.id))
              throw new NmlParseError(`${messages["nml.duplicate_node_id"]} ${currentNode.id}`);
            nodeIdToTreeId[nodeId] = currentTree.treeId;
            currentTree.nodes.mutableSet(currentNode.id, currentNode);
            existingNodeIds.add(currentNode.id);

            if (node.isSelfClosing) {
              currentNode = null;
            }
            break;
          }

          case "metadataEntry": {
            if (currentTree == null) {
              throw new NmlParseError(messages["nml.metadata_entry_outside_tree"]);
            }
            if (currentNode == null) {
              currentTree.metadata.push(parseMetadataEntry(attr));
            } else {
              // TODO: Also support MetadataEntryProto in nodes. See #7483
            }
            break;
          }

          case "edge": {
            const currentEdge = {
              source: _parseInt<number>(attr, "source"),
              target: _parseInt<number>(attr, "target"),
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
              nodeId: _parseInt<never>(attr, "node"),
              content: _parseEntities<never>(attr, "content"),
            };
            const tree = trees.getNullable(nodeIdToTreeId[currentComment.nodeId]);
            if (tree == null)
              throw new NmlParseError(
                `${messages["nml.comment_without_tree"]} ${currentComment.nodeId}`,
              );
            tree.comments.push(currentComment);
            break;
          }

          case "branchpoint": {
            const currentBranchpoint = {
              nodeId: _parseInt<never>(attr, "id"),
              timestamp: _parseInt(attr, "time", { defaultValue: DEFAULT_TIMESTAMP }),
            };
            const tree = trees.getNullable(nodeIdToTreeId[currentBranchpoint.nodeId]);
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
              groupId: _parseInt<never>(attr, "id"),
              name: _parseEntities<never>(attr, "name"),
              isExpanded: _parseBool(attr, "isExpanded", { defaultValue: true }),
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
            const parsedUserBoundingBoxId = _parseInt(attr, "id", { defaultValue: 0 });

            const userBoundingBoxId = getUnusedUserBoundingBoxId(
              userBoundingBoxes,
              parsedUserBoundingBoxId,
            );
            const boundingBoxObject = parseBoundingBoxObject(attr);
            const userBoundingBox = {
              boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(boundingBoxObject),
              color: _parseColor(attr, DEFAULT_COLOR),
              id: userBoundingBoxId,
              isVisible: _parseBool(attr, "isVisible", {
                defaultValue: DEFAULT_USER_BOUNDING_BOX_VISIBILITY,
              }),
              name: _parseEntities(attr, "name", {
                defaultValue: `user bounding box ${userBoundingBoxId}`,
              }),
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
            break;
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
                const timestamp = min(currentTree.nodes.values().map((n) => n.timestamp)) ?? 0;

                trees.mutableSet(currentTree.treeId, { ...currentTree, timestamp });
              }
            }

            currentTree = null;
            break;
          }

          case "node": {
            currentNode = null;
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
              for (const tree of trees.values()) {
                if (tree.groupId != null && !existingTreeGroupIds.has(tree.groupId)) {
                  throw new NmlParseError(
                    `${messages["nml.tree_with_missing_group_id"]} ${tree.groupId}`,
                  );
                }
              }
            }

            break;
          }

          case "volume": {
            isParsingVolumeTag = false;
            break;
          }

          default:
            break;
        }
      })
      .on("finish", () => {
        // Split potentially unconnected trees
        let maxTreeId = getMaximumTreeId(trees);

        trees
          .values()
          // Materialize the trees before iterating over them
          // because we are also deleting from the collection.
          .toArray()
          .forEach((tree) => {
            const newTrees = splitTreeIntoComponents(tree, treeGroups, maxTreeId);

            const newTreesSize = _.size(newTrees);

            if (newTreesSize > 1) {
              trees.mutableDelete(tree.treeId);

              for (const newTree of newTrees) {
                trees.mutableSet(newTree.treeId, newTree);
              }

              maxTreeId += newTreesSize;
            }
          });

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
