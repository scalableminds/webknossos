import _ from "lodash";
import type { ServerSkeletonTracingTree } from "types/api_flow_types"; // This is a quick'n'dirty code to generate a huge amount of mocked trees.

// Since the server cannot handle such big tracings at the moment, we'll
// use this code to test the front-end performance.
// Prefer WkDev.createManyTrees for interactive tests.

export default function generateDummyTrees(
  treeCount: number,
  nodeCount: number,
): Array<ServerSkeletonTracingTree> {
  let currentNewNodeId = 1;
  let currentTreeId = 1;

  function generateDummyTree(): ServerSkeletonTracingTree {
    const nodes = [];
    const edges = [];
    let counter = 0;
    const initialNodeId = currentNewNodeId;

    while (counter++ < nodeCount) {
      nodes.push({
        id: currentNewNodeId++,
        position: {
          x: 5120 + (5000 * counter) / nodeCount,
          y: 3725 + ((currentTreeId - 1) * treeCount) / 10,
          z: 1545,
        },
        additionalCoordinates: [],
        rotation: {
          x: 0,
          y: 270,
          z: 0,
        },
        radius: 112.39999389648438,
        viewport: 1,
        mag: 2,
        bitDepth: 4,
        interpolation: true,
        createdTimestamp: 1507550793899,
      });
    }

    counter = 0;

    while (counter++ < nodeCount - 1) {
      edges.push({
        source: initialNodeId + counter,
        target: initialNodeId + counter - 1,
      });
    }

    return {
      treeId: currentTreeId++,
      nodes,
      edges,
      color: {
        r: 0,
        g: 0,
        b: 0,
        a: 1,
      },
      branchPoints: [],
      comments: [],
      name: "explorative_2017-10-09_SCM_Boy_023",
      createdTimestamp: 1507550576213,
      isVisible: true,
      metadata: [],
    };
  }

  return _.range(treeCount).map(() => generateDummyTree());
}
