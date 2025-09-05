import saveAs from "file-saver";
import type { SkeletonTracing } from "viewer/store";

export function exportTreesAsCSV(
  annotationId: string,
  tracing: SkeletonTracing,
  ///applyTransform: boolean,
) {
  const visibleTrees = tracing.trees
    .values()
    .filter((tree) => tree.isVisible)
    .toArray();
  const csvHeader = [
    "annotationId,treeId,nodeId,nodeRradius,x,y,z,rotX,rotY,rotZ,inVp,inMag,bitDepth,interpolation,time",
  ];
  const csvLines = visibleTrees.flatMap((tree) =>
    tree.nodes.map((node) => {
      const row = [
        annotationId,
        tree.treeId,
        node.id,
        node.radius,
        node.untransformedPosition[0],
        node.untransformedPosition[1],
        node.untransformedPosition[2],
        node.rotation[0],
        node.rotation[1],
        node.rotation[2],
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
