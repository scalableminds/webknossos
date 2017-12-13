// @flow

import _ from "lodash";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import type {
  OxalisState,
  SkeletonTracingType,
  NodeMapType,
  EdgeType,
  TreeType,
} from "oxalis/store";

function indent(array: Array<string>): Array<string> {
  array.forEach((line, index) => {
    array[index] = `  ${line}`;
  });
  return array;
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
    .filter(treeId => tracing.trees[+treeId].isVisible)
    .map(treeId => tracing.trees[+treeId]);
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
  const editPosition = getPosition(state.flycam);
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
  return Object.keys(nodes).map(nodeId => {
    const node = nodes[+nodeId];
    return serializeTag("node", {
      id: node.id,
      radius: node.radius,
      x: node.position[0],
      y: node.position[1],
      z: node.position[2],
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

function serializeEdges(edges: Array<EdgeType>): Array<string> {
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

function serializeTag(
  name: string,
  properties: { [string]: ?(string | number | boolean) },
  closed: boolean = true,
): string {
  return `<${name} ${Object.keys(properties)
    .map(key => `${key}="${properties[key] != null ? properties[key].toString() : ""}"`)
    .join(" ")}${closed ? " /" : ""}>`;
}

export function parseNml() {}
