import { type ActionPattern, call, put, take } from "redux-saga/effects";
import { type WebknossosTestContext, setupWebknossosForTesting } from "test/helpers/apiHelpers";
import {
  cutAgglomerateFromNeighborsAction,
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
import { startSaga, type WebknossosState } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeMappingAndTool,
  loadAgglomerateMeshes,
  makeMappingEditableHelper,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import { loadAgglomerateSkeletons } from "./proofreading_skeleton_test_utils";
import { TreeTypeEnum } from "viewer/constants";
import { getTreesWithType } from "viewer/model/accessors/skeletontracing_accessor";
import { WkDevFlags } from "viewer/api/wk_dev";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { fork } from "typed-redux-saga";
import type { Action } from "viewer/model/actions/actions";

describe("Proofreading (Single User)", () => {
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

  it("should load agglomerate skeletons while having the annotation mutex and immediately store the loaded skeleton in the backend", async (context: WebknossosTestContext) => {
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
      yield put(setOthersMayEditForAnnotationAction(true));

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      const versionBeforeSkeletonLoading = yield select((state) => state.annotation.version);
      yield* fork(loadAgglomerateSkeletons, context, [1], false, true);
      // Test whether
      // 1. action to load agglomerate skeleton is dispatched.
      // 2. the annotation mutex is properly fetched and kept.
      // 3. The latest changes including the loading of thee agglomerate skeleton are stored in the backend.
      yield take(
        ((action: Action) =>
          action.type === "LOAD_AGGLOMERATE_SKELETON" &&
          action.agglomerateId === 1) as ActionPattern,
      );
      yield take("ENSURE_HAS_ANNOTATION_MUTEX");
      yield take(
        ((action: Action) =>
          action.type === "SET_IS_MUTEX_ACQUIRED" && action.isMutexAcquired) as ActionPattern,
      );
      yield take("ENSURE_HAS_NEWEST_VERSION");
      yield take("SAVE_NOW");
      yield take(
        ((action: Action) =>
          action.type === "SET_IS_MUTEX_ACQUIRED" && !action.isMutexAcquired) as ActionPattern,
      );
      const versionAfterSkeletonLoading = yield select((state) => state.annotation.version);
      // Check that the local version was bumped.
      expect(versionAfterSkeletonLoading - versionBeforeSkeletonLoading).toBeGreaterThan(0);
      const agglomerateSkeletonUpdates = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(agglomerateSkeletonUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/should_auto_push_skeleton_updates_in_live_collab.json",
      );
      //
    });

    await task.toPromise();
  });

  describe.each([false, true])("With othersMayEdit=%s", (othersMayEdit: boolean) => {
    // Single user tests ------------------------------------------

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
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
        vi.mocked(context.mocks.parseProtoTracing).mockRestore();
        yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, othersMayEdit);

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

        const agglomerateSkeletonReloadingUpdates = context.receivedDataPerSaveRequest.at(-1)!;
        yield expect(agglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_skeleton_syncing/merge_should_refresh_agglomerate_skeletons_with_others_may_edit-${othersMayEdit}.json`,
        );
      });

      await task.toPromise();
    });

    it("should merge two agglomerates and not update agglomerate skeleton if not included in update actions.", async (context: WebknossosTestContext) => {
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
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
        vi.mocked(context.mocks.parseProtoTracing).mockRestore();
        yield* loadAgglomerateSkeletons(context, [6], true, othersMayEdit);

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
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
        vi.mocked(context.mocks.parseProtoTracing).mockRestore();
        yield* loadAgglomerateSkeletons(context, [1], false, othersMayEdit);

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
        expect(updatedAgglomerateTrees.size()).toBe(2);
        expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(1);
        expect(updatedAgglomerateTrees.getOrThrow(4).nodes.size()).toBe(2);

        const addAgglomerateSkeletonAndSplitUpdate = context.receivedDataPerSaveRequest.at(2)!;
        const agglomerateSkeletonReloadingUpdates = context.receivedDataPerSaveRequest.at(3)!;
        yield expect([
          addAgglomerateSkeletonAndSplitUpdate,
          agglomerateSkeletonReloadingUpdates,
        ]).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_skeleton_syncing/split_should_refresh_agglomerate_skeletons_with_others_may_edit-${othersMayEdit}.json`,
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
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
        vi.mocked(context.mocks.parseProtoTracing).mockRestore();
        yield* loadAgglomerateSkeletons(context, [4], false, othersMayEdit);

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

        const agglomerateSkeletonReloadingUpdates = context.receivedDataPerSaveRequest.at(-1)!;
        yield expect(agglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_skeleton_syncing/split_should_not_refresh_unaffected_agglomerate_skeletons_with_others_may_edit-${othersMayEdit}.json`,
        );
      });

      await task.toPromise();
    });

    it("should auto update agglomerate skeletons after merge via mesh interaction", async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context);

      const task = startSaga(function* () {
        const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Load relevant meshes.
        yield makeMappingEditableHelper();
        yield loadAgglomerateMeshes([1, 6]);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
        vi.mocked(context.mocks.parseProtoTracing).mockRestore();
        yield* loadAgglomerateSkeletons(context, [1, 6], false, othersMayEdit);

        yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1, undefined, null, 1));

        // Execute the actual merge via meshes merging segment 1 with segment 6.
        yield put(
          proofreadMergeAction(
            null, // mesh actions do not have a usable source position.
            6,
            6,
          ),
        );
        yield take(
          ((action: Action) =>
            action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
            !action.value.isBusy) as ActionPattern,
        );

        const agglomerateSkeletons = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );
        expect(agglomerateSkeletons.size()).toBe(1);
        const agglomerateSkeletonOne = agglomerateSkeletons.getOrThrow(3);
        yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_merging.json",
        );
      });
      await task.toPromise();
    });

    it("should auto update agglomerate skeletons after split via mesh interaction", async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context);

      const task = startSaga(function* () {
        const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Load relevant meshes.
        yield makeMappingEditableHelper();
        yield loadAgglomerateMeshes([1, 6]);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
        vi.mocked(context.mocks.parseProtoTracing).mockRestore();
        yield* loadAgglomerateSkeletons(context, [1, 6], false, othersMayEdit);
        const agglomerateSkeletonsBefore = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );

        yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1, undefined, null, 1));

        // Execute the actual split between segments 1 with segment 2.

        /// TODOM: split needs to support agglomerate skeleton auto refreshing!!!!
        yield put(
          minCutAgglomerateWithPositionAction(
            null, // mesh actions do not have a usable source position.
            2,
            1,
          ),
        );
        yield take(
          ((action: Action) =>
            action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
            !action.value.isBusy) as ActionPattern,
        );

        const agglomerateSkeletons = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );
        expect(agglomerateSkeletons.size()).toBe(3);
        const agglomerateSkeletonOne = agglomerateSkeletons.getOrThrow(3);
        const agglomerateSkeletonTwo = agglomerateSkeletons.getOrThrow(4);
        yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_merging.json",
        );
      });
      await task.toPromise();
    });

    it("should auto update agglomerate skeletons after splitting from all neighbors", async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context);

      const task = startSaga(function* () {
        const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Load relevant meshes.
        yield makeMappingEditableHelper();
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
        vi.mocked(context.mocks.parseProtoTracing).mockRestore();
        yield* loadAgglomerateSkeletons(context, [1, 6], false, othersMayEdit);
        const agglomerateSkeletonsBefore = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );

        yield put(updateSegmentAction(2, { somePosition: [2, 2, 2] }, tracingId));
        yield put(setActiveCellAction(2));

        // Execute the actual merge and wait for the finished mapping.
        // TODOM: split from all neighbors should support auto skeleton reloading.
        yield put(
          cutAgglomerateFromNeighborsAction(
            [2, 2, 2], // unmappedId=2 / mappedId=2 at this position
          ),
        );
        yield take(
          ((action: Action) =>
            action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
            !action.value.isBusy) as ActionPattern,
        );

        const agglomerateSkeletons = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );
        expect(agglomerateSkeletons.size()).toBe(3);
        const agglomerateSkeletonOne = agglomerateSkeletons.getOrThrow(3);
        const agglomerateSkeletonTwo = agglomerateSkeletons.getOrThrow(4);
        yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_merging.json",
        );
      });
      await task.toPromise();
    });
  });

  // Multi user tests ---------------------------------------------------------------
});
