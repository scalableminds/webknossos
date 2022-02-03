import _ from "lodash";

import { type Saga, call, put, select, _takeLatest } from "oxalis/model/sagas/effect-generators";
import { V3 } from "libs/mjs";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { disableSavingAction } from "oxalis/model/actions/save_actions";
import { getActiveSegmentationTracingLayer } from "oxalis/model/accessors/volumetracing_accessor";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import Dimensions, { type DimensionMap } from "oxalis/model/dimensions";
import Model from "oxalis/model";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import constants, {
  type BoundingBoxType,
  type LabelMasksByBucketAndW,
  type Vector3,
  type Vector4,
} from "oxalis/constants";

// By default, a new bounding box is created around
// the seed nodes with a padding. Within the bounding box
// the min-cut is computed.
const DEFAULT_PADDING = [50, 50, 50];

//
// Helper functions for managing neighbors / edges.
//

// There are 6 neighbor in 3D space (manhattan-jumps).
// The neighbors can be accessed via neighbor indices (e.g., idx=1 ==> neighbor [0, -1, 0])
const NEIGHBOR_LOOKUP = [[0, 0, -1], [0, -1, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];
// neighborToIndex is a mapping from neighbor to neighbor index (e.g., neighbor [0, -1, 0] ==> idx=1)
const neighborToIndex = new Map(_.zip(_.values(NEIGHBOR_LOOKUP), _.range(NEIGHBOR_LOOKUP.length)));

function getNeighborIdx(neighbor) {
  const neighborIdx = neighborToIndex.get(neighbor);
  if (neighborIdx == null) {
    throw new Error("Could not look up neighbor");
  }
  return neighborIdx;
}

// Given a neighbor X (e.g., idx=1 == [0, -1, 0]), the opposite neighbor can be
// interesting (idx=4 == [0, 1, 0]). A common use case is dealing with doubly-linked
// edges in a graph. For example:
//
// Given:
//   A --> B
// From the perspective of A, B can be accessed by using the outgoing edge
// along vector [0, 1, 0] (idx=4). From the perspective of B, this is an
// ingoing edge (referenced by idx=1 == [0, -1, 0]).
const invertNeighborIdx = (neighborIdx: number) =>
  (neighborIdx + NEIGHBOR_LOOKUP.length / 2) % NEIGHBOR_LOOKUP.length;

function _getNeighborsFromBitMask(bitMask) {
  // Note: Use the memoized version of this: getNeighborsFromBitMask.
  // Ingoing and outgoing edges are stored as a bitmask. The first half
  // of the bitmask holds the ingoing edges as bits. The second half the
  // outgoing edges.
  //
  // For example, the bitmask
  //  010000 000000
  // means that there is exactly one ingoing edge ([0, -1, 0]).
  const neighbors = {
    ingoing: [],
    outgoing: [],
  };

  for (let neighborIdx = 0; neighborIdx < NEIGHBOR_LOOKUP.length; neighborIdx++) {
    if ((bitMask & (2 ** neighborIdx)) !== 0) {
      neighbors.outgoing.push(NEIGHBOR_LOOKUP[neighborIdx]);
    }
    if ((bitMask & (2 ** (neighborIdx + NEIGHBOR_LOOKUP.length))) !== 0) {
      neighbors.ingoing.push(NEIGHBOR_LOOKUP[neighborIdx]);
    }
  }

  return neighbors;
}
const getNeighborsFromBitMask = _.memoize(_getNeighborsFromBitMask);

// Functions to add/remove edges which mutate the bitmask.
function addOutgoingEdge(edgeBuffer, idx, neighborIdx) {
  edgeBuffer[idx] |= 2 ** neighborIdx;
}
function addIngoingEdge(edgeBuffer, idx, neighborIdx) {
  edgeBuffer[idx] |= 2 ** (NEIGHBOR_LOOKUP.length + neighborIdx);
}
function removeIngoingEdge(edgeBuffer, idx, neighborIdx) {
  edgeBuffer[idx] &= ~(2 ** (NEIGHBOR_LOOKUP.length + neighborIdx));
}
function removeOutgoingEdge(edgeBuffer, idx, neighborIdx) {
  edgeBuffer[idx] &= ~(2 ** neighborIdx);
}

//
// Algorithmic implementation of the min cut approach.
//
// The directed (!) voxel graph is defined so that each voxel is a node and
// two nodes are connected if they are neighbors and have the same segment id.
// Since the graph is directed, all edges are initially symmetric double-edges.
//
// The algorithm looks for shortest paths between two given seeds A and B (via
// breadth-first searches).
// In each iteration, a shortest path between A and B is removed until no paths
// exist anymore. Then, the two seeds are separated from each other.
//
// When removing a path, only the edges are removed which point from A to B.
// This leaves "back-edges" in the graph (also known as "residuals").
// In the final phase, these residuals are traversed to find out which nodes
// cannot be reached, anymore. These nodes are the one that should be erased
// to separate A from B.

function* performMinCut(action: PerformMinCutAction): Saga<void> {
  const allowSave = yield* select(store => store.tracing.restrictions.allowSave);
  if (allowSave && window.disableSavingOnMinCut) {
    console.log("disable saving");
    console.log("ensure saved state");
    yield* call([Model, Model.ensureSavedState]);
    console.log("disable saving");
    yield* put(disableSavingAction());
  }
  console.log("Start min cut");

  const skeleton = yield* select(store => store.tracing.skeleton);
  if (!skeleton) {
    return;
  }
  const seedTree = skeleton.trees[action.treeId];
  const activeTree = Utils.toNullable(getActiveTree(skeleton));

  if (!seedTree) {
    console.log("seedTree not found?");
    return;
  }

  const nodes = Array.from(seedTree.nodes.values());

  if (nodes.length !== 2) {
    console.log("seedTree should have exactly two nodes.");
    return;
  }

  const boundingBoxes = skeleton.userBoundingBoxes.filter(bbox => bbox.isVisible);
  let boundingBoxObj;
  if (boundingBoxes.length === 0) {
    console.log("No visible bounding box defined for min-cut. Creating one...");
    const newBBox = {
      min: [V3.floor(V3.sub(V3.min(nodes[0].position, nodes[1].position), DEFAULT_PADDING))],
      max: [V3.floor(V3.add(V3.max(nodes[0].position, nodes[1].position), DEFAULT_PADDING))],
    };

    yield* put(
      addUserBoundingBoxAction({
        boundingBox: newBBox,
        name: "Bounding box used for splitting cell",
        color: Utils.getRandomColor(),
        isVisible: true,
      }),
    );

    boundingBoxObj = newBBox;
  } else if (boundingBoxes.length === 1) {
    boundingBoxObj = boundingBoxes[0].boundingBox;
  } else {
    console.log(
      "Not clear which bounding box should be used. Ensure that only one or none are visible.",
    );
    return;
  }

  const boundingBoxMag1 = new BoundingBox(boundingBoxObj);

  if (
    !(
      boundingBoxMag1.containsPoint(nodes[0].position) &&
      boundingBoxMag1.containsPoint(nodes[0].position)
    )
  ) {
    console.log("The seeds are not contained in the current bbox.");
    return;
  }

  // todo: generalize
  const targetMag = [2, 2, 1];
  // const targetMag = [1, 1, 1];
  const boundingBoxTarget = boundingBoxMag1.from_mag1_to_mag(targetMag);

  const globalSeedA = V3.from_mag1_to_mag(nodes[0].position, targetMag);
  const globalSeedB = V3.from_mag1_to_mag(nodes[1].position, targetMag);

  let MIN_DIST_TO_SEED = 30 / targetMag[0];

  // if (V3.length(V3.sub(globalSeedA, globalSeedB)) < 2 * MIN_DIST_TO_SEED) {
  //   console.warn(`Nodes are closer than ${MIN_DIST_TO_SEED} vx apart.`);
  // }

  MIN_DIST_TO_SEED = Math.min(V3.length(V3.sub(globalSeedA, globalSeedB)) / 2, MIN_DIST_TO_SEED);
  console.log("automatically setting MIN_DIST_TO_SEED to ", MIN_DIST_TO_SEED);

  const seedA = V3.sub(globalSeedA, boundingBoxTarget.min);
  const seedB = V3.sub(globalSeedB, boundingBoxTarget.min);

  const volumeTracingLayer = yield* select(store => getActiveSegmentationTracingLayer(store));
  if (!volumeTracingLayer) {
    console.log("no volumeTracing");
    return;
  }
  console.log("boundingBoxTarget.getVolume()", boundingBoxTarget.getVolume());
  const inputData = yield* call(
    [api.data, api.data.getDataFor2DBoundingBox],
    volumeTracingLayer.name,
    boundingBoxMag1,
    1, // mag 2
  );

  const size = boundingBoxTarget.getSize();
  const l = (x, y, z) => z * size[1] * size[0] + y * size[0] + x;
  const ll = ([x, y, z]) => z * size[1] * size[0] + y * size[0] + x;
  const edgeBuffer = new Uint16Array(boundingBoxTarget.getVolume()); // .fill(2 ** 12 - 1);

  if (inputData[ll(seedA)] !== inputData[ll(seedB)]) {
    console.warn(
      "The given seeds are not placed on same segment",
      inputData[ll(seedA)],
      "vs",
      inputData[ll(seedB)],
    );
    return;
  }

  const segmentId = inputData[ll(seedA)];

  console.time("total min-cut");
  console.time("populate data");
  for (let x = 0; x < size[0]; x++) {
    for (let y = 0; y < size[1]; y++) {
      for (let z = 0; z < size[2]; z++) {
        // Traverse over all voxels

        const pos = [x, y, z];
        const linIndex = l(x, y, z);

        // Ignore voxel if it does not belong to seed segment
        if (inputData[linIndex] !== segmentId) {
          continue;
        }

        // Go over all neighbors
        for (let neighborIdx = 0; neighborIdx < NEIGHBOR_LOOKUP.length; neighborIdx++) {
          const neighbor = NEIGHBOR_LOOKUP[neighborIdx];
          const neighborPos = V3.add(pos, neighbor);

          if (
            neighborPos[0] < 0 ||
            neighborPos[1] < 0 ||
            neighborPos[2] < 0 ||
            neighborPos[0] >= size[0] ||
            neighborPos[1] >= size[1] ||
            neighborPos[2] >= size[2]
          ) {
            // neighbor is outside of volume
            continue;
          }

          const neighborLinIndex = ll(neighborPos);
          if (inputData[neighborLinIndex] === segmentId) {
            addOutgoingEdge(edgeBuffer, linIndex, neighborIdx);
            addIngoingEdge(edgeBuffer, neighborLinIndex, invertNeighborIdx(neighborIdx));
          }
        }
      }
    }
  }
  console.timeEnd("populate data");

  const originalEdgeBuffer = new Uint16Array(edgeBuffer); // .fill(2 ** 12 - 1);

  function populateDistanceField() {
    // Breadth-first search from seedA to seedB
    const distanceField = new Uint16Array(boundingBoxTarget.getVolume());
    const directionField = new Uint8Array(boundingBoxTarget.getVolume()).fill(255);
    const queue: Array<{ voxel: Array<number>, distance: number, usedEdgeIdx: number }> = [
      { voxel: seedA, distance: 1, usedEdgeIdx: 255 },
    ];
    let foundTarget = false;
    let lastDistance = 0;
    let skipCount = 0;
    let iterationCount = 0;

    while (queue.length > 0) {
      iterationCount++;
      const { voxel: currVoxel, distance, usedEdgeIdx } = queue.shift();

      const currVoxelIdx = ll(currVoxel);
      if (distanceField[currVoxelIdx] > 0) {
        skipCount++;
        continue;
      }

      if (distance > lastDistance) {
        console.log("new distance reached:", { distance, skipCount, iterationCount });
        lastDistance = distance;
      }

      distanceField[currVoxelIdx] = distance;
      directionField[currVoxelIdx] = usedEdgeIdx;

      if (currVoxel[0] === seedB[0] && currVoxel[1] === seedB[1] && currVoxel[2] === seedB[2]) {
        // console.log("found target seed");
        foundTarget = true;
        break;
      }

      const neighbors = getNeighborsFromBitMask(edgeBuffer[currVoxelIdx]).outgoing;

      for (const neighbor of neighbors) {
        const neighborPos = V3.add(currVoxel, neighbor);

        const neighborIdx = getNeighborIdx(neighbor);

        if (distanceField[ll(neighborPos)] == 0) {
          queue.push({ voxel: neighborPos, distance: distance + 1, usedEdgeIdx: neighborIdx });
        }
      }
    }

    return { distanceField, directionField, foundTarget };
  }

  function removeShortestPath(distanceField: Uint16Array, directionField: Uint8Array) {
    // Extract path from seedB to seedA
    // and remove edges which belong to that path
    const path = [];
    let i = 0;
    let foundSeed = false;
    const voxelStack = [seedB];
    const maxDistance = distanceField[ll(seedB)];
    let removedEdgeCount = 0;

    while (voxelStack.length > 0) {
      const currentVoxel = voxelStack.pop();
      if (i > 1000) {
        console.warn("loopBusted!");
        break;
      }
      i++;

      const currentDistance = distanceField[ll(currentVoxel)];

      if (
        currentVoxel[0] === seedA[0] &&
        currentVoxel[1] === seedA[1] &&
        currentVoxel[2] === seedA[2]
      ) {
        console.log("finished removing shortest path. deleted edges:", removedEdgeCount);
        foundSeed = true;
        break;
      }

      // Go over all neighbors
      // const neighbors = getNeighborsFromBitMask(edgeBuffer[ll(currentVoxel)]).ingoing;

      // console.log("ingoing edges", neighbors);

      const originallyUsedEdgeId = directionField[ll(currentVoxel)];
      if (originallyUsedEdgeId >= NEIGHBOR_LOOKUP.length) {
        throw new Error("Could not look up used edge in directionField");
      }
      const edgeId = invertNeighborIdx(originallyUsedEdgeId);
      const neighbor = NEIGHBOR_LOOKUP[edgeId];

      const neighborPos = V3.add(currentVoxel, neighbor);
      const neighborIdx = neighborToIndex.get(neighbor);

      if (neighborIdx == null) {
        throw new Error("Could not look up neighbor");
      }

      if (
        neighborPos[0] < 0 ||
        neighborPos[1] < 0 ||
        neighborPos[2] < 0 ||
        neighborPos[0] >= size[0] ||
        neighborPos[1] >= size[1] ||
        neighborPos[2] >= size[2]
      ) {
        throw new Error("neighbor is outside of volume ?");
      }

      if (
        !(distanceField[ll(neighborPos)] < currentDistance && distanceField[ll(neighborPos)] > 0)
      ) {
        throw new Error("direction points towards a higher distance?");
      }

      const currDist = distanceField[ll(neighborPos)];
      const distToSeed = Math.min(currDist, maxDistance - currDist);

      const ingoingNeighborsOld = getNeighborsFromBitMask(edgeBuffer[ll(currentVoxel)]).ingoing;

      if (distToSeed > MIN_DIST_TO_SEED) {
        removedEdgeCount++;
        path.unshift(neighborPos);

        // Remove ingoing
        // console.log("Before removing edge", edgeBuffer[ll(currentVoxel)].toString(2));

        removeIngoingEdge(edgeBuffer, ll(currentVoxel), neighborIdx);

        // console.log("After removing edge", edgeBuffer[ll(currentVoxel)].toString(2));

        const ingoingNeighbors = getNeighborsFromBitMask(edgeBuffer[ll(currentVoxel)]).ingoing;
        if (ingoingNeighborsOld.length - ingoingNeighbors.length !== 1) {
          console.log("didn't remove edge successfully");
          debugger;
        }

        // Remove outgoing
        const invertedNeighborIdx = invertNeighborIdx(neighborIdx);
        // console.log("Before removing edge", edgeBuffer[ll(neighborPos)].toString(2));

        removeOutgoingEdge(edgeBuffer, ll(neighborPos), invertedNeighborIdx);

        // console.log("After removing edge", edgeBuffer[ll(neighborPos)].toString(2));
      }

      voxelStack.push(neighborPos);
    }

    return { path, foundSeed, removedEdgeCount };
  }

  function traverseResidualsField() {
    // Breadth-first search from seedA to seedB
    const visitedField = new Uint16Array(boundingBoxTarget.getVolume());
    const queue: Array<{ voxel: Array<number> }> = [{ voxel: seedA }];
    while (queue.length > 0) {
      const { voxel: currVoxel } = queue.shift();

      const currVoxelIdx = ll(currVoxel);
      if (visitedField[currVoxelIdx] > 0) {
        continue;
      }
      visitedField[currVoxelIdx] = 1;
      const neighbors = getNeighborsFromBitMask(edgeBuffer[currVoxelIdx]).outgoing;

      for (const neighbor of neighbors) {
        const neighborPos = V3.add(currVoxel, neighbor);

        queue.push({ voxel: neighborPos });
      }
    }

    return { visitedField };
  }

  console.time("find & delete paths");
  for (let loopBuster = 0; loopBuster < 2000; loopBuster++) {
    // console.log("populate distance field", loopBuster);
    const { foundTarget, distanceField, directionField } = populateDistanceField();
    if (foundTarget) {
      const { removedEdgeCount } = removeShortestPath(distanceField, directionField);
      if (removedEdgeCount === 0) {
        console.log(
          "segmentation could not be partioned. zero edges removed in last iteration. probably due to nodes being too close to each other? aborting...",
        );
        return;
      }
      // console.log({ path });

      // for (const el of path) {
      //   api.data.labelVoxels([V3.add(boundingBox.min, el)], 0);
      // }
    } else {
      console.log("segmentation is partitioned");
      break;
    }

    if (loopBuster === 2000 - 1) {
      console.warn("loop busted");
    }
  }
  console.timeEnd("find & delete paths");

  console.time("traverseResidualsField");

  const { visitedField } = traverseResidualsField();
  console.timeEnd("traverseResidualsField");

  function labelDeletedEdges() {
    for (let x = 0; x < size[0]; x++) {
      for (let y = 0; y < size[1]; y++) {
        for (let z = 0; z < size[2]; z++) {
          const idx = l(x, y, z);
          if (visitedField[idx] === 1) {
            const neighbors = getNeighborsFromBitMask(originalEdgeBuffer[idx]).outgoing;
            const currentPos = [x, y, z];
            // api.data.labelVoxels([V3.add(boundingBox.min, currentPos)], 2);

            for (const neighbor of neighbors) {
              const neighborPos = V3.add(currentPos, neighbor);

              if (visitedField[ll(neighborPos)] === 0) {
                const position = V3.from_mag_to_mag1(
                  V3.add(boundingBoxTarget.min, neighborPos),
                  targetMag,
                );
                for (let dx = 0; dx < targetMag[0]; dx++) {
                  for (let dy = 0; dy < targetMag[1]; dy++) {
                    for (let dz = 0; dz < targetMag[2]; dz++) {
                      api.data.labelVoxels([V3.add(position, [dx, dy, dz])], 0);
                    }
                  }
                }

                if (window.visualizeRemovedVoxelsOnMinCut) {
                  window.addVoxelMesh(position, targetMag);
                }
              }
            }
          }
        }
      }
    }
  }
  console.time("labelDeletedEdges");
  labelDeletedEdges();
  console.timeEnd("labelDeletedEdges");
  console.timeEnd("total min-cut");
  console.log({ seedA, seedB, boundingBoxMag1, inputData, edgeBuffer });
}

export default function* listenToMinCut(): Saga<void> {
  // todo: this cancels old requests. only for debugging. use _takeEvery instead
  yield _takeLatest("PERFORM_MIN_CUT", performMinCut);
}

window.__isosurfaceVoxelDimensions = [1, 1, 1];
window.disableSavingOnMinCut = false;
window.visualizeRemovedVoxelsOnMinCut = true;
