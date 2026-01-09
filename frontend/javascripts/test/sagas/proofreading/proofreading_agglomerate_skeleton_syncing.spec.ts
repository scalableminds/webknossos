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
import { actionChannel } from "typed-redux-saga";
import type { Action } from "viewer/model/actions/actions";
import { loadAgglomerateSkeletonAtPosition } from "viewer/controller/combinations/segmentation_handlers";

describe("Proofreading agglomerate skeleton syncing", () => {
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
      const versionBeforeSkeletonLoading = yield select((state) => state.annotation.version);

      const loadAgglomerateChannel = yield* actionChannel("LOAD_AGGLOMERATE_SKELETON");
      const ensureHasAnnotationMutexChannel = yield* actionChannel("ENSURE_HAS_ANNOTATION_MUTEX");
      const ensureHasNewestVersionChannel = yield* actionChannel("ENSURE_HAS_NEWEST_VERSION");
      const saveNowChannel = yield* actionChannel("SAVE_NOW");

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield call(loadAgglomerateSkeletonAtPosition, [1, 1, 1]);

      // Test whether
      // 1. action to load agglomerate skeleton is dispatched.
      // 2. the annotation mutex is properly fetched and kept.
      // 3. The latest changes including the loading of thee agglomerate skeleton are stored in the backend.
      // Check whether the actions are dispatched via action channels to avoid race condition.
      yield take(loadAgglomerateChannel);
      yield take(ensureHasAnnotationMutexChannel);
      yield take(ensureHasNewestVersionChannel);
      yield take(saveNowChannel);
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
        yield loadAgglomerateSkeletons(context, [1, 4, 6], false, othersMayEdit);

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
        yield loadAgglomerateSkeletons(context, [6], true, othersMayEdit);

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

  // Multi user tests with injected updates
  it("should merge two agglomerates, apply injected merge update action included agglomerate skeleton updates and update the mapping and agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    // Simulate merging agglomerate 4 into agglomerate 1 by joining segments 1 & 4.
    // TODOM: Problem: the code fixing the agglomerate skeletons needs to know the agglomerate id before the own update action.
    // But the proofread saga only knows the state before and after the rebase.
    // Not the needed in between state after applying the backend updates and before applying the frontend updates.
    // But, this cannot be done in the save saga, as only after the mapping updates are stored on the server, the
    // affected agglomerate skeletons can be reloaded to be in the updated version.
    backendMock.planVersionInjection(10, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 4,
          agglomerateId1: 1,
          agglomerateId2: 4,
        },
      },
      {
        name: "moveTreeComponent",
        value: {
          actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
          sourceId: 4,
          targetId: 3,
          nodeIds: [7, 8],
        },
      },
      {
        name: "deleteTree",
        value: {
          actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
          id: 4,
        },
      },
      {
        name: "createEdge",
        value: {
          actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
          treeId: 3,
          source: 4,
          target: 7,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(4, { somePosition: [4, 4, 4] }, tracingId));
      yield put(setActiveCellAction(4));
      yield makeMappingEditableHelper();
      const othersMayEdit = true;
      yield put(setOthersMayEditForAnnotationAction(true));

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, othersMayEdit);

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([6, 6, 6], 6));
      // Wait till while proofreading action is finished including agglomerate skeleton refresh
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

      yield call(() => api.tracing.save());

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(1);
      expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(7);
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
        [6, 6, 6],
        [7, 7, 7],
      ]);

      const agglomerateSkeletonReloadingUpdates = context.receivedDataPerSaveRequest.at(-1)!;
      yield expect(agglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/merge_with_injected_merge_should_refresh_agglomerate_skeletons.json",
      );
    });

    await task.toPromise();
  });

  it("should merge two agglomerates, apply injected split update action included agglomerate skeleton updates and update the mapping and agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    // Inject splitting agglomerate 1 between segments 1 & 2 including agglomerate skeleton update & create segment.
    backendMock.planVersionInjection(10, [
      {
        name: "splitAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 2,
          agglomerateId: 1,
        },
      },

      {
        name: "createTree",
        value: {
          actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
          id: 4,
          updatedId: 4,
          color: [0.6784313725490196, 0.1411764705882353, 0.050980392156862744],
          name: "agglomerate 1339 (volumeTracingId)",
          timestamp: 1494695001688,
          comments: [],
          branchPoints: [],
          groupId: undefined,
          isVisible: true,
          type: "AGGLOMERATE",
          edgesAreVisible: true,
          metadata: [],
        },
      },
      {
        name: "moveTreeComponent",
        value: {
          actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
          sourceId: 3,
          targetId: 4,
          nodeIds: [5, 6],
        },
      },
      {
        name: "deleteEdge",
        value: {
          actionTracingId: "skeletonTracingId-47e37793-d0be-4240-a371-87ce68561a13",
          treeId: 3,
          source: 4,
          target: 5,
        },
      },
      {
        name: "createSegment",
        value: {
          actionTracingId: "volumeTracingId",
          id: 1339,
          anchorPosition: [2, 2, 2],
          name: null,
          color: null,
          groupId: null,
          metadata: [],
          creationTime: 1494695001688,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [4, 4, 4] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();
      const othersMayEdit = true;
      yield put(setOthersMayEditForAnnotationAction(true));

      // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
      yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, othersMayEdit);

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([6, 6, 6], 4));
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
        "./__snapshots__/agglomerate_skeleton_syncing/merge_with_injected_split_should_refresh_agglomerate_skeletons.json",
      );
    });

    await task.toPromise();
  });

  // TODOM same with merge
});
