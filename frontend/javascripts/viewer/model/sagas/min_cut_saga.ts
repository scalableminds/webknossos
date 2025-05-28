import { V3 } from "libs/mjs";
import createProgressCallback from "libs/progress_callback";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import window from "libs/window";
import _ from "lodash";
import { call, put } from "typed-redux-saga";
import type { APISegmentationLayer } from "types/api_types";
import type { AdditionalCoordinate } from "types/api_types";
import type { BoundingBoxMinMaxType, TypedArray, Vector3 } from "viewer/constants";
import { getMagInfo } from "viewer/model/accessors/dataset_accessor";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracingLayer,
} from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { finishAnnotationStrokeAction } from "viewer/model/actions/volumetracing_actions";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { takeEveryUnlessBusy } from "viewer/model/sagas/saga_helpers";
import type { MutableNode, Node } from "viewer/model/types/tree_types";
import { api } from "viewer/singletons";
import type { MagInfo } from "../helpers/mag_info";

// By default, a new bounding box is created around
// the seed nodes with a padding. Within the bounding box
// the min-cut is computed.
const DEFAULT_PADDING: Vector3 = [50, 50, 50];
// Voxels which are close to the seeds must not be relabeled.
// Otherwise, trivial min-cuts are performed which cut right
// around one seed.
// This distance is specified in voxels of the current mag (i.e.,
// a distance of 30 vx should be respected) and does not need scaling
// to another mag.
// For seeds that are very close to each other, their distance
// overrides this threshold.
const MIN_DIST_TO_SEED = 30;
const TimeoutError = new Error("Timeout");
const PartitionFailedError = new Error(
  "Segmentation could not be partitioned. Zero edges removed in last iteration. Probably due to nodes being too close to each other? Aborting...",
);
// If the min-cut does not succeed after 10 seconds
// in the selected mag, the next mag is tried.
const MIN_CUT_TIMEOUT = 10 * 1000; // 10 seconds

// During the refinement phase, the timeout is more forgiving.
// Even if the refinement is slow, we typically don't want to
// abort it, since the initial min-cut has already been performed.
// Note that the timeout is used for each refining min-cut phase.
const MIN_CUT_TIMEOUT_REFINEMENT = 30 * 1000; // 30 seconds

// To choose the initial mag, a voxel threshold is defined
// as a heuristic. This avoids that an unrealistic mag
// is tried in the first place.
// 2 MV corresponds to ~8MB for uint32 data.
const VOXEL_THRESHOLD = 2000000;
// The first magnification is always ignored initially as a performance
// optimization (unless it's the only existent mag).
const ALWAYS_IGNORE_FIRST_MAG_INITIALLY = true;

function selectAppropriateMags(
  boundingBoxMag1: BoundingBox,
  magInfo: MagInfo,
): Array<[number, Vector3]> {
  const magsWithIndices = magInfo.getMagsWithIndices();
  const appropriateMags: Array<[number, Vector3]> = [];

  for (const [magIndex, mag] of magsWithIndices) {
    if (magIndex === 0 && magsWithIndices.length > 1 && ALWAYS_IGNORE_FIRST_MAG_INITIALLY) {
      // Don't consider Mag 1, as it's usually too fine-granular
      continue;
    }

    const boundingBoxTarget = boundingBoxMag1.fromMag1ToMag(mag);

    if (boundingBoxTarget.getVolume() < VOXEL_THRESHOLD) {
      appropriateMags.push([magIndex, mag]);
    }
  }

  return appropriateMags;
}

