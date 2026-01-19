import saveAs from "file-saver";
import { api } from "viewer/singletons";
import type { SkeletonTracing, WebknossosState } from "viewer/store";
import { getAdditionalCoordinatesAsString } from "../accessors/flycam_accessor";
import { getNodePosition } from "../accessors/skeletontracing_accessor";

export function getTreesAsCSV(annotationId: string, tracing: SkeletonTracing, datasetUnit: string) {
  const visibleTrees = tracing.trees
    .values()
    .filter((tree) => tree.isVisible)
    .toArray();
  const csvHeader = `annotationId,treeId,name,groupId,colorRGB,numberOfNodes,numberOfEdges,pathLengthIn${datasetUnit},pathLengthVx`;

  const csvLines = visibleTrees.map((tree) => {
    const [lengthInDSUnit, lengthInVx] = api.tracing.measureTreeLength(tree.treeId);
    const row = [
      annotationId,
      tree.treeId,
      tree.name,
      tree.groupId != null ? tree.groupId : "",
      tree.color,
      tree.nodes.size(),
      tree.edges.size(),
      lengthInDSUnit,
      lengthInVx,
    ];
    return transformToCSVRow(row);
  });
  return [csvHeader, ...csvLines].join("\n");
}

export function getTreeNodesAsCSV(
  state: WebknossosState,
  tracing: SkeletonTracing,
  applyTransform: boolean,
  datasetUnit: string,
) {
  const visibleTrees = tracing.trees
    .values()
    .filter((tree) => tree.isVisible)
    .toArray();
  const csvHeader = `annotationId,treeId,nodeId,nodeRadius${datasetUnit},x,y,z,rotX,rotY,rotZ,additionalCoords,viewport,inMag,bitDepth,interpolation,time,comment`;
  const { annotationId } = state.annotation;

  const csvLines = visibleTrees.flatMap((tree) =>
    tree.nodes.map((node) => {
      const position = (
        applyTransform ? getNodePosition(node, state) : node.untransformedPosition
      ).map(Math.floor);
      const additionalCoordinates =
        node.additionalCoordinates != null && node.additionalCoordinates.length > 0
          ? getAdditionalCoordinatesAsString(node.additionalCoordinates, ";")
          : "null";
      const row = [
        annotationId,
        tree.treeId,
        node.id,
        node.radius,
        position[0],
        position[1],
        position[2],
        node.rotation[0],
        node.rotation[1],
        node.rotation[2],
        additionalCoordinates,
        node.viewport,
        node.mag,
        node.bitDepth,
        node.interpolation,
        node.timestamp,
        tree.comments.find((c) => c.nodeId === node.id)?.content ?? "",
      ];
      return transformToCSVRow(row);
    }),
  );
  return [csvHeader, ...csvLines].join("\n");
}

export function getTreeEdgesAsCSV(annotationId: string, tracing: SkeletonTracing) {
  const visibleTrees = tracing.trees
    .values()
    .filter((tree) => tree.isVisible)
    .toArray();
  const csvHeader = "annotationId,treeId,sourceNode,targetNode";
  const csvLines = visibleTrees.flatMap((tree) =>
    tree.edges.map((edge) => {
      const row = [annotationId, tree.treeId, edge.source, edge.target];
      return transformToCSVRow(row);
    }),
  );
  return [csvHeader, ...csvLines].join("\n");
}

export function transformToCSVRow(dataRow: any[]) {
  return dataRow
    .map(String) // convert every value to String
    .map((v) => v.replaceAll('"', '""')) // escape double quotes
    .map((v) => (/[,"\r\n=+-@]/.test(v) ? `"${v}"` : v)) // quote commas, quotes, and newlines
    .join(","); // comma-separated
}

export function saveAsCSV(csvHeader: string[], csvLines: string[], fileName: string) {
  const csv = [csvHeader.join(","), ...csvLines].join("\n");
  const blob = new Blob([csv], {
    type: "text/plain;charset=utf-8",
  });
  saveAs(blob, fileName);
}
