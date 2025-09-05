import saveAs from "file-saver";
import type { SkeletonTracing, WebknossosState } from "viewer/store";
import { getAdditionalCoordinatesAsString } from "../accessors/flycam_accessor";
import { getNodePosition } from "../accessors/skeletontracing_accessor";

export function exportTreesAsCSV(
  state: WebknossosState,
  tracing: SkeletonTracing,
  applyTransform: boolean,
) {
  const visibleTrees = tracing.trees
    .values()
    .filter((tree) => tree.isVisible)
    .toArray();
  const csvHeader = [
    "annotationId,treeId,nodeId,nodeRradius,x,y,z,rotX,rotY,rotZ,additionalCoords,inVp,inMag,bitDepth,interpolation,time",
  ];
  const { annotationId } = state.annotation;

  const csvLines = visibleTrees.flatMap((tree) =>
    tree.nodes.map((node) => {
      const position = (
        applyTransform && state != null ? getNodePosition(node, state) : node.untransformedPosition
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
      ];
      return transformToCSVRow(row);
    }),
  );
  return [csvHeader.join(","), ...csvLines].join("\n");
}

export function exportEdgesAsCSV(annotationId: string, tracing: SkeletonTracing) {
  const visibleTrees = tracing.trees
    .values()
    .filter((tree) => tree.isVisible)
    .toArray();
  const csvHeader = ["annotationId,treeId,sourceNode,targetNode"];
  const csvLines = visibleTrees.flatMap((tree) =>
    tree.edges.map((edge) => {
      const row = [annotationId, tree.treeId, edge.source, edge.target];
      return transformToCSVRow(row);
    }),
  );
  return [csvHeader.join(","), ...csvLines].join("\n");
}

export function transformToCSVRow(dataRow: any[]) {
  return dataRow
    .map(String) // convert every value to String
    .map((v) => v.replaceAll('"', '""')) // escape double quotes
    .map((v) => (v.includes(",") || v.includes('"') ? `"${v}"` : v)) // quote it if necessary
    .join(","); // comma-separated
}

export function saveAsCSV(csvHeader: string[], csvLines: string[], fileName: string) {
  const csv = [csvHeader.join(","), ...csvLines].join("\n");
  const blob = new Blob([csv], {
    type: "text/plain;charset=utf-8",
  });
  saveAs(blob, fileName);
}