//
// Helper functions for managing neighbors / edges.
//
// There are 6 neighbor in 3D space (manhattan-jumps).
// The neighbors can be accessed via neighbor indices (e.g., idx=1 ==> neighbor [0, -1, 0])
const NEIGHBOR_LOOKUP: Vector3[] = [
  [0, 0, -1],
  [0, -1, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [1, 0, 0],
];
// neighborToIndex is a mapping from neighbor to neighbor index (e.g., neighbor [0, -1, 0] ==> idx=1)
const neighborToIndex = new Map(_.zip(NEIGHBOR_LOOKUP, _.range(NEIGHBOR_LOOKUP.length)));

function getNeighborIdx(neighbor: Vector3): number {
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
// Given the neighboring voxels:
//   A --> B
// From the perspective of A, B can be accessed by using the outgoing edge
// along vector [0, 1, 0] (idx=4). From the perspective of B, this is an
// ingoing edge (referenced by idx=1 == [0, -1, 0]).
const invertNeighborIdx = (neighborIdx: number) =>
  (neighborIdx + NEIGHBOR_LOOKUP.length / 2) % NEIGHBOR_LOOKUP.length;

function _getNeighborsFromBitMask(bitMask: number): { ingoing: Vector3[]; outgoing: Vector3[] } {
  // Note: Use the memoized version of this: getNeighborsFromBitMask.
  // Ingoing and outgoing edges are stored as a bitmask. The first half
  // (higher significance) of the bitmask holds the ingoing edges as bits.
  // The second half (lower significance) the outgoing edges.
  //
  // For example, the bitmask
  //  010000 000000
  //  (most significant bits to least significant bits)
  // means that there is exactly one ingoing edge ([0, -1, 0]).
  const neighbors = {
    ingoing: [],
    outgoing: [],
  };

  for (let neighborIdx = 0; neighborIdx < NEIGHBOR_LOOKUP.length; neighborIdx++) {
    if ((bitMask & (2 ** neighborIdx)) !== 0) {
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number[]' is not assignable to p... Remove this comment to see the full error message
      neighbors.outgoing.push(NEIGHBOR_LOOKUP[neighborIdx]);
    }

    if ((bitMask & (2 ** (neighborIdx + NEIGHBOR_LOOKUP.length))) !== 0) {
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number[]' is not assignable to p... Remove this comment to see the full error message
      neighbors.ingoing.push(NEIGHBOR_LOOKUP[neighborIdx]);
    }
  }

  return neighbors;
}

const getNeighborsFromBitMask = _.memoize(_getNeighborsFromBitMask);

// Functions to add/remove edges which mutate the bitmask.
function addOutgoingEdge(edgeBuffer: Uint16Array, idx: number, neighborIdx: number) {
  edgeBuffer[idx] |= 2 ** neighborIdx;
}

function addIngoingEdge(edgeBuffer: Uint16Array, idx: number, neighborIdx: number) {
  edgeBuffer[idx] |= 2 ** (NEIGHBOR_LOOKUP.length + neighborIdx);
}

function removeIngoingEdge(edgeBuffer: Uint16Array, idx: number, neighborIdx: number) {
  edgeBuffer[idx] &= ~(2 ** (NEIGHBOR_LOOKUP.length + neighborIdx));
}

function removeOutgoingEdge(edgeBuffer: Uint16Array, idx: number, neighborIdx: number) {
  edgeBuffer[idx] &= ~(2 ** neighborIdx);
}

export function isBoundingBoxUsableForMinCut(
  boundingBoxObj: BoundingBoxMinMaxType,
  nodes: Array<Node>,
) {
  const bbox = new BoundingBox(boundingBoxObj);
  return (
    bbox.containsPoint(nodes[0].untransformedPosition) &&
    bbox.containsPoint(nodes[1].untransformedPosition)
  );
}

type L = (x: number, y: number, z: number) => number;
type LL = (vec: Vector3) => number;

//
// Actual min cut implementation.
//
// Note that a heuristic is used to
// determine an appropriate mag to compute the min-cut in.
// If the computation takes too long, the min-cut is aborted and a
// poorer mag is tried.
// Afterwards, it is tried to "refine" the min-cut by also calculating
// the min-cut in better mags. As a result, the cut is initially drawn
// "with broad/fast strokes" and the final details are solved in higher
// mags.
function* performMinCut(action: Action): Saga<void> {
  if (action.type !== "PERFORM_MIN_CUT") {
    throw new Error("Satisfy typescript.");
  }

  const skeleton = yield* select((store) => store.annotation.skeleton);

  if (!skeleton) {
    return;
  }

  const seedTree = skeleton.trees.getNullable(action.treeId);

  if (!seedTree) {
    throw new Error(`seedTree with id ${action.treeId} not found.`);
  }

  const nodes = Array.from(seedTree.nodes.values());

  if (nodes.length !== 2) {
    // The min-cut operation should not be available in the context-menu when the tree
    // does not have exactly two nodes.
    return;
  }

  const { boundingBoxId } = action;
  let boundingBoxObj;

  if (boundingBoxId != null) {
    const boundingBoxes = skeleton.userBoundingBoxes.filter((bbox) => bbox.id === boundingBoxId);

    if (boundingBoxes.length !== 1) {
      throw new Error(
        `Expected (exactly) one bounding box with id ${boundingBoxId} but there are ${boundingBoxes.length}.`,
      );
    }

    boundingBoxObj = boundingBoxes[0].boundingBox;
  } else {
    const newBBox = {
      min: V3.floor(
        V3.sub(
          V3.min(nodes[0].untransformedPosition, nodes[1].untransformedPosition),
          DEFAULT_PADDING,
        ),
      ),
      max: V3.floor(
        V3.add(
          V3.add(
            V3.max(nodes[0].untransformedPosition, nodes[1].untransformedPosition),
            DEFAULT_PADDING,
          ), // Add [1, 1, 1], since BoundingBox.max is exclusive
          [1, 1, 1],
        ),
      ),
    };
    yield* put(
      addUserBoundingBoxAction({
        boundingBox: newBBox,
        name: `Bounding box used for splitting cell (seedA=(${nodes[0].untransformedPosition.join(
          ",",
        )}), seedB=(${nodes[1].untransformedPosition.join(
          ",",
        )}), timestamp=${new Date().getTime()})`,
        color: Utils.getRandomColor(),
        isVisible: true,
      }),
    );
    boundingBoxObj = newBBox;
  }

  const boundingBoxMag1 = new BoundingBox(boundingBoxObj);

  if (!isBoundingBoxUsableForMinCut(boundingBoxObj, nodes)) {
    // The user should not be able to trigger this path --> Don't show a toast.
    // Only keep this for debugging purposes.
    console.log("The seeds are not contained in the current bbox.");
    return;
  }

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  const volumeTracing = yield* select(enforceActiveVolumeTracing);

  if (!volumeTracingLayer) {
    console.log("No volumeTracing available.");
    return;
  }

  const magInfo = getMagInfo(volumeTracingLayer.resolutions);
  const appropriateMagInfos = selectAppropriateMags(boundingBoxMag1, magInfo);

  if (appropriateMagInfos.length === 0) {
    yield* call(
      [Toast, Toast.warning],
      "The bounding box for the selected seeds is too large. Choose a smaller bounding box or lower the distance between the seeds. Alternatively, ensure that lower magnifications exist which can be used.",
    );
    return;
  }

  const progressCallback = createProgressCallback({
    pauseDelay: 200,
    successMessageDelay: 5000,
  });

  // Try to perform a min-cut on the selected mags. If the min-cut
  // fails for one mag, it's tried again on the next mag.
  // If the min-cut succeeds, it's refined again with the better mags.
  for (const [magIndex, targetMag] of appropriateMagInfos) {
    try {
      yield* call(
        progressCallback,
        false,
        `Trying min-cut computation at Mag=${targetMag.join("-")}`,
      );
      console.group("Trying min-cut computation at", targetMag.join("-"));
      yield* call(
        tryMinCutAtMag,
        targetMag,
        magIndex,
        boundingBoxMag1,
        nodes,
        volumeTracingLayer,
        MIN_CUT_TIMEOUT,
      );
      console.groupEnd();

      for (let refiningMagIndex = magIndex - 1; refiningMagIndex >= 0; refiningMagIndex--) {
        // Refine min-cut on lower mags, if they exist.
        if (!magInfo.hasIndex(refiningMagIndex)) {
          continue;
        }

        const refiningMag = magInfo.getMagByIndexOrThrow(refiningMagIndex);
        console.group("Refining min-cut at", refiningMag.join("-"));
        yield* call(progressCallback, false, `Refining min-cut at Mag=${refiningMag.join("-")}`);

        try {
          yield* call(
            tryMinCutAtMag,
            refiningMag,
            refiningMagIndex,
            boundingBoxMag1,
            nodes,
            volumeTracingLayer,
            MIN_CUT_TIMEOUT_REFINEMENT,
          );
        } catch (exception) {
          if (exception === TimeoutError) {
            console.warn(
              "Refinement of min-cut timed out. There still might be small voxel connections between the seeds.",
            );
            yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
            yield* call(
              { context: null, fn: progressCallback },
              true,
              "Min-cut calculation finished. However, the refinement timed out. There still might be small voxel connections between the seeds.",
              {},
              "warning",
            );
            return;
          }
        }

        console.groupEnd();
      }

      yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
      yield* call(progressCallback, true, "Min-cut calculation was successful.");
      return;
    } catch (exception) {
      console.groupEnd();

      if (exception === TimeoutError) {
        console.log("Retrying at higher mag if possible...");
      } else if (exception === PartitionFailedError) {
        console.warn(exception);
        return;
      } else {
        throw exception;
      }
    }
  }

  yield* call(
    progressCallback,
    true,
    "A min-cut couldn't be performed, because the calculation timed out.",
    {},
    "warning",
  );
  yield* call([Toast, Toast.warning], "Couldn't perform min-cut due to timeout");
}

//
// Algorithmic implementation of the min cut approach.
// For more background, look up the Edmonds–Karp or Ford–Fulkerson algorithm.
// Note that our min-cut approach is a special case of these algorithms, since
// we only have edges with a capacity of 1.
//
// The directed (!) voxel graph is defined so that each voxel is a node and
// two nodes are connected if they are neighbors and have the same segment id.
// Since the graph is directed, all edges are initially symmetric double-edges.
//
// The algorithm looks for shortest paths between two given seeds A and B (via
// breadth-first searches).
// In each iteration, a shortest path between A and B is removed until no paths
// exist anymore. Thus, the two seeds are separated from each other.
//
// When removing a path, only the edges are removed which point from A to B.
// This leaves "back-edges" in the graph (also known as "residuals").
// In the final phase, these residuals are traversed to find out which nodes
// cannot be reached, anymore. These nodes are the ones that should be erased
// to separate A from B.
function* tryMinCutAtMag(
  targetMag: Vector3,
  magIndex: number,
  boundingBoxMag1: BoundingBox,
  nodes: MutableNode[],
  volumeTracingLayer: APISegmentationLayer,
  maxTimeoutDuration: number,
): Saga<void> {
  const targetMagString = `${targetMag.join(",")}`;
  const boundingBoxTarget = boundingBoxMag1.fromMag1ToMag(targetMag);
  const globalSeedA = V3.fromMag1ToMag(nodes[0].untransformedPosition, targetMag);
  const globalSeedB = V3.fromMag1ToMag(nodes[1].untransformedPosition, targetMag);
  const minDistToSeed = Math.min(V3.length(V3.sub(globalSeedA, globalSeedB)) / 2, MIN_DIST_TO_SEED);
  console.log("Setting minDistToSeed to ", minDistToSeed);
  const seedA = V3.sub(globalSeedA, boundingBoxTarget.min);
  const seedB = V3.sub(globalSeedB, boundingBoxTarget.min);
  console.log(`Loading data... (for ${boundingBoxTarget.getVolume()} vx)`);
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);

  const inputData = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    volumeTracingLayer.name,
    boundingBoxMag1,
    magIndex,
    additionalCoordinates,
  );
  // For the 3D volume flat arrays are constructed
  // which can be accessed with the helper methods
  // l(x, y, z) and l([x, y, z]).
  const size = boundingBoxTarget.getSize();

  const l = (x: number, y: number, z: number): number => z * size[1] * size[0] + y * size[0] + x;
  const ll = ([x, y, z]: Vector3): number => z * size[1] * size[0] + y * size[0] + x;

  if (inputData[ll(seedA)] !== inputData[ll(seedB)]) {
    yield* call(
      [Toast, Toast.warning],
      `The given seeds are not placed on same segment: ${inputData[ll(seedA)]} vs ${
        inputData[ll(seedB)]
      }.`,
    );
    return;
  }

  const segmentId = Number(inputData[ll(seedA)]);
  // We calculate the latest time at which the min cut may still
  // be executed. The min-cut algorithm will check from time to
  // time whether the threshold is violated.
  // This approach was chosen over a timeout mechanism via
  // race/delay saga due to performance reasons. The latter approach
  // requires that even tightly-called functions are generators
  // which yield to the redux-saga middleware. Rough benchmarks
  // showed an overall slow-down of factor 6.
  const timeoutThreshold = performance.now() + maxTimeoutDuration;
  console.log("Starting min-cut...");
  console.time(`Total min-cut (${targetMagString})`);
  console.time(`Build Graph (${targetMagString})`);
  const edgeBuffer = buildGraph(
    inputData,
    segmentId,
    size,
    boundingBoxTarget.getVolume(),
    l,
    ll,
    timeoutThreshold,
  );
  // Copy original edge buffer, as it's mutated later when removing edges.
  const originalEdgeBuffer = new Uint16Array(edgeBuffer);
  console.timeEnd(`Build Graph (${targetMagString})`);
  console.time(`Find & delete paths (${targetMagString})`);
  let exitLoop = false;

  while (!exitLoop) {
    const { foundTarget, distanceField, directionField } = populateDistanceField(
      edgeBuffer,
      boundingBoxTarget,
      seedA,
      seedB,
      ll,
      timeoutThreshold,
    );

    if (foundTarget) {
      const { removedEdgeCount } = removeShortestPath(
        distanceField,
        directionField,
        seedA,
        seedB,
        ll,
        size,
        edgeBuffer,
        minDistToSeed,
      );

      if (removedEdgeCount === 0) {
        throw PartitionFailedError;
      }
    } else {
      console.log("Segmentation is partitioned");
      exitLoop = true;
    }
  }

  console.timeEnd(`Find & delete paths (${targetMagString})`);
  console.time(`traverseResidualsField (${targetMagString})`);
  const { visitedField } = traverseResidualsField(boundingBoxTarget, seedA, ll, edgeBuffer);
  console.timeEnd(`traverseResidualsField (${targetMagString})`);
  console.time(`labelDeletedEdges (${targetMagString})`);
  labelDeletedEdges(
    visitedField,
    boundingBoxTarget,
    size,
    originalEdgeBuffer,
    targetMag,
    l,
    ll,
    additionalCoordinates,
  );
  console.timeEnd(`labelDeletedEdges (${targetMagString})`);
  console.timeEnd(`Total min-cut (${targetMagString})`);
}

