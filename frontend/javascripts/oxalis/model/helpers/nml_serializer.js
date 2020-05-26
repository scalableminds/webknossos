// @flow

import _ from "lodash";

import type { APIBuildInfo } from "admin/api_flow_types";
import type { BoundingBoxType } from "oxalis/constants";
import { convertFrontendBoundingBoxToServer } from "oxalis/model/reducers/reducer_helpers";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import Date from "libs/date";
import EdgeCollection from "oxalis/model/edge_collection";
import {
  type NodeMap,
  type OxalisState,
  type SkeletonTracing,
  type Tracing,
  type Tree,
  type TreeGroup,
} from "oxalis/store";

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
      content: "nml_serializer.js",
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
