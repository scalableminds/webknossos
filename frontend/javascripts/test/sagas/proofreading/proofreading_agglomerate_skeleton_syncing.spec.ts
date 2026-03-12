import { type ActionPattern, call, put, take } from "redux-saga/effects";
import {
  getNestedUpdateActions,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { actionChannel } from "typed-redux-saga";
import { WkDevFlags } from "viewer/api/wk_dev";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import { loadAgglomerateSkeletonAtPosition } from "viewer/controller/combinations/segmentation_handlers";
import { getTreesWithType } from "viewer/model/accessors/skeletontracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import {
  cutAgglomerateFromNeighborsAction,
  minCutAgglomerateWithPositionAction,
  minCutPartitionsAction,
  proofreadMergeAction,
  toggleSegmentInPartitionAction,
} from "viewer/model/actions/proofread_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { type Saga, select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { getMutexLogicState } from "viewer/model/sagas/saving/save_mutex_saga";
import { Store } from "viewer/singletons";
import { startSaga, type WebknossosState } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAgglomerateTree1,
  mergeSegment1And4WithAgglomerateTrees1And4And6,
  splitSegment1And2WithAgglomerateTrees1And4And6,
  splitSegment1And2WithAgglomerateTrees1And6And4,
  splitSegment2And3WithAgglomerateTrees1And4And6,
} from "./proofreading_interaction_update_action_fixtures";
import { loadAgglomerateSkeletons } from "./proofreading_skeleton_test_utils";
import {
  initializeMappingAndTool,
  loadAgglomerateMeshes,
  makeMappingEditableHelper,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";

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
      yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();
      yield put(setOthersMayEditForAnnotationAction(true));

      const versionBeforeSkeletonLoading = yield* select((state) => state.annotation.version);

      const loadAgglomerateChannel = yield* actionChannel("LOAD_AGGLOMERATE_SKELETON");
      const ensureHasNewestVersionChannel = yield* actionChannel("ENSURE_HAS_NEWEST_VERSION");
      const saveNowChannel = yield* actionChannel("SAVE_NOW");

      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield call(loadAgglomerateSkeletonAtPosition, [1, 1, 1]);

      // Test whether
      // 1. action to load agglomerate skeleton is dispatched.
      // 2. the annotation mutex is properly fetched and kept.
      // 3. The latest changes including the loading of thee agglomerate skeleton are stored in the backend.
      // Check whether the actions are dispatched via action channels to avoid race condition.
      yield take(loadAgglomerateChannel);
      const annotationMutexLogicState = getMutexLogicState();
      const amountOfMutexSubscribers = Object.keys(
        annotationMutexLogicState.subscribersToMutex,
      ).length;
      expect(amountOfMutexSubscribers).toBe(1);
      yield take(ensureHasNewestVersionChannel);
      yield take(saveNowChannel);
      yield take(
        ((action: Action) =>
          action.type === "SET_IS_MUTEX_ACQUIRED" && !action.isMutexAcquired) as ActionPattern,
      );
      const versionAfterSkeletonLoading = yield* select((state) => state.annotation.version);
      // Check that the local version was bumped.
      expect(versionAfterSkeletonLoading - versionBeforeSkeletonLoading).toBeGreaterThan(0);
      const agglomerateSkeletonUpdates = getNestedUpdateActions(context).at(-1)!;
      yield expect(agglomerateSkeletonUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/should_auto_push_skeleton_updates_in_live_collab.json",
      );
    });

    await task.toPromise();
  });

  describe.each([false, true])("With othersMayEdit=%s", (othersMayEdit: boolean) => {
    it("should merge two agglomerates and update the agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context);

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* () {
        yield call(initializeMappingAndTool, context, tracingId);

        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1));
        yield makeMappingEditableHelper();
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        yield loadAgglomerateSkeletons(context, [1, 4, 6], false, othersMayEdit);

        // Execute the actual merge and wait for the finished mapping.
        yield put(proofreadMergeAction([4, 4, 4], 4));
        // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
        yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
        yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

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

        const agglomerateSkeletonReloadingUpdates = getNestedUpdateActions(context).slice(-3)!;
        yield expect(agglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_skeleton_syncing/merge_should_refresh_agglomerate_skeletons_with_others_may_edit-${othersMayEdit}.json`,
        );
      });

      await task.toPromise();
    });

    it("should merge two agglomerates and not update agglomerate skeleton if not included in update actions.", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context);

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* () {
        yield call(initializeMappingAndTool, context, tracingId);

        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1));
        yield makeMappingEditableHelper();
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        yield loadAgglomerateSkeletons(context, [6], true, othersMayEdit);

        // Execute the actual merge and wait for the finished mapping.
        yield put(proofreadMergeAction([4, 4, 4], 1));
        // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
        yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
        yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

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

    it("should split an agglomerate and update the agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context);

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* () {
        yield call(initializeMappingAndTool, context, tracingId);

        // Set up the split-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1));
        yield makeMappingEditableHelper();
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

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
        // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
        yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
        yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

        const updatedAgglomerateTrees = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );
        expect(updatedAgglomerateTrees.size()).toBe(2);
        expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(1);
        expect(updatedAgglomerateTrees.getOrThrow(4).nodes.size()).toBe(2);

        const splittingAndAgglomerateReloadingUpdates = getNestedUpdateActions(context).slice(-3);
        yield expect(splittingAndAgglomerateReloadingUpdates).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_skeleton_syncing/split_should_refresh_agglomerate_skeletons_with_others_may_edit-${othersMayEdit}.json`,
        );
      });

      await task.toPromise();
    });

    it("should split an agglomerate and not update an unaffected agglomerate skeleton", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context);

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* () {
        yield call(initializeMappingAndTool, context, tracingId);

        // Set up the split-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1));
        yield makeMappingEditableHelper();
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

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
        // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
        yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
        yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

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

        const splitAndCreateSegmentActions = getNestedUpdateActions(context).slice(-2)!;
        yield expect(splitAndCreateSegmentActions).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_skeleton_syncing/split_should_not_refresh_unaffected_agglomerate_skeletons_with_others_may_edit-${othersMayEdit}.json`,
        );
      });

      await task.toPromise();
    });

    it("should auto update agglomerate skeletons after merge via mesh interaction", async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context);

      const task = startSaga(function* () {
        const { tracingId } = yield* select(
          (state: WebknossosState) => state.annotation.volumes[0],
        );
        yield call(initializeMappingAndTool, context, tracingId);

        // Load relevant meshes.
        yield makeMappingEditableHelper();
        yield loadAgglomerateMeshes([1, 6]);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        yield* loadAgglomerateSkeletons(context, [1, 6], false, othersMayEdit);
        yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
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
        const { tracingId } = yield* select(
          (state: WebknossosState) => state.annotation.volumes[0],
        );
        yield call(initializeMappingAndTool, context, tracingId);

        // Load relevant meshes.
        yield makeMappingEditableHelper();
        yield loadAgglomerateMeshes([1, 6]);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        yield* loadAgglomerateSkeletons(context, [1, 6], false, othersMayEdit);
        yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1, undefined, null, 1));

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

        // Execute the actual split between segments 1 with segment 2.
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
        const agglomerateSkeletonSix = agglomerateSkeletons.getOrThrow(4);
        const agglomerateSkeleton1339 = agglomerateSkeletons.getOrThrow(5);
        yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_splitting.json",
        );
        yield expect(agglomerateSkeletonSix).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_6_after_splitting.json",
        );
        yield expect(agglomerateSkeleton1339).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1339_after_splitting.json",
        );
      });
      await task.toPromise();
    });

    it("should auto update agglomerate skeletons after splitting from all neighbors", async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context);

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getNeighborsForAgglomerateNode).mockReturnValue(
        Promise.resolve({
          segmentId: 2,
          neighbors: [
            {
              segmentId: 1,
              position: [1, 1, 1] as Vector3,
            },
            {
              segmentId: 3,
              position: [3, 3, 3] as Vector3,
            },
          ],
        }),
      );

      const task = startSaga(function* () {
        const { tracingId } = yield* select(
          (state: WebknossosState) => state.annotation.volumes[0],
        );
        yield call(initializeMappingAndTool, context, tracingId);

        // Load relevant meshes.
        yield makeMappingEditableHelper();
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        yield* loadAgglomerateSkeletons(context, [1, 6], false, othersMayEdit);
        yield put(updateSegmentAction(1, { anchorPosition: [2, 2, 2] }, tracingId));
        yield put(setActiveCellAction(1));

        // Execute the actual merge and wait for the finished mapping.
        yield put(
          cutAgglomerateFromNeighborsAction(
            [2, 2, 2], // unmappedId=2 / mappedId=1 at this position
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
        expect(agglomerateSkeletons.size()).toBe(4);
        const agglomerateSkeletonOne = agglomerateSkeletons.getOrThrow(3);
        const agglomerateSkeletonSix = agglomerateSkeletons.getOrThrow(4);
        const agglomerateSkeleton1339 = agglomerateSkeletons.getOrThrow(5);
        const agglomerateSkeleton1340 = agglomerateSkeletons.getOrThrow(6);
        yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_splitting_from_all_neighbors.json",
        );
        yield expect(agglomerateSkeletonSix).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_6_after_splitting_from_all_neighbors.json",
        );
        yield expect(agglomerateSkeleton1339).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1339_after_splitting_from_all_neighbors.json",
        );
        yield expect(agglomerateSkeleton1340).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1340_after_splitting_from_all_neighbors.json",
        );
      });
      await task.toPromise();
    });
  });

  // --------- Multi user tests with injected updates ---------

  it("should merge two agglomerates, apply injected merge update action including agglomerate skeleton updates and update the agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    // Simulate merging agglomerate 4 into agglomerate 1 by joining segments 1 & 4.
    backendMock.planMultipleVersionInjections(10, mergeSegment1And4WithAgglomerateTrees1And4And6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(4, { anchorPosition: [4, 4, 4] }, tracingId));
      yield put(setActiveCellAction(4));
      yield makeMappingEditableHelper();
      const othersMayEdit = true;
      yield put(setOthersMayEditForAnnotationAction(true));

      yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, othersMayEdit);
      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([6, 6, 6], 6));
      // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

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

      const agglomerateSkeletonReloadingUpdates = getNestedUpdateActions(context).slice(-3)!;
      yield expect(agglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/merge_with_injected_merge_should_refresh_agglomerate_skeletons.json",
      );
    });

    await task.toPromise();
  });

  it("should merge two agglomerates, apply injected split update action including agglomerate skeleton updates and update the agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    // Inject splitting agglomerate 1 between segments 1 & 2 including agglomerate skeleton update & create segment.
    backendMock.planMultipleVersionInjections(10, splitSegment1And2WithAgglomerateTrees1And6And4);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: [4, 4, 4] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();
      const othersMayEdit = true;
      yield put(setOthersMayEditForAnnotationAction(true));

      yield* loadAgglomerateSkeletons(context, [1, 6, 4], false, othersMayEdit);
      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([1, 1, 1], 1));
      // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(3);
      const agglomerateSkeletonSix = updatedAgglomerateTrees.getOrThrow(4);
      const agglomerateSkeletonFour = updatedAgglomerateTrees.getOrThrow(5);
      const agglomerateSkeleton1339 = updatedAgglomerateTrees.getOrThrow(6);
      yield expect(agglomerateSkeletonSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_6_after_injected_split_and_merge.json",
      );
      yield expect(agglomerateSkeletonFour).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_4_after_injected_split_and_merge.json",
      );
      yield expect(agglomerateSkeleton1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1339_after_injected_split_and_merge.json",
      );

      const mergeAndAgglomerateSkeletonReloadingUpdates =
        getNestedUpdateActions(context).slice(-3)!;
      yield expect(mergeAndAgglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/merge_with_injected_split_should_refresh_agglomerate_skeletons.json",
      );
    });

    await task.toPromise();
  });

  it("should split an agglomerate, apply injected merge update action including agglomerate skeleton updates and update the agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    // Simulate merging agglomerate 4 into agglomerate 1 by joining segments 1 & 4.
    backendMock.planMultipleVersionInjections(10, mergeSegment1And4WithAgglomerateTrees1And4And6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];
    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();
      yield put(setOthersMayEditForAnnotationAction(true));

      yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, true);

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
      // Wait till proofreading action is finished; including refreshing agglomerate skeletons..
      yield take(
        ((action: Action) =>
          action.type === "SET_BUSY_BLOCKING_INFO_ACTION" && !action.value.isBusy) as ActionPattern,
      );

      const agglomerateSkeletons = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateSkeletons.size()).toBe(3);
      const agglomerateSkeletonOne = agglomerateSkeletons.getOrThrow(3);
      const agglomerateSkeletonSix = agglomerateSkeletons.getOrThrow(5);
      const agglomerateSkeleton1339 = agglomerateSkeletons.getOrThrow(6);
      yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_injected_merge_and_split.json",
      );
      yield expect(agglomerateSkeletonSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_6_after_injected_merge_and_split.json",
      );
      yield expect(agglomerateSkeleton1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1339_after_injected_merge_and_split.json",
      );

      const splitAndAgglomerateSkeletonReloadingUpdates =
        getNestedUpdateActions(context).slice(-3)!;
      yield expect(splitAndAgglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/split_with_injected_merge_should_refresh_agglomerate_skeletons.json",
      );
    });
    await task.toPromise();
  });

  it("should split an agglomerate, apply injected split update action including agglomerate skeleton updates and update the agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    // Inject splitting agglomerate 1 between segments 1 & 2 including agglomerate skeleton update & create segment.
    backendMock.planMultipleVersionInjections(10, splitSegment1And2WithAgglomerateTrees1And4And6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];
    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: [2, 2, 2] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();
      yield put(setOthersMayEditForAnnotationAction(true));

      yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, true);

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: [2, 2, 2],
            position2: [3, 3, 3],
            segmentId1: 2,
            segmentId2: 3,
          },
        ]),
      );

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([3, 3, 3], 3, 1));
      // Wait till proofreading action is finished; including refreshing agglomerate skeletons..
      yield take(
        ((action: Action) =>
          action.type === "SET_BUSY_BLOCKING_INFO_ACTION" && !action.value.isBusy) as ActionPattern,
      );

      const agglomerateSkeletons = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateSkeletons.size()).toBe(5);
      const agglomerateSkeletonOne = agglomerateSkeletons.getOrThrow(3);
      const agglomerateSkeletonFour = agglomerateSkeletons.getOrThrow(4);
      const agglomerateSkeletonSix = agglomerateSkeletons.getOrThrow(5);
      const agglomerateSkeleton1339 = agglomerateSkeletons.getOrThrow(6);
      const agglomerateSkeleton1340 = agglomerateSkeletons.getOrThrow(7);
      yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_injected_split_and_split.json",
      );
      yield expect(agglomerateSkeletonFour).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_4_after_injected_split_and_split.json",
      );
      yield expect(agglomerateSkeletonSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_6_after_injected_split_and_split.json",
      );
      yield expect(agglomerateSkeleton1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1339_after_injected_split_and_split.json",
      );
      yield expect(agglomerateSkeleton1340).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1340_after_injected_split_and_split.json",
      );

      const splitAndAgglomerateSkeletonReloadingUpdates =
        getNestedUpdateActions(context).slice(-3)!;
      yield expect(splitAndAgglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/mincut_with_injected_split_should_refresh_agglomerate_skeletons.json",
      );
    });
    await task.toPromise();
  });

  it("should split an agglomerate from all neighbors, apply injected merge update action including agglomerate skeleton updates and update the agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    // Simulate merging agglomerate 4 into agglomerate 1 by joining segments 1 & 4.
    backendMock.planMultipleVersionInjections(10, mergeSegment1And4WithAgglomerateTrees1And4And6);

    // Prepare the server's reply for the upcoming split from all neighbors request.
    vi.mocked(context.mocks.getNeighborsForAgglomerateNode).mockReturnValue(
      Promise.resolve({
        segmentId: 2,
        neighbors: [
          {
            segmentId: 1,
            position: [1, 1, 1] as Vector3,
          },
          {
            segmentId: 3,
            position: [3, 3, 3] as Vector3,
          },
        ],
      }),
    );

    const task = startSaga(function* () {
      const { tracingId } = yield* select((state: WebknossosState) => state.annotation.volumes[0]);
      yield call(initializeMappingAndTool, context, tracingId);

      // Activate segment 2, setup editable mapping, make it shared and load agglomerate skeletons.
      yield put(updateSegmentAction(1, { anchorPosition: [2, 2, 2] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();
      yield put(setOthersMayEditForAnnotationAction(true));

      yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, true);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        cutAgglomerateFromNeighborsAction(
          [2, 2, 2], // unmappedId=2 / mappedId=2 at this position
        ),
      );
      yield take(
        ((action: Action) =>
          action.type === "SET_BUSY_BLOCKING_INFO_ACTION" && !action.value.isBusy) as ActionPattern,
      );

      const agglomerateSkeletons = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateSkeletons.size()).toBe(4);
      const agglomerateSkeletonOne = agglomerateSkeletons.getOrThrow(3);
      const agglomerateSkeletonSix = agglomerateSkeletons.getOrThrow(5);
      const agglomerateSkeleton1339 = agglomerateSkeletons.getOrThrow(6);
      const agglomerateSkeleton1340 = agglomerateSkeletons.getOrThrow(7);
      yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_injected_merge_and_splitting_from_all_neighbors.json",
      );
      yield expect(agglomerateSkeletonSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_6_after_injected_merge_and_splitting_from_all_neighbors.json",
      );
      yield expect(agglomerateSkeleton1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1339_after_injected_merge_and_splitting_from_all_neighbors.json",
      );
      yield expect(agglomerateSkeleton1340).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1340_after_injected_merge_and_splitting_from_all_neighbors.json",
      );

      const splitAndAgglomerateSkeletonReloadingUpdates =
        getNestedUpdateActions(context).slice(-4)!;
      yield expect(splitAndAgglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/split_from_all_neighbors_with_injected_merge_should_refresh_agglomerate_skeletons.json",
      );
    });
    await task.toPromise();
  });

  it("should split agglomerate via partitioned min-cut, apply injected split update action including agglomerate skeleton updates and update the agglomerate skeleton accordingly", async (context: WebknossosTestContext) => {
    // Initial mapping should be
    // [[1, 1],
    //  [2, 1],
    //  [3, 1],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1],
    //  [1338, 1]]
    // Thus, there should be the following circle of edges: 1-2-3-1337-1338-1.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [
      [1, 1338],
      [3, 1337],
    ]);

    // Mapping after interference should be
    // [[1, 1339],
    //  [2, 1],
    //  [3, 1339],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1339],
    //  [1338, 1339]]
    // Contains two circles now but only one is split by the min-cut request.
    // Inject splitting agglomerate 1 between segments 1 <-> 2 <-> 3 including agglomerate skeleton update & create segment.
    // Update also contains skeleton & segment list updates.
    backendMock.planMultipleVersionInjections(10, splitSegment2And3WithAgglomerateTrees1And4And6);

    // Prepare the server's reply for the upcoming split between 1337 & 1338 edge.
    vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
      Promise.resolve([
        {
          position1: [1337, 1337, 1337],
          position2: [1338, 1338, 1338],
          segmentId1: 1337,
          segmentId2: 1338,
        },
      ]),
    );

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1339, { anchorPosition: [1337, 1337, 1337] }, tracingId));
      yield put(setActiveCellAction(1339, undefined, null, 1337));

      yield makeMappingEditableHelper();
      yield put(setOthersMayEditForAnnotationAction(true));

      yield* loadAgglomerateSkeletons(context, [1, 4, 6], false, true);

      //Activate Multi-split tool
      yield put(updateUserSettingAction("isMultiSplitActive", true));
      // Select partition 1
      yield put(toggleSegmentInPartitionAction(1, 1, 1339));
      yield put(toggleSegmentInPartitionAction(1337, 1, 1339));
      // Select partition 2
      yield put(toggleSegmentInPartitionAction(1338, 2, 1339));
      yield put(toggleSegmentInPartitionAction(3, 2, 1339));
      // Execute the actual merge and wait for the finished mapping.
      yield put(minCutPartitionsAction());
      yield take(
        ((action: Action) =>
          action.type === "SET_BUSY_BLOCKING_INFO_ACTION" && !action.value.isBusy) as ActionPattern,
      );

      const agglomerateSkeletons = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateSkeletons.size()).toBe(5);
      const agglomerateSkeletonOne = agglomerateSkeletons.getOrThrow(3);
      const agglomerateSkeletonFour = agglomerateSkeletons.getOrThrow(4);
      const agglomerateSkeletonSix = agglomerateSkeletons.getOrThrow(5);
      const agglomerateSkeleton1339 = agglomerateSkeletons.getOrThrow(6);
      const agglomerateSkeleton1340 = agglomerateSkeletons.getOrThrow(7);
      yield expect(agglomerateSkeletonOne).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1_after_injected_split_and_partitioned_min_cut.json",
      );
      yield expect(agglomerateSkeletonFour).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_4_after_injected_split_and_partitioned_min_cut.json",
      );
      yield expect(agglomerateSkeletonSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_6_after_injected_split_and_partitioned_min_cut.json",
      );
      yield expect(agglomerateSkeleton1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1339_after_injected_split_and_partitioned_min_cut.json",
      );
      yield expect(agglomerateSkeleton1340).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/auto-sync_agglomerate_skeleton_1340_after_injected_split_and_partitioned_min_cut.json",
      );

      const splitAndAgglomerateSkeletonReloadingUpdates =
        getNestedUpdateActions(context).slice(-3)!;
      yield expect(splitAndAgglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/multi_split_with_injected_split_should_refresh_agglomerate_skeletons.json",
      );
    });

    await task.toPromise();
  });

  it("should merge agglomerates and incorporate injected agglomerate tree loading and then update the tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planMultipleVersionInjections(7, loadAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();
      yield put(setOthersMayEditForAnnotationAction(true));

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction([4, 4, 4], 4));
      // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(1);
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

      const agglomerateSkeletonReloadingUpdates = getNestedUpdateActions(context).slice(-3)!;
      yield expect(agglomerateSkeletonReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/merge_should_correctly_update_newly_loaded_agglomerate_skeleton_due_to_rebasing.json",
      );
    });

    await task.toPromise();
  });

  it("should split an agglomerate and incorporate injected agglomerate tree loading and then update the tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planMultipleVersionInjections(7, loadAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();
      yield put(setOthersMayEditForAnnotationAction(true));

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
      // Wait till proofreading action is finished; including refreshing agglomerate skeletons.
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // Turning busy state on
      yield take("SET_BUSY_BLOCKING_INFO_ACTION"); // and off when finished

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(2);
      expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(1);
      expect(updatedAgglomerateTrees.getOrThrow(4).nodes.size()).toBe(2);
      const splittingAndAgglomerateReloadingUpdates = getNestedUpdateActions(context).slice(-3);
      yield expect(splittingAndAgglomerateReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_skeleton_syncing/split_should_correctly_update_newly_loaded_agglomerate_skeleton_due_to_rebasing.json",
      );
    });

    await task.toPromise();
  });
});