function isPositionOutside(position: Vector3, size: Vector3) {
  return (
    position[0] < 0 ||
    position[1] < 0 ||
    position[2] < 0 ||
    position[0] >= size[0] ||
    position[1] >= size[1] ||
    position[2] >= size[2]
  );
}

function buildGraph(
  inputData: TypedArray,
  segmentId: number,
  size: Vector3,
  length: number,
  l: L,
  ll: LL,
  timeoutThreshold: number,
) {
  const edgeBuffer = new Uint16Array(length);

  for (let z = 0; z < size[2]; z++) {
    if (z % Math.floor(size[2] / 10) === 0 && performance.now() > timeoutThreshold) {
      // After each 10% chunk, we check whether there's a timeout
      throw TimeoutError;
    }

    for (let y = 0; y < size[1]; y++) {
      for (let x = 0; x < size[0]; x++) {
        // Traverse over all voxels
        const pos: Vector3 = [x, y, z];
        const linIndex = l(x, y, z);

        // Ignore voxel if it does not belong to seed segment
        if (inputData[linIndex] !== segmentId) {
          continue;
        }

        // Go over all neighbors
        for (let neighborIdx = 0; neighborIdx < NEIGHBOR_LOOKUP.length; neighborIdx++) {
          const neighbor = NEIGHBOR_LOOKUP[neighborIdx];
          const neighborPos = V3.add(pos, neighbor);

          if (isPositionOutside(neighborPos, size)) {
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

  return edgeBuffer;
}

function populateDistanceField(
  edgeBuffer: Uint16Array,
  boundingBoxTarget: BoundingBox,
  seedA: Vector3,
  seedB: Vector3,
  ll: LL,
  timeoutThreshold: number,
) {
  // Perform a breadth-first search from seedA to seedB.
  // The distance field encodes the distance from the current voxel to seedA.
  const distanceField = new Uint16Array(boundingBoxTarget.getVolume());
  // The direction field encodes for each voxel which direction needs to be
  // taken to follow the shortest path to seedA. Later, this field is used
  // to remove a shortest path.
  const directionField = new Uint8Array(boundingBoxTarget.getVolume()).fill(255);
  const queue: Array<{
    voxel: Vector3;
    distance: number;
    usedEdgeIdx: number;
  }> = [
    {
      voxel: seedA,
      distance: 1,
      usedEdgeIdx: 255,
    },
  ];
  let foundTarget = false;
  let lastDistance = 0;
  let iterationCount = 0;

  while (queue.length > 0) {
    iterationCount++;

    if (iterationCount % 10000 === 0 && performance.now() > timeoutThreshold) {
      throw TimeoutError;
    }

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'voxel' does not exist on type '{ voxel: ... Remove this comment to see the full error message
    const { voxel: currVoxel, distance, usedEdgeIdx } = queue.shift();
    const currVoxelIdx = ll(currVoxel);

    if (distanceField[currVoxelIdx] > 0) {
      continue;
    }

    if (distance > lastDistance) {
      lastDistance = distance;
    }

    distanceField[currVoxelIdx] = distance;
    directionField[currVoxelIdx] = usedEdgeIdx;

    if (V3.equals(currVoxel, seedB)) {
      foundTarget = true;
      break;
    }

    const neighbors = getNeighborsFromBitMask(edgeBuffer[currVoxelIdx]).outgoing;

    for (const neighbor of neighbors) {
      const neighborPos = V3.add(currVoxel, neighbor);
      const neighborIdx = getNeighborIdx(neighbor);

      if (distanceField[ll(neighborPos)] === 0) {
        queue.push({
          voxel: neighborPos,
          distance: distance + 1,
          usedEdgeIdx: neighborIdx,
        });
      }
    }
  }

  return {
    distanceField,
    directionField,
    foundTarget,
  };
}

function removeShortestPath(
  distanceField: Uint16Array,
  directionField: Uint8Array,
  seedA: Vector3,
  seedB: Vector3,
  ll: LL,
  size: Vector3,
  edgeBuffer: Uint16Array,
  minDistToSeed: number,
) {
  // Extract shortest path from seedB to seedA and remove edges which
  // belong to that path.
  const path = [];
  let foundSeed = false;
  const voxelStack = [seedB];
  const maxDistance = distanceField[ll(seedB)];
  let removedEdgeCount = 0;

  while (voxelStack.length > 0) {
    const currentVoxel = voxelStack.pop();
    if (currentVoxel == null) {
      throw new Error("Satisfy typescript");
    }
    const currentDistance = distanceField[ll(currentVoxel)];

    if (V3.equals(currentVoxel, seedA)) {
      foundSeed = true;
      break;
    }

    const originallyUsedEdgeId = directionField[ll(currentVoxel)];

    if (originallyUsedEdgeId >= NEIGHBOR_LOOKUP.length) {
      throw new Error("Could not look up used edge in directionField");
    }

    const neighborIdx = invertNeighborIdx(originallyUsedEdgeId);
    const neighbor = NEIGHBOR_LOOKUP[neighborIdx];
    const neighborPos = V3.add(currentVoxel, neighbor);

    if (isPositionOutside(neighborPos, size)) {
      throw new Error("Neighbor is outside of volume?");
    }

    if (!(distanceField[ll(neighborPos)] < currentDistance && distanceField[ll(neighborPos)] > 0)) {
      throw new Error("Direction points towards an equal/higher/zero distance?");
    }

    const currDist = distanceField[ll(neighborPos)];
    const distToSeed = Math.min(currDist, maxDistance - currDist);

    // We don't want to remove voxels which are close to the seeds.
    // See explanation for MIN_DIST_TO_SEED for details.
    if (distToSeed > minDistToSeed) {
      removedEdgeCount++;
      path.unshift(neighborPos);
      // Remove ingoing edge
      removeIngoingEdge(edgeBuffer, ll(currentVoxel), neighborIdx);
      // Remove outgoing edge
      const invertedNeighborIdx = invertNeighborIdx(neighborIdx);
      removeOutgoingEdge(edgeBuffer, ll(neighborPos), invertedNeighborIdx);
    }

    voxelStack.push(neighborPos);
  }

  return {
    path,
    foundSeed,
    removedEdgeCount,
  };
}

function traverseResidualsField(
  boundingBoxTarget: BoundingBox,
  seedA: Vector3,
  ll: LL,
  edgeBuffer: Uint16Array,
) {
  // Perform a breadth-first search from seedA and return
  // which voxels were visited (visitedField). This represents
  // the graph component for seedA.
  const visitedField = new Uint8Array(boundingBoxTarget.getVolume());
  const queue: Array<Vector3> = [seedA];

  while (queue.length > 0) {
    const currVoxel = queue.shift();
    if (currVoxel == null) {
      throw new Error("Satisfy typescript");
    }
    const currVoxelIdx = ll(currVoxel);

    if (visitedField[currVoxelIdx] > 0) {
      continue;
    }

    visitedField[currVoxelIdx] = 1;
    const neighbors = getNeighborsFromBitMask(edgeBuffer[currVoxelIdx]).outgoing;

    for (const neighbor of neighbors) {
      const neighborPos = V3.add(currVoxel, neighbor);
      queue.push(neighborPos);
    }
  }

  return {
    visitedField,
  };
}

function labelDeletedEdges(
  visitedField: Uint8Array,
  boundingBoxTarget: BoundingBox,
  size: Vector3,
  originalEdgeBuffer: Uint16Array,
  targetMag: Vector3,
  l: L,
  ll: LL,
  additionalCoordinates: AdditionalCoordinate[] | null,
) {
  for (let z = 0; z < size[2]; z++) {
    for (let y = 0; y < size[1]; y++) {
      for (let x = 0; x < size[0]; x++) {
        const idx = l(x, y, z);

        if (visitedField[idx] === 1) {
          const neighbors = getNeighborsFromBitMask(originalEdgeBuffer[idx]).outgoing;
          const currentPos: Vector3 = [x, y, z];

          for (const neighbor of neighbors) {
            const neighborPos = V3.add(currentPos, neighbor);

            if (visitedField[ll(neighborPos)] === 0) {
              const position = V3.fromMagToMag1(
                V3.add(boundingBoxTarget.min, neighborPos),
                targetMag,
              );

              for (let dz = 0; dz < targetMag[2]; dz++) {
                for (let dy = 0; dy < targetMag[1]; dy++) {
                  for (let dx = 0; dx < targetMag[0]; dx++) {
                    api.data.labelVoxels(
                      [V3.add(position, [dx, dy, dz])],
                      0,
                      additionalCoordinates,
                    );
                  }
                }
              }

              // @ts-ignore
              if (window.visualizeRemovedVoxelsOnMinCut) {
                // @ts-ignore
                window.addVoxelMesh(position, targetMag);
              }
            }
          }
        }
      }
    }
  }
}

export default function* listenToMinCut(): Saga<void> {
  yield* takeEveryUnlessBusy("PERFORM_MIN_CUT", performMinCut, "Min-cut is being computed.");
}
