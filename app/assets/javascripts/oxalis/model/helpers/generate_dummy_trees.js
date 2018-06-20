// @flow
import _ from "lodash";
import type { ServerSkeletonTracingTreeType } from "admin/api_flow_types";

// This is a quick'n'dirty code to generate a huge amount of mocked trees.
// Since the server cannot handle such big tracings at the moment, we'll
// use this code to test the front-end performance.
// By default, this code is not used, but can be used similar to:
// tracing.trees = generateDummyTrees(1, 1000000);
// in model.js

export default function generateDummyTrees(
  treeCount: number,
  nodeCount: number,
): Array<ServerSkeletonTracingTreeType> {
  let currentNewNodeId = 1;
  let currentTreeId = 1;
  function generateDummyTree(): ServerSkeletonTracingTreeType {
    const nodes = [];
    const edges = [];
    let counter = -1;
    const initialNodeId = currentNewNodeId;
    while (counter++ < nodeCount) {
      nodes.push({
        id: currentNewNodeId++,
        position: {
          x: 5120 + 5000 * counter / nodeCount,
          y: 3725 + (currentTreeId - 1) * treeCount / 10,
          z: 1545,
        },
        rotation: { x: 0, y: 270, z: 0 },
        radius: 112.39999389648438,
        viewport: 1,
        resolution: 1,
        bitDepth: 4,
        interpolation: true,
        createdTimestamp: 1507550793899,
      });
    }

    counter = 0;
    while (counter++ < nodeCount) {
      edges.push({ source: initialNodeId + counter, target: initialNodeId + counter - 1 });
    }

    return {
      treeId: currentTreeId++,
      nodes,
      edges,
      color: { r: Math.random(), g: Math.random(), b: Math.random() },
      branchPoints: [],
      comments: [],
      name: "explorative_2017-10-09_SCM_Boy_023",
      createdTimestamp: 1507550576213,
    };
  }
  return _.range(treeCount).map(() => generateDummyTree());
}
