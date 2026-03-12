import type { MinCutTargetEdge } from "admin/rest_api";
import {
  getNestedUpdateActions,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { call, put, take } from "typed-redux-saga";
import { WkDevFlags } from "viewer/api/wk_dev";
import { loadAgglomerateSkeletonAtPosition } from "viewer/controller/combinations/segmentation_handlers";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAgglomerateTree1,
  mergeAgglomerateTrees1And4,
  mergeSegment1And4,
  mergeSegment1And4WithAgglomerateTrees1And4And6,
  mergeSegment3And4WithAgglomerateTree1,
  mergeSegment3And4WithAgglomerateTree1And4,
  mergeSegment3And6WithAgglomerateTree1,
  mergeSegment4And6WithAgglomerateTree1And4,
  mergeSegment5And6,
  mergeSegment5And6WithAgglomerateTree1,
  mergeSegment5And6WithAgglomerateTree1And4,
  minCutWithNodes2And3WithAgglomerateTree1,
  splitAgglomerateTree1,
  splitSegment1And2,
  splitSegment1And2WithAgglomerateTree1,
  splitSegment1And2WithAgglomerateTrees1And4And6,
  splitSegment1And2WithAgglomerateTrees1And6And4,
  splitSegment2And3,
  splitSegment2And3WithAgglomerateTree1,
  splitSegment2And3WithAgglomerateTrees1And4And6,
} from "./proofreading_interaction_update_action_fixtures";
import {
  loadAgglomerateSkeletons,
  mockEdgesForAgglomerateMinCut,
  performMergeTreesProofreading,
  performMinCutWithNodesProofreading,
  performSplitTreesProofreading,
} from "./proofreading_skeleton_test_utils";
import {
  initializeMappingAndTool,
  makeMappingEditableHelper,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import { UpdateAction } from "viewer/model/sagas/volume/update_actions";

const ACTION_TYPES_BLACKLIST = ["updateCamera", "updateMappingName", "updateActiveSegmentId"];

function removeBlacklistedActions(actionBatches: UpdateAction[][]) {
  return actionBatches
    .map((actions) => actions.filter((action) => !ACTION_TYPES_BLACKLIST.includes(action.name)))
    .filter((arr) => arr.length > 0);
}

describe("Proofreading should generate correct update actions", () => {
  const initialLiveCollab = WkDevFlags.liveCollab;
  beforeEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollab = true;
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollab = initialLiveCollab;
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  async function loadAgglomerateSkeleton(context: WebknossosTestContext, agglomerateId: number) {
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(
        updateSegmentAction(
          agglomerateId,
          { anchorPosition: [agglomerateId, agglomerateId, agglomerateId] },
          tracingId,
        ),
      );
      yield put(setActiveCellAction(agglomerateId));
      yield makeMappingEditableHelper();
      yield put(setOthersMayEditForAnnotationAction(true));

      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield call(loadAgglomerateSkeletonAtPosition, [agglomerateId, agglomerateId, agglomerateId]);
    });

    await task.toPromise();
  }

  async function makeProofreadMerge(
    context: WebknossosTestContext,
    skeletonsToLoad: number[],
    sourceSegmentId: number,
    targetSegmentId: number,
    sourceAgglomerateId: number,
    othersMayEdit: boolean,
  ): Promise<void> {
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(
        updateSegmentAction(
          sourceAgglomerateId,
          { anchorPosition: [sourceSegmentId, sourceSegmentId, sourceSegmentId] },
          tracingId,
        ),
      );
      yield put(setActiveCellAction(sourceAgglomerateId));
      yield makeMappingEditableHelper();
      if (othersMayEdit) {
        yield put(setOthersMayEditForAnnotationAction(true));
      }

      if (skeletonsToLoad.length > 0) {
        yield loadAgglomerateSkeletons(context, skeletonsToLoad, false, othersMayEdit);
      }

      const skeletonTrees = Store.getState().annotation.skeleton?.trees;
      console.log(skeletonTrees);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction([targetSegmentId, targetSegmentId, targetSegmentId], targetSegmentId),
      );
      // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished
    });
    await task.toPromise();
  }

  async function makeProofreadSplit(
    context: WebknossosTestContext,
    skeletonsToLoad: number[],
    sourceSegmentId: number,
    targetSegmentId: number,
    sourceAgglomerateId: number,
    minCutEdges: Array<MinCutTargetEdge>,
    othersMayEdit: boolean,
  ): Promise<void> {
    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];
    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(
        updateSegmentAction(
          sourceAgglomerateId,
          { anchorPosition: [sourceSegmentId, sourceSegmentId, sourceSegmentId] },
          tracingId,
        ),
      );
      yield put(setActiveCellAction(sourceAgglomerateId));
      yield makeMappingEditableHelper();
      if (othersMayEdit) {
        yield put(setOthersMayEditForAnnotationAction(true));
      }

      if (skeletonsToLoad.length > 0) {
        yield loadAgglomerateSkeletons(context, skeletonsToLoad, false, othersMayEdit);
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

      // Execute the split and wait for the finished mapping.
      yield put(
        minCutAgglomerateWithPositionAction(
          [targetSegmentId, targetSegmentId, targetSegmentId],
          targetSegmentId,
          sourceAgglomerateId,
        ),
      );
      // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished
    });
    await task.toPromise();
  }

  it("when loading agglomerate skeleton 1", async (context: WebknossosTestContext) => {
    const agglomerateId = 1;
    const task = startSaga(function* task() {
      yield call(loadAgglomerateSkeleton, context, agglomerateId);
      yield call(() => context.api.tracing.save());
      const loadTreeUpdates = getNestedUpdateActions(context).at(-1);
      expect([loadTreeUpdates]).toStrictEqual(loadAgglomerateTree1);
    });

    await task.toPromise();
  });

  it("when loading agglomerate trees 1 and 4 and then merging agglomerates 4 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1, 4], 5, 6, 4, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-4)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment4And6WithAgglomerateTree1And4);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate trees 1 and 4 and then merging segments 3 and 4.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1, 4], 3, 4, 1, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-4)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And4WithAgglomerateTree1And4);
    });

    await task.toPromise();
  }, 8000);

  it("when merging segments 1 and 4.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [], 1, 4, 1, false);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment1And4);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate trees 1, 4 and 6 then merging segments 1 and 4.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1, 4, 6], 1, 4, 1, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-3)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment1And4WithAgglomerateTrees1And4And6);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1 and then merging segments 3 and 4.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1], 3, 4, 1, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-4)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And4WithAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate trees 1 and 4 and then merging segments 5 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1, 4], 5, 6, 4, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-4)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment5And6WithAgglomerateTree1And4);
    });

    await task.toPromise();
  }, 8000);

  it("when merging segments 5 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [], 5, 6, 4, false);
      const mergeAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      console.log("mergeAndTreeUpdates", mergeAndTreeUpdates);
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment5And6);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1 and then merging segments 5 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1], 5, 6, 4, false);
      // There are no agglomerate tree updates as no loaded tree is affected by the merge
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-3)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment5And6WithAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1 and then merging segments 3 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield call(makeProofreadMerge, context, [1], 3, 6, 1, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-3)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And6WithAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);

  it("when splitting segments 2 and 3.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: [3, 3, 3],
          position2: [2, 2, 2],
          segmentId1: 3,
          segmentId2: 2,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [], 2, 3, 1, minCutEdges, false);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment2And3);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1 and then splitting segments 2 and 3.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: [3, 3, 3],
          position2: [2, 2, 2],
          segmentId1: 3,
          segmentId2: 2,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [1], 2, 3, 1, minCutEdges, false);
      const splitAndTreeUpdates = getNestedUpdateActions(context).slice(-4)!;
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment2And3WithAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1 and then splitting segments 1 and 2.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: [1, 1, 1],
          position2: [2, 2, 2],
          segmentId1: 1,
          segmentId2: 2,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [1], 1, 2, 1, minCutEdges, false);
      const splitAndTreeUpdates = getNestedUpdateActions(context).slice(-3)!;
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2WithAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);

  it("when splitting segments 1 and 2.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: [1, 1, 1],
          position2: [2, 2, 2],
          segmentId1: 1,
          segmentId2: 2,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [], 1, 2, 1, minCutEdges, false);
      const splitAndTreeUpdates = removeBlacklistedActions(getNestedUpdateActions(context));

      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate trees 1, 2 and 4 and then splitting segments 2 and 3 with additional initial edges", async (context: WebknossosTestContext) => {
    // There should be the following circle of edges: 1-2-3-1337-1338-1.
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [
      [1, 1338],
      [3, 1337],
    ]);
    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: [1, 1, 1],
          position2: [2, 2, 2],
          segmentId1: 1,
          segmentId2: 2,
        } as MinCutTargetEdge,
        {
          position1: [2, 2, 2],
          position2: [3, 3, 3],
          segmentId1: 2,
          segmentId2: 3,
        } as MinCutTargetEdge,
      ];

      yield call(makeProofreadSplit, context, [1, 4, 6], 2, 3, 1, minCutEdges, false);
      const splitAndTreeAndSegmentUpdates = getNestedUpdateActions(context).slice(-4)!;
      expect(splitAndTreeAndSegmentUpdates).toStrictEqual(
        splitSegment2And3WithAgglomerateTrees1And4And6,
      );
    });

    await task.toPromise();
  });

  it("when loading agglomerate tree 1, 6 and 4 and then splitting segments 1 and 2.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: [1, 1, 1],
          position2: [2, 2, 2],
          segmentId1: 1,
          segmentId2: 2,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [1, 6, 4], 1, 2, 1, minCutEdges, false);
      const splitAndTreeUpdates = getNestedUpdateActions(context).slice(-3)!;
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2WithAgglomerateTrees1And6And4);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1, 4 and 6 and then splitting segments 1 and 2.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      const minCutEdges = [
        {
          position1: [1, 1, 1],
          position2: [2, 2, 2],
          segmentId1: 1,
          segmentId2: 2,
        } as MinCutTargetEdge,
      ];
      yield call(makeProofreadSplit, context, [1, 4, 6], 1, 2, 1, minCutEdges, false);
      const splitAndTreeUpdates = getNestedUpdateActions(context).slice(-3)!;
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2WithAgglomerateTrees1And4And6);
    });

    await task.toPromise();
  }, 8000);

  it("performMinCutWithNodesProofreading should apply correct update actions after loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Mock backend answer telling saga to split edges 3-2.
    mockEdgesForAgglomerateMinCut(context.mocks, 7);

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadAgglomerateTreesAndSplitUpdateActions = getNestedUpdateActions(context).slice(-6);
      expect(loadAgglomerateTreesAndSplitUpdateActions).toStrictEqual(
        minCutWithNodes2And3WithAgglomerateTree1,
      );
    });

    await task.toPromise();
  }, 8000);

  it("performMergeTreesProofreading should apply correct update actions after loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = false;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadTreesAndMergeUpdateActions = getNestedUpdateActions(context).slice(-6)!;
      expect(loadTreesAndMergeUpdateActions).toStrictEqual(mergeAgglomerateTrees1And4);
    });

    await task.toPromise();
  }, 8000);

  it("performSplitTreesProofreading should apply correct update actions when loading agglomerate trees", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, false);
      // This includes the create agglomerate tree & merge agglomerate tree update actions.
      const loadTreeAndSplitUpdateActions = getNestedUpdateActions(context).slice(5);
      expect(loadTreeAndSplitUpdateActions).toStrictEqual(splitAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);
});
