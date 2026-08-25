import type { MinCutTargetEdge } from "admin/rest_api";
import {
  getNestedUpdateActions,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { call, delay, put, take } from "typed-redux-saga";
import type { Vector3 } from "viewer/constants";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import type { UpdateAction } from "viewer/model/sagas/volume/update_actions";
import { api, Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAgglomerateTree1,
  mergeAgglomerateTrees1And4,
  mergeSegment1And4,
  mergeSegment1And4WithAgglomerateTrees1And4And6,
  mergeSegment2And4,
  mergeSegment3And4WithAgglomerateTree1,
  mergeSegment3And4WithAgglomerateTree1And4,
  mergeSegment3And6WithAgglomerateTree1,
  mergeSegment4And6WithAgglomerateTree1And4,
  mergeSegment5And6,
  mergeSegment5And6WithAgglomerateTree1,
  mergeSegment5And6WithAgglomerateTree1And4,
  mergeSegment1337And5,
  minCutWithNodes2And3WithAgglomerateTree1,
  splitAgglomerateTree1,
  splitSegment1And2,
  splitSegment1And2WithAgglomerateTree1,
  splitSegment1And2WithAgglomerateTrees1And4And6,
  splitSegment1And2WithAgglomerateTrees1And6And4,
  splitSegment2And3,
  splitSegment2And3WithAgglomerateTree1,
  splitSegment2And3WithAgglomerateTrees1And4And6,
  splitSegment7And1337AndMerge1337And5,
} from "./proofreading_interaction_update_action_fixtures";
import {
  loadAgglomerateTrees,
  mockEdgesForAgglomerateMinCut,
  performMergeTreesProofreading,
  performMinCutWithNodesProofreading,
  performSplitTreesProofreading,
} from "./proofreading_skeleton_test_utils";
import {
  getPositionForSegmentId,
  initializeMappingAndTool,
  makeMappingEditableForTest,
  mockInitialBucketAndAgglomerateData,
  operationFinished,
} from "./proofreading_test_utils";

const ACTION_TYPES_BLACKLIST = ["updateCamera", "updateMappingName", "updateActiveSegmentId"];
const ACTION_TYPES_TREE_LOADING = ["createTree", "createNode", "createEdge"];

function removeBlacklistedActions(
  actionBatches: UpdateAction[][],
  keepTreeLoadingBatches: boolean = false,
) {
  const filteredActionBatches = actionBatches
    .map((actions) => actions.filter((action) => !ACTION_TYPES_BLACKLIST.includes(action.name)))
    .filter((arr) => arr.length > 0);
  if (keepTreeLoadingBatches) {
    return filteredActionBatches;
  }
  const actionBatchesWithoutTreeLoadingBatches = filteredActionBatches.filter((batch) => {
    const hasNoneTreeLoadingActions = batch.some(
      (action) => !ACTION_TYPES_TREE_LOADING.includes(action.name),
    );
    const isTreeLoadingBatch = batch[0].name === "createTree" && !hasNoneTreeLoadingActions;
    return !isTreeLoadingBatch;
  });
  return actionBatchesWithoutTreeLoadingBatches;
}

describe("Proofreading should generate correct update actions", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "OwnerOnly", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  async function makeProofreadMerge(
    context: WebknossosTestContext,
    treesToLoad: bigint[],
    sourceSegmentId: bigint,
    targetSegmentId: bigint,
    sourceAgglomerateId: bigint,
    voxelPositionsToLoad: Vector3[] = [],
  ): Promise<void> {
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const anchorPosition = getPositionForSegmentId(sourceSegmentId);
      const targetPosition = getPositionForSegmentId(targetSegmentId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(sourceAgglomerateId, { anchorPosition }, tracingId));
      yield put(setActiveCellAction(sourceAgglomerateId));
      yield makeMappingEditableForTest();

      if (treesToLoad.length > 0) {
        yield call(loadAgglomerateTrees, context, treesToLoad, false, false);
      }

      for (const voxelPos of voxelPositionsToLoad) {
        yield call(() => api.data.getDataValue(tracingId, voxelPos, 0));
        // Wait a bit so that the mapping saga can map the segment at voxelPos
        // by asking the backend.
        yield delay(50);
      }

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction(targetPosition, targetSegmentId));
      // Wait till proofreading action is finished; including refreshing agglomerate trees.
      yield take(operationFinished("PROOFREADING"));
    });
    await task.toPromise();
  }

  async function makeProofreadSplit(
    context: WebknossosTestContext,
    treesToLoad: bigint[],
    sourceSegmentId: bigint,
    targetSegmentId: bigint,
    sourceAgglomerateId: bigint,
    minCutEdges: Array<MinCutTargetEdge>,
    voxelPositionsToLoad: Vector3[] = [],
  ): Promise<void> {
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];
    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const anchorPosition = getPositionForSegmentId(sourceSegmentId);
      const targetPosition = getPositionForSegmentId(targetSegmentId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(sourceAgglomerateId, { anchorPosition }, tracingId));
      yield put(setActiveCellAction(sourceAgglomerateId));
      yield makeMappingEditableForTest();

      if (treesToLoad.length > 0) {
        yield call(loadAgglomerateTrees, context, treesToLoad, false, false);
      }

      // Prepare the server's reply for the upcoming split.
      const expectedRequestVersion = 6;
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockImplementation(
        async (
          _tracingStoreUrl: string,
          _tracingId: string,
          version: number,
        ): Promise<Array<MinCutTargetEdge>> => {
          if (version !== expectedRequestVersion) {
            throw new Error(
              `Unexpected version of min cut request. Expected ${expectedRequestVersion} got ${version}`,
            );
          }
          return minCutEdges;
        },
      );

      for (const voxelPos of voxelPositionsToLoad) {
        yield call(() => api.data.getDataValue(tracingId, voxelPos, 0));
        // Wait a bit so that the mapping saga can map the segment at voxelPos
        // by asking the backend.
        yield delay(50);
      }

      // Execute the split and wait for the finished mapping.
      yield put(
        minCutAgglomerateWithPositionAction(targetPosition, targetSegmentId, sourceAgglomerateId),
      );
      // Wait till proofreading action is finished; including refreshing agglomerate trees.
      yield take(operationFinished("PROOFREADING"));
    });
    await task.toPromise();
  }

  it("when loading agglomerate tree 1", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];
    const agglomerateId = 1n;

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(
        updateSegmentAction(
          agglomerateId,
          { anchorPosition: getPositionForSegmentId(agglomerateId) },
          tracingId,
        ),
      );
      yield put(setActiveCellAction(agglomerateId));
      yield makeMappingEditableForTest();

      yield call(loadAgglomerateTrees, context, [agglomerateId], true, false);

      const activateSegmentAndLoadTreeUpdates = removeBlacklistedActions(
        getNestedUpdateActions(context),
        true,
      );

      expect(activateSegmentAndLoadTreeUpdates).toStrictEqual(loadAgglomerateTree1);
    });

    await task.toPromise();
  });

  it("when loading agglomerate trees 1 and 4 and then merging agglomerates 4 and 6.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1n, 4n], 5n, 6n, 4n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));

      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment4And6WithAgglomerateTree1And4);
    });

    await task.toPromise();
  });

  it("when loading agglomerate trees 1 and 4 and then merging segments 3 and 4.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1n, 4n], 3n, 4n, 1n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));

      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And4WithAgglomerateTree1And4);
    });

    await task.toPromise();
  });

  it("when merging segments 1 and 4.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [], 1n, 4n, 1n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment1And4);
    });

    await task.toPromise();
  });

  it("when merging segments 2 and 4.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [], 2n, 4n, 1n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment2And4);
    });

    await task.toPromise();
  });

  it("when loading agglomerate trees 1, 4 and 6 then merging segments 1 and 4.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1n, 4n, 6n], 1n, 4n, 1n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment1And4WithAgglomerateTrees1And4And6);
    });

    await task.toPromise();
  });

  it("when loading agglomerate tree 1 and then merging segments 3 and 4.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1n], 3n, 4n, 1n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And4WithAgglomerateTree1);
    });

    await task.toPromise();
  });

  it("when loading agglomerate trees 1 and 4 and then merging segments 5 and 6.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1n, 4n], 5n, 6n, 4n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment5And6WithAgglomerateTree1And4);
    });

    await task.toPromise();
  });

  it("when merging segments 5 and 6.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [], 5n, 6n, 4n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment5And6);
    });

    await task.toPromise();
  });

  it("when merging segments 1337 and 5.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(
        makeProofreadMerge,
        context,
        [],
        1337n,
        5n,
        1337n,
        // load segment id (1337) at 100, 100, 100 so that the mapping
        // saga will look up the mapped id (1337) for it. Otherwise,
        // the proofread saga would early-out and ask for a retry.
        [getPositionForSegmentId(1337)],
      );
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment1337And5);
    });

    await task.toPromise();
  });

  it("when loading agglomerate tree 1 and then merging segments 5 and 6.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1n], 5n, 6n, 4n);
      // There are no agglomerate tree updates as no loaded tree is affected by the merge
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment5And6WithAgglomerateTree1);
    });

    await task.toPromise();
  });

  it("when loading agglomerate tree 1 and then merging segments 3 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1n], 3n, 6n, 1n);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And6WithAgglomerateTree1);
    });

    await task.toPromise();
  });

  it("when splitting segments 2 and 3.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: getPositionForSegmentId(3),
          position2: getPositionForSegmentId(2),
          segmentId1: 3n,
          segmentId2: 2n,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [], 2n, 3n, 1n, minCutEdges);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment2And3);
    });

    await task.toPromise();
  });

  it("when loading agglomerate tree 1 and then splitting segments 2 and 3.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: getPositionForSegmentId(3),
          position2: getPositionForSegmentId(2),
          segmentId1: 3n,
          segmentId2: 2n,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [1n], 2n, 3n, 1n, minCutEdges);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment2And3WithAgglomerateTree1);
    });

    await task.toPromise();
  });

  it("when loading agglomerate tree 1 and then splitting segments 1 and 2.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: getPositionForSegmentId(1),
          position2: getPositionForSegmentId(2),
          segmentId1: 1n,
          segmentId2: 2n,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [1n], 1n, 2n, 1n, minCutEdges);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2WithAgglomerateTree1);
    });

    await task.toPromise();
  });

  it("when splitting segments 1 and 2.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: getPositionForSegmentId(1),
          position2: getPositionForSegmentId(2),
          segmentId1: 1n,
          segmentId2: 2n,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [], 1n, 2n, 1n, minCutEdges);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));

      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2);
    });

    await task.toPromise();
  });

  it("when loading agglomerate trees 1, 2 and 4 and then splitting segments 2 and 3 with additional initial edges", async (context: WebknossosTestContext) => {
    // There should be the following circle of edges: 1-2-3-1337-1338-1.
    const _backendMock = mockInitialBucketAndAgglomerateData(
      context,
      [
        [1n, 1338n],
        [3n, 1337n],
      ],
      Store.getState(),
    );
    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: getPositionForSegmentId(1),
          position2: getPositionForSegmentId(2),
          segmentId1: 1n,
          segmentId2: 2n,
        } as MinCutTargetEdge,
        {
          position1: getPositionForSegmentId(2),
          position2: getPositionForSegmentId(3),
          segmentId1: 2n,
          segmentId2: 3n,
        } as MinCutTargetEdge,
      ];

      yield call(makeProofreadSplit, context, [1n, 4n, 6n], 2n, 3n, 1n, minCutEdges);

      const splitAndTreeAndSegmentUpdates = removeBlacklistedActions(
        getNestedUpdateActions(context),
      );
      expect(splitAndTreeAndSegmentUpdates).toStrictEqual(
        splitSegment2And3WithAgglomerateTrees1And4And6,
      );
    });

    await task.toPromise();
  });

  it("when loading agglomerate tree 1, 6 and 4 and then splitting segments 1 and 2.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: getPositionForSegmentId(1),
          position2: getPositionForSegmentId(2),
          segmentId1: 1n,
          segmentId2: 2n,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [1n, 6n, 4n], 1n, 2n, 1n, minCutEdges);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2WithAgglomerateTrees1And6And4);
    });

    await task.toPromise();
  });

  it("when loading agglomerate tree 1, 4 and 6 and then splitting segments 1 and 2.", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: getPositionForSegmentId(1),
          position2: getPositionForSegmentId(2),
          segmentId1: 1n,
          segmentId2: 2n,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [1n, 4n, 6n], 1n, 2n, 1n, minCutEdges);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2WithAgglomerateTrees1And4And6);
    });

    await task.toPromise();
  });

  it("when splitting 7 and 1337 and merging 1337 with 5", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(
      context,
      [[1337n, 7n]],
      Store.getState(),
    );

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: getPositionForSegmentId(7),
          position2: getPositionForSegmentId(1337),
          segmentId1: 7n,
          segmentId2: 1337n,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [], 7n, 1337n, 1337n, minCutEdges, [
        getPositionForSegmentId(1337),
      ]);

      yield call(makeProofreadMerge, context, [], 1337n, 5n, 1339n);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment7And1337AndMerge1337And5);
    });

    await task.toPromise();
  });

  it("performMinCutWithNodesProofreading should apply correct update actions after loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Mock backend answer telling saga to split edges 3-2.
    mockEdgesForAgglomerateMinCut(context.mocks, 7);

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadAgglomerateTreesAndSplitUpdateActions = removeBlacklistedActions(
        getNestedUpdateActions(context),
      );
      expect(loadAgglomerateTreesAndSplitUpdateActions).toStrictEqual(
        minCutWithNodes2And3WithAgglomerateTree1,
      );
    });

    await task.toPromise();
  });

  it("performMergeTreesProofreading should apply correct update actions after loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = false;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadTreesAndMergeUpdateActions = removeBlacklistedActions(
        getNestedUpdateActions(context),
        true,
      );
      expect(loadTreesAndMergeUpdateActions).toStrictEqual(mergeAgglomerateTrees1And4);
    });

    await task.toPromise();
  });

  it("performSplitTreesProofreading should apply correct update actions when loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadTreeAndSplitUpdateActions = removeBlacklistedActions(
        getNestedUpdateActions(context),
        true,
      );
      expect(loadTreeAndSplitUpdateActions).toStrictEqual(splitAgglomerateTree1);
    });

    await task.toPromise();
  });
});
