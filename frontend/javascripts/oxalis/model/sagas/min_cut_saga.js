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

const NEIGHBOR_LOOKUP = [[0, 0, -1], [0, -1, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];

const neighborToIndex: Map<Array<number>, number> = new Map();

function buildNeighborToIndexMap() {
  let idx: number = 0;
  for (const neighbor of NEIGHBOR_LOOKUP) {
    neighborToIndex.set(neighbor, idx);

    idx++;
  }
}

buildNeighborToIndexMap();

const invertNeighborId = (neighborId: number) =>
  (neighborId + NEIGHBOR_LOOKUP.length / 2) % NEIGHBOR_LOOKUP.length;

function _getNeighborsFromBitMask(bitMask) {
  const neighbors = {
    ingoing: [],
    outgoing: [],
  };

  for (let neighborId = 0; neighborId < NEIGHBOR_LOOKUP.length; neighborId++) {
    if ((bitMask & (2 ** neighborId)) !== 0) {
      neighbors.outgoing.push(NEIGHBOR_LOOKUP[neighborId]);
    }
    if ((bitMask & (2 ** (neighborId + NEIGHBOR_LOOKUP.length))) !== 0) {
      neighbors.ingoing.push(NEIGHBOR_LOOKUP[neighborId]);
    }
  }

  return neighbors;
}

const getNeighborsFromBitMask = _.memoize(_getNeighborsFromBitMask);

function getNeighborId(neighbor) {
  const neighborId = neighborToIndex.get(neighbor);
  if (neighborId == null) {
    throw new Error("Could not look up neighbor");
  }
  return neighborId;
}

function addOutgoingEdge(edgeBuffer, idx, neighborId) {
  edgeBuffer[idx] |= 2 ** neighborId;
}
function addIngoingEdge(edgeBuffer, idx, neighborId) {
  edgeBuffer[idx] |= 2 ** (NEIGHBOR_LOOKUP.length + neighborId);
}
function removeIngoingEdge(edgeBuffer, idx, neighborId) {
  edgeBuffer[idx] &= ~(2 ** (NEIGHBOR_LOOKUP.length + neighborId));
}
function removeOutgoingEdge(edgeBuffer, idx, neighborId) {
  edgeBuffer[idx] &= ~(2 ** neighborId);
}

function* performMinCut(): Saga<void> {
  const allowSave = yield* select(store => store.tracing.restrictions.allowSave);
  if (allowSave && window.disableSavingOnMinCut) {
    console.log("disable saving");
    console.log("ensure saved state");
    yield* call([Model, Model.ensureSavedState]);
    console.log("disable saving");
    yield* put(disableSavingAction());
  }
  console.log("start min cut");

  const skeleton = yield* select(store => store.tracing.skeleton);
  if (!skeleton) {
    console.log("no skeleton");
    return;
  }
  const activeTree = Utils.toNullable(getActiveTree(skeleton));

  if (!activeTree) {
    console.log("no active tree");
    return;
  }

  const nodes = Array.from(activeTree.nodes.values());

  if (nodes.length !== 2) {
    console.log("active tree should have exactly two nodes.");
    return;
  }

  const boundingBoxes = skeleton.userBoundingBoxes.filter(bbox => bbox.isVisible);
  let boundingBoxObj;
  if (boundingBoxes.length === 0) {
    console.log("no visible bounding box defined for min-cut. creating one...");
    const padding = 50;
    const newBBox = {
      min: [
        Math.floor(Math.min(nodes[0].position[0], nodes[1].position[0]) - padding),
        Math.floor(Math.min(nodes[0].position[1], nodes[1].position[1]) - padding),
        Math.floor(Math.min(nodes[0].position[2], nodes[1].position[2]) - padding),
      ],
      max: [
        Math.ceil(Math.max(nodes[0].position[0], nodes[1].position[0]) + padding),
        Math.ceil(Math.max(nodes[0].position[1], nodes[1].position[1]) + padding),
        Math.ceil(Math.max(nodes[0].position[2], nodes[1].position[2]) + padding),
      ],
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

  const targetMag = [2, 2, 1];
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
      "Given seeds are not placed on same segment",
      inputData[ll(seedA)],
      "vs",
      inputData[ll(seedB)],
    );
    console.log({ seedA, seedB });
    console.log("edgeBuffer.length", edgeBuffer.length);
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
        for (let neighborId = 0; neighborId < NEIGHBOR_LOOKUP.length; neighborId++) {
          const neighbor = NEIGHBOR_LOOKUP[neighborId];
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
            addOutgoingEdge(edgeBuffer, linIndex, neighborId);
            addIngoingEdge(edgeBuffer, neighborLinIndex, invertNeighborId(neighborId));
          }
        }
      }
    }
  }
  console.timeEnd("populate data");

  const originalEdgeBuffer = new Uint16Array(edgeBuffer); // .fill(2 ** 12 - 1);

  // for (let y = 0; y < 4; y++) {
  //   for (let x = 0; x < 4; x++) {
  //     const neighbors = getNeighborsFromBitMask(edgeBuffer[l(x, y, 0)]);
  //     console.log({ x, y, neighbors });
  //   }
  // }

  function populateDistanceField() {
    // Breadth-first search from seedA to seedB
    const distanceField = new Uint16Array(boundingBoxTarget.getVolume());
    const directionField = new Uint8Array(boundingBoxTarget.getVolume()).fill(255);
    const queue: Array<{ voxel: Array<number>, distance: number, usedEdgeIdx: number }> = [
      { voxel: seedA, distance: 1, usedEdgeIdx: 255 },
    ];
    let foundTarget = false;
    while (queue.length > 0) {
      const { voxel: currVoxel, distance, usedEdgeIdx } = queue.shift();

      const currVoxelIdx = ll(currVoxel);
      if (distanceField[currVoxelIdx] > 0) {
        continue;
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

        const neighborId = getNeighborId(neighbor);

        queue.push({ voxel: neighborPos, distance: distance + 1, usedEdgeIdx: neighborId });
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
      const edgeId = invertNeighborId(originallyUsedEdgeId);
      const neighbor = NEIGHBOR_LOOKUP[edgeId];

      const neighborPos = V3.add(currentVoxel, neighbor);
      const neighborId = neighborToIndex.get(neighbor);

      if (neighborId == null) {
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

        removeIngoingEdge(edgeBuffer, ll(currentVoxel), neighborId);

        // console.log("After removing edge", edgeBuffer[ll(currentVoxel)].toString(2));

        const ingoingNeighbors = getNeighborsFromBitMask(edgeBuffer[ll(currentVoxel)]).ingoing;
        if (ingoingNeighborsOld.length - ingoingNeighbors.length !== 1) {
          console.log("didn't remove edge successfully");
          debugger;
        }

        // Remove outgoing
        const invertedNeighborId = invertNeighborId(neighborId);
        // console.log("Before removing edge", edgeBuffer[ll(neighborPos)].toString(2));

        removeOutgoingEdge(edgeBuffer, ll(neighborPos), invertedNeighborId);

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

    // queue.push({ voxel: seedB });
    // while (queue.length > 0) {
    //   const { voxel: currVoxel } = queue.shift();

    //   const currVoxelIdx = ll(currVoxel);
    //   if (visitedField[currVoxelIdx] > 0) {
    //     continue;
    //   }
    //   visitedField[currVoxelIdx] = 1;
    //   const neighbors = getNeighborsFromBitMask(edgeBuffer[currVoxelIdx]).ingoing;

    //   for (const neighbor of neighbors) {
    //     const neighborPos = V3.add(currVoxel, neighbor);

    //     queue.push({ voxel: neighborPos });
    //   }
    // }

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
