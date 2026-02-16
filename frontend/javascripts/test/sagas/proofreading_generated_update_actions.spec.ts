import type { MinCutTargetEdge } from "admin/rest_api";
import {
  getNestedUpdateActions,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { call, put, take } from "typed-redux-saga";
import { WkDevFlags } from "viewer/api/wk_dev";
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
  mergeSegment3And4WithAgglomerateTree1,
  mergeSegment3And4WithAgglomerateTree1And4,
  mergeSegment3And6WithAgglomerateTree1,
  mergeSegment4And6WithAgglomerateTree1And4,
  mergeSegment5And6WithAgglomerateTree1,
  mergeSegment5And6WithAgglomerateTree1And4,
  splitSegment1And2WithAgglomerateTree1,
  splitSegment2And3WithAgglomerateTree1,
} from "./proofreading/proofreading_interaction_update_action_fixtures";
import { loadAgglomerateSkeletons } from "./proofreading/proofreading_skeleton_test_utils";
import {
  initializeMappingAndTool,
  makeMappingEditableHelper,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading/proofreading_test_utils";

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

  async function makeProofreadMerge(
    context: WebknossosTestContext,
    skeletonsToLoad: number[],
    sourceSegmentId: number,
    targetSegmentId: number,
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
          sourceSegmentId,
          { somePosition: [sourceSegmentId, sourceSegmentId, sourceSegmentId] },
          tracingId,
        ),
      );
      yield put(setActiveCellAction(sourceSegmentId));
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
      // Wait till while proofreading action is finished including agglomerate skeleton refresh
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
          sourceSegmentId,
          { somePosition: [sourceSegmentId, sourceSegmentId, sourceSegmentId] },
          tracingId,
        ),
      );
      yield put(setActiveCellAction(sourceSegmentId));
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
      // Wait till while proofreading action is finished including agglomerate skeleton refresh
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished
    });
    await task.toPromise();
  }

  it("when loading agglomerate trees 1 and 4 and then merging agglomerates 4 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield* call(makeProofreadMerge, context, [1, 4], 5, 6, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-2)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment4And6WithAgglomerateTree1And4);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate trees 1 and 4 and then merging segments 3 and 4.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield* call(makeProofreadMerge, context, [1, 4], 3, 4, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-2)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And4WithAgglomerateTree1And4);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1 and then merging segments 3 and 4.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield* call(makeProofreadMerge, context, [1], 3, 4, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-2)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And4WithAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate trees 1 and 4 and then merging segments 5 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield* call(makeProofreadMerge, context, [1, 4], 5, 6, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-2)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment5And6WithAgglomerateTree1And4);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1 and then merging segments 5 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield* call(makeProofreadMerge, context, [1], 5, 6, false);
      // There are no agglomerate tree updates as no loaded tree is affected by the merge
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-1)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment5And6WithAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);

  it("when loading agglomerate tree 1 and then merging segments 3 and 6.", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task() {
      yield* call(makeProofreadMerge, context, [1], 3, 6, false);
      const mergeAndTreeUpdates = getNestedUpdateActions(context).slice(-2)!;
      expect(mergeAndTreeUpdates).toStrictEqual(mergeSegment3And6WithAgglomerateTree1);
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
      yield* call(makeProofreadSplit, context, [1], 2, 3, 1, minCutEdges, false);
      const splitAndTreeUpdates = getNestedUpdateActions(context).slice(-2)!;
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
      yield* call(makeProofreadSplit, context, [1], 1, 2, 1, minCutEdges, false);
      const splitAndTreeUpdates = getNestedUpdateActions(context).slice(-2)!;
      expect(splitAndTreeUpdates).toStrictEqual(splitSegment1And2WithAgglomerateTree1);
    });

    await task.toPromise();
  }, 8000);
});
