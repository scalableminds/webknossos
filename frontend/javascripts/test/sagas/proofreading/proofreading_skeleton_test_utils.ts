import type { MinCutTargetEdge } from "admin/rest_api";
import isEqual from "lodash-es/isEqual";
import sortBy from "lodash-es/sortBy";
import { Root } from "protobufjs";
import type { WebknossosTestContext } from "test/helpers/apiHelpers";
import { put } from "typed-redux-saga";
import type {
  ServerNode,
  ServerSkeletonTracing,
  ServerSkeletonTracingTree,
  ServerTracing,
} from "types/api_types";
import { type TreeType, TreeTypeEnum, type Vector3 } from "viewer/constants";
import { loadAgglomerateSkeletonAtPosition } from "viewer/controller/combinations/segmentation_handlers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { getTreesWithType } from "viewer/model/accessors/skeletontracing_accessor";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { minCutAgglomerateAction } from "viewer/model/actions/proofread_actions";
import { deleteEdgeAction, mergeTreesAction } from "viewer/model/actions/skeletontracing_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { PROTO_FILES, PROTO_TYPES } from "viewer/model/helpers/proto_helpers";
import { call, type Saga, select, take } from "viewer/model/sagas/effect-generators";
import type { Edge, TreeMap } from "viewer/model/types/tree_types";
import type { NumberLike, SkeletonTracing, WebknossosState } from "viewer/store";
import { expect, vi } from "vitest";
import { expectedMappingAfterMerge, initialMapping } from "./proofreading_fixtures";
import {
  getAllCurrentlyLoadedMeshIds,
  initializeMappingAndTool,
  loadAgglomerateMeshes,
  makeMappingEditableHelper,
} from "./proofreading_test_utils";

export function encodeServerTracing(
  tracing: ServerTracing,
  annotationType: "skeleton" | "volume",
): ArrayBuffer {
  const protoRoot = Root.fromJSON(PROTO_FILES[annotationType]);
  const messageType = protoRoot.lookupType(PROTO_TYPES[annotationType]);

  // Verify that the object really matches the proto schema
  const err = messageType.verify(tracing);
  if (err) throw new Error(`Invalid ServerTracing: ${err}`);

  // Create an internal protobufjs message and encode
  const message = messageType.create(tracing);
  const u8 = new Uint8Array(messageType.encode(message).finish()); // Uint8Array

  // Vitest/fetch mocks often like ArrayBuffer
  return u8.buffer;
}

/**
 * Create an agglomerate skeleton as a ServerSkeletonTracing for the agglomerate given by the adjacencyList.
 *
 * @param adjacencyList array of tuples of edges between the segments
 * @param startNode the node id we want the skeleton for
 * @param tracingId id for the resulting tracing
 */
