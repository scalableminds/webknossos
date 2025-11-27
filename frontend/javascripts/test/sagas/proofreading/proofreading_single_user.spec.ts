import { call, put, take } from "redux-saga/effects";
import { type WebknossosTestContext, setupWebknossosForTesting } from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect-generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectedMappingAfterMerge,
  expectedMappingAfterSplit,
  initialMapping,
} from "./proofreading_fixtures";
import {
  initializeMappingAndTool,
  makeMappingEditableHelper,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import { loadAgglomerateSkeletons } from "./proofreading_skeleton_test_utils";
import { TreeTypeEnum } from "viewer/constants";
import { getTreesWithType } from "viewer/model/accessors/skeletontracing_accessor";

describe("Proofreading (Single User)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should merge two agglomerates and update the mapping accordingly", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([4, 4, 4], 1));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId1: 1,
            agglomerateId2: 4,
            segmentId1: 1,
            segmentId2: 4,
          },
        },
      ]);
    });

    await task.toPromise();
  }, 8000);

  it("should split two agglomerates and update the mapping accordingly", async (context: WebknossosTestContext) => {
    const { api, mocks } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      // Prepare the server's reply for the upcoming split.
      vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: [1, 1, 1],
            position2: [2, 2, 2],
            segmentId1: 1,
            segmentId2: 2,
          },
        ]),
      );

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 1));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterSplit);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 1,
            segmentId1: 1,
            segmentId2: 2,
          },
        },
      ]);
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerates and update the mapping and agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, false);

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([4, 4, 4], 1));
      // Wait till while proofreading action is finished including agglomerate skeleton refresh
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

      yield call(() => api.tracing.save());

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(2);
      expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(5);
      const allNodes = Array.from(updatedAgglomerateTrees.getOrThrow(3).nodes.values());
      const allPositionsSorted = allNodes
        .map((n) => n.untransformedPosition)
        .sort((a, b) => a[0] - b[0]);
      expect(allPositionsSorted).toStrictEqual([
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
        [4, 4, 4],
        [5, 5, 5],
      ]);

      const agglomerateSkletonReloadingUpdates = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(agglomerateSkletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/proofreading_single_user.spec.ts/merge_should_refresh_agglomerate_skeletons.json",
      );
    });

    await task.toPromise();
  });

  it("should merge two agglomerates and update not update agglomerate skeleton if not included in update actions.", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield* loadAgglomerateSkeletons(context, [6], true, false);

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([4, 4, 4], 1));
      // Wait till while proofreading action is finished including agglomerate skeleton refresh
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

      yield call(() => api.tracing.save());

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(1);
      expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(2);
      const allNodes = Array.from(updatedAgglomerateTrees.getOrThrow(3).nodes.values());
      const allPositionsSorted = allNodes
        .map((n) => n.untransformedPosition)
        .sort((a, b) => a[0] - b[0]);
      expect(allPositionsSorted).toStrictEqual([
        [6, 6, 6],
        [7, 7, 7],
      ]);

      const agglomerateSkeletonUpdateActions = context.receivedDataPerSaveRequest
        .at(-1)!
        .filter((batch) =>
          batch.actions.some((action) =>
            ["deleteTree", "updateActiveNode", "createTree", "createNode", "createEdge"].includes(
              action.name,
            ),
          ),
        );
      expect(agglomerateSkeletonUpdateActions.length).toBe(0);
    });

    await task.toPromise();
  });

  it("should split an agglomerate and update the mapping and agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield* loadAgglomerateSkeletons(context, [1], false, false);

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: [1, 1, 1],
            position2: [2, 2, 2],
            segmentId1: 1,
            segmentId2: 2,
          },
        ]),
      );

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 1));
      // Wait till while proofreading action is finished including agglomerate skeleton refresh
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

      yield call(() => api.tracing.save());

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(3);
      expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(1); // TODO fix-> Id is not present
      expect(updatedAgglomerateTrees.getOrThrow(4).nodes.size()).toBe(2);
      expect(updatedAgglomerateTrees.getOrThrow(5).nodes.size()).toBe(2);

      const agglomerateSkletonReloadingUpdates = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(agglomerateSkletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/proofreading_single_user.spec.ts/split_should_refresh_agglomerate_skeletons.json",
      );
    });

    await task.toPromise();
  });

  it("should split an agglomerate and not update an unaffected agglomerate skeleton", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield* loadAgglomerateSkeletons(context, [4], false, false);

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: [1, 1, 1],
            position2: [2, 2, 2],
            segmentId1: 1,
            segmentId2: 2,
          },
        ]),
      );

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 1));
      // Wait till while proofreading action is finished including agglomerate skeleton refresh
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

      yield call(() => api.tracing.save());

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(1);
      expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(2);
      const allNodes = Array.from(updatedAgglomerateTrees.getOrThrow(3).nodes.values());
      const allPositionsSorted = allNodes
        .map((n) => n.untransformedPosition)
        .sort((a, b) => a[0] - b[0]);
      expect(allPositionsSorted).toStrictEqual([
        [4, 4, 4],
        [5, 5, 5],
      ]);

      const agglomerateSkletonReloadingUpdates = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(agglomerateSkletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/proofreading_single_user.spec.ts/split_should_not_refresh_unaffected_agglomerate_skeletons.json",
      );
    });

    await task.toPromise();
  });
});