export function createSkeletonTracingFromAdjacency(
  adjacencyList: Map<number, Set<number>>,
  startNode: number,
  tracingId: string,
  version: number,
): ServerSkeletonTracing {
  // BFS to find component containing startNode
  const visited = new Set<number>();
  const queue: number[] = [startNode];
  // If the startNode is truly isolated (not present in adjacency list), we still want a single-node component.
  visited.add(startNode);

  while (queue.length) {
    const n = queue.shift()!;
    const neighbours = adjacencyList.get(n);
    if (!neighbours) continue;
    for (const nb of neighbours) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }

  // If visited only contains startNode but startNode is present in adjacency pairs,
  // ensure we actually captured its component (we started with startNode so BFS above will expand).
  // Now collect edges whose both endpoints are inside the component
  const componentNodes = Array.from(visited).sort((a, b) => a - b);
  const componentNodeSet = new Set(componentNodes);

  const componentEdges: Edge[] = [];
  for (const [node, neighbours] of adjacencyList) {
    for (const neighbour of neighbours) {
      if (
        componentNodeSet.has(node) &&
        componentNodeSet.has(neighbour) &&
        !componentEdges.some((e) => e.source === neighbour && e.target === node)
      ) {
        componentEdges.push({ source: node, target: neighbour });
      }
    }
  }

  // Build ServerNode objects. Position = (n,n,n) as requested.
  const now = Date.now();
  const nodes: ServerNode[] = componentNodes.map((n) => ({
    id: n,
    position: { x: n, y: n, z: n },
    additionalCoordinates: [],
    rotation: { x: 0, y: 0, z: 0 },
    bitDepth: 8,
    viewport: 0,
    mag: 1,
    radius: 1,
    createdTimestamp: now,
    interpolation: false,
  }));

  // Single tree for this component
  const tree: ServerSkeletonTracingTree = {
    branchPoints: [],
    color: null,
    comments: [],
    edges: componentEdges,
    name: `component-${startNode}`,
    nodes,
    treeId: 1,
    createdTimestamp: now,
    groupId: null,
    isVisible: true,
    type: 1 as any as TreeType, // Needed as encoding only accepts enum ids and not the representative string.
    edgesAreVisible: true,
    metadata: [],
  };

  type ServerSkeletonTracingProtoCompatible = ServerSkeletonTracing & {
    datasetName: string; // Still part of the proto but unused. Needed to make
    // custom proto parsing & mocking work in proofreading skeleton tests.
  };

  const tracing: ServerSkeletonTracingProtoCompatible = {
    datasetName: "is-ignored-anyway",
    id: tracingId,
    userBoundingBoxes: [],
    userBoundingBox: undefined,
    createdTimestamp: now,
    error: undefined,
    additionalAxes: [],
    // version purposely left out; parseProtoTracing will delete it if present in the real server response
    editPosition: { x: startNode, y: startNode, z: startNode },
    editPositionAdditionalCoordinates: [],
    editRotation: { x: 0, y: 0, z: 0 },
    zoomLevel: 1,
    typ: "Skeleton",
    activeNodeId: startNode,
    boundingBox: undefined,
    trees: [tree],
    treeGroups: [],
    storedWithExternalTreeBodies: false,
    userStates: [],
    version,
  };

  return tracing;
}

// Little helper to load a list of agglomerate skeletons in a test.
// Should be done before any other mapping changes. Else the assumptions of the tests are not correct.
// The agglomerate ids must correspond to one of the agglomerate positions.
// Should be the case initially for all proofreading tests.
export function* loadAgglomerateSkeletons(
  context: WebknossosTestContext,
  agglomerateIdsToLoad: number[],
  shouldSaveAfterLoadingTrees: boolean,
  isInLiveCollabMode: boolean,
): Saga<TreeMap> {
  // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
  vi.mocked(context.mocks.parseProtoTracing).mockRestore();
  for (let index = 0; index < agglomerateIdsToLoad.length; ++index) {
    const agglomerateId = agglomerateIdsToLoad[index];
    yield call(loadAgglomerateSkeletonAtPosition, [agglomerateId, agglomerateId, agglomerateId]);
    // Wait until skeleton saga has loaded the skeleton.
    if (isInLiveCollabMode) {
      yield take("SNAPSHOT_ANNOTATION_STATE_FOR_NEXT_REBASE");
    } else {
      yield take("ADD_TREES_AND_GROUPS");
    }
  }
  if (shouldSaveAfterLoadingTrees) {
    yield call(() => context.api.tracing.save()); // Also pulls newest version from backend.
  }
  return yield* select((state) =>
    getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
  );
}

function* loadInitialMeshes(context: WebknossosTestContext) {
  // Load all meshes for all affected agglomerate meshes and one more.
  yield loadAgglomerateMeshes([4, 6, 1]);

  const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
  expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);
}

export function* performMergeTreesProofreading(
  context: WebknossosTestContext,
  shouldSaveAfterLoadingTrees: boolean,
  loadMeshes: boolean,
): Saga<void> {
  const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
  yield call(initializeMappingAndTool, context, tracingId);
  const mapping0 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping0).toEqual(initialMapping);
  if (loadMeshes) {
    yield loadInitialMeshes(context);
  }

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1));
  yield makeMappingEditableHelper();

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  const mapping1 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping1).toEqual(initialMapping);
  yield put(setOthersMayEditForAnnotationAction(true));
  const agglomerateTrees = yield loadAgglomerateSkeletons(
    context,
    [1, 4],
    shouldSaveAfterLoadingTrees,
    true,
  );
  const sourceNode = agglomerateTrees.getOrThrow(3).nodes.getOrThrow(6);
  const targetNode = agglomerateTrees.getOrThrow(4).nodes.getOrThrow(7);
  yield put(mergeTreesAction(sourceNode.id, targetNode.id));
  yield take("FINISH_MAPPING_INITIALIZATION");
  const mappingAfterOptimisticUpdate = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );

  expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);
  yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Wait till full merge operation is done.
}

// Loads agglomerate tree for agglomerate 1 and splits segments 2 and 3.
export function* performSplitTreesProofreading(
  context: WebknossosTestContext,
  loadMeshes: boolean,
): Saga<void> {
  const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
  yield call(initializeMappingAndTool, context, tracingId);
  const mapping0 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping0).toEqual(initialMapping);
  if (loadMeshes) {
    yield loadInitialMeshes(context);
  }

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1));

  yield makeMappingEditableHelper();

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  const mapping1 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping1).toEqual(initialMapping);
  yield put(setOthersMayEditForAnnotationAction(true));

  const agglomerateTrees = yield loadAgglomerateSkeletons(context, [1], true, true);
  const sourceNode = agglomerateTrees.getOrThrow(3).nodes.getOrThrow(5);
  const targetNode = agglomerateTrees.getOrThrow(3).nodes.getOrThrow(6);
  yield put(deleteEdgeAction(sourceNode.id, targetNode.id));

  yield take("FINISH_MAPPING_INITIALIZATION");
  yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Wait till full merge operation is done.
}

export function* performMinCutWithNodesProofreading(
  context: WebknossosTestContext,
  loadMeshes: boolean,
): Saga<void> {
  const { api } = context;
  const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
  yield call(initializeMappingAndTool, context, tracingId);
  const mapping0 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping0).toEqual(initialMapping);
  if (loadMeshes) {
    yield loadInitialMeshes(context);
  }

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
  yield put(setActiveCellAction(1));

  yield makeMappingEditableHelper();

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  const mapping1 = yield select(
    (state) => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
  );
  expect(mapping1).toEqual(initialMapping);
  yield put(setOthersMayEditForAnnotationAction(true));
  // Load agglomerate skeleton for agglomerate id 1.
  yield call(loadAgglomerateSkeletons, context, [1], true, true);
  yield call(() => api.tracing.save()); // Also pulls newest version from backend.
  const skeletonWithAgglomerateTrees: SkeletonTracing = yield select(
    (state: WebknossosState) => state.annotation.skeleton,
  );
  const agglomerateTrees = Array.from(
    skeletonWithAgglomerateTrees.trees
      .values()
      .filter((tree) => tree.type === TreeTypeEnum.AGGLOMERATE),
  );
  expect(agglomerateTrees.length).toBe(1);
  const targetNode = agglomerateTrees[0].nodes.getOrThrow(5);
  expect(targetNode.untransformedPosition).toStrictEqual([2, 2, 2]);
  const sourceNode = agglomerateTrees[0].nodes.getOrThrow(6);
  expect(sourceNode.untransformedPosition).toStrictEqual([3, 3, 3]);
  yield put(minCutAgglomerateAction(sourceNode.id, targetNode.id));

  yield take("FINISH_MAPPING_INITIALIZATION");
  yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Wait till full merge operation is done.
}

export const mockEdgesForAgglomerateMinCut = (
  mocks: WebknossosTestContext["mocks"],
  expectedRequestedVersion: number,
  onlyThreeOneEdge: boolean = false,
) =>
  vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockImplementation(
    async (
      _tracingStoreUrl: string,
      _tracingId: string,
      version: number,
      segmentsInfo: {
        partition1: NumberLike[];
        partition2: NumberLike[];
        mag: Vector3;
        agglomerateId: NumberLike;
        editableMappingId: string;
      },
    ): Promise<Array<MinCutTargetEdge>> => {
      if (version !== expectedRequestedVersion) {
        throw new Error(
          `Unexpected version of min cut request. Expected ${expectedRequestedVersion} got ${version}`,
        );
      }
      const { agglomerateId, partition1, partition2 } = segmentsInfo;
      if (agglomerateId === 1 && isEqual(partition1, [3]) && isEqual(partition2, [2])) {
        return [
          {
            position1: [3, 3, 3],
            position2: [2, 2, 2],
            segmentId1: 3,
            segmentId2: 2,
          } as MinCutTargetEdge,
          onlyThreeOneEdge
            ? undefined
            : ({
                position1: [3, 3, 3],
                position2: [1, 1, 1],
                segmentId1: 3,
                segmentId2: 1,
              } as MinCutTargetEdge),
        ].filter((a) => a != null);
      }
      throw new Error("Unexpected min cut request");
    },
  );
