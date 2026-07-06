import { type ActionPattern, call, put, take } from "redux-saga/effects";
import {
  getNestedUpdateActions,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { actionChannel } from "typed-redux-saga";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import { loadAgglomerateTreeAtPosition } from "viewer/controller/combinations/segmentation_handlers";
import { getTreesWithType } from "viewer/model/accessors/skeletontracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
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
import { loadAgglomerateTrees } from "./proofreading_skeleton_test_utils";
import {
  expectSegmentList,
  getPositionForSegmentId,
  initializeMappingAndTool,
  loadAgglomerateMeshes,
  makeMappingEditableForTest,
  mockInitialBucketAndAgglomerateData,
  operationFinished,
} from "./proofreading_test_utils";

describe("Proofreading agglomerate tree syncing", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should load agglomerate trees while having the annotation mutex and immediately store the loaded tree in the backend", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(
        updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
      );
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();
      yield put(setCollaborationModeAction("Concurrent"));

      const versionBeforeAgglomerateTreeLoading = yield* select(
        (state) => state.annotation.version,
      );

      const loadAgglomerateChannel = yield* actionChannel([
        "LOAD_AGGLOMERATE_TREE_FROM_ID",
        "LOAD_AGGLOMERATE_TREE_AT_POSITION",
      ]);
      const ensureHasNewestVersionChannel = yield* actionChannel("ENSURE_HAS_NEWEST_VERSION");
      const saveNowChannel = yield* actionChannel("SAVE_NOW");

      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield call(loadAgglomerateTreeAtPosition, getPositionForSegmentId(1));

      // Test whether
      // 1. action to load agglomerate tree is dispatched.
      // 2. the annotation mutex is properly fetched and kept.
      // 3. The latest changes including the loading of the agglomerate tree are stored in the backend.
      // Check whether the actions are dispatched via action channels to avoid race condition.
      yield take(loadAgglomerateChannel);
      yield take("SUBSCRIBE_TO_ANNOTATION_MUTEX");
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
      const versionAfterAgglomerateTreeLoading = yield* select((state) => state.annotation.version);
      // Check that the local version was bumped.
      expect(
        versionAfterAgglomerateTreeLoading - versionBeforeAgglomerateTreeLoading,
      ).toBeGreaterThan(0);
      const agglomerateTreeUpdates = getNestedUpdateActions(context).at(-1)!;
      yield expect(agglomerateTreeUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/should_auto_push_tree_updates_in_live_collab.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: getPositionForSegmentId(1),
        },
      ]);
    });

    await task.toPromise();
  });

  describe.each([false, true])("With othersMayEdit=%s", (othersMayEdit: boolean) => {
    it("should merge two agglomerates and update the agglomerate tree accordingly", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* () {
        yield call(initializeMappingAndTool, context, tracingId);

        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield put(
          updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1n));
        yield makeMappingEditableForTest();
        if (othersMayEdit) {
          yield put(setCollaborationModeAction("Concurrent"));
        }

        yield loadAgglomerateTrees(context, [1n, 4n, 6n], false, othersMayEdit);

        // Execute the actual merge and wait for the finished mapping.
        yield put(proofreadMergeAction(getPositionForSegmentId(4), 4n));
        // Wait till proofreading action is finished; including refreshing agglomerate trees.
        yield take(operationFinished("PROOFREADING"));

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
          getPositionForSegmentId(1),
          getPositionForSegmentId(2),
          getPositionForSegmentId(3),
          getPositionForSegmentId(4),
          getPositionForSegmentId(5),
        ]);

        const agglomerateTreeReloadingUpdates = getNestedUpdateActions(context).slice(-3)!;
        yield expect(agglomerateTreeReloadingUpdates).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_tree_syncing/merge_should_refresh_agglomerate_trees_with_others_may_edit-${othersMayEdit}.json`,
        );
        yield expectSegmentList(tracingId, [
          {
            id: 1n,
            anchorPosition: getPositionForSegmentId(1),
          },
        ]);
      });

      await task.toPromise();
    });

    it("should merge two agglomerates and not update agglomerate tree if not included in update actions.", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* () {
        yield call(initializeMappingAndTool, context, tracingId);

        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield put(
          updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1n));
        yield makeMappingEditableForTest();
        if (othersMayEdit) {
          yield put(setCollaborationModeAction("Concurrent"));
        }

        yield loadAgglomerateTrees(context, [6n], true, othersMayEdit);

        // Execute the actual merge and wait for the finished mapping.
        yield put(proofreadMergeAction(getPositionForSegmentId(4), 4n));
        // Wait till proofreading action is finished; including refreshing agglomerate trees.
        yield take(operationFinished("PROOFREADING"));

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
          getPositionForSegmentId(6),
          getPositionForSegmentId(7),
        ]);

        const agglomerateTreeUpdateActions = context.receivedDataPerSaveRequest
          .at(-1)!
          .filter((batch) =>
            batch.actions.some((action) =>
              ["deleteTree", "updateActiveNode", "createTree", "createNode", "createEdge"].includes(
                action.name,
              ),
            ),
          );
        expect(agglomerateTreeUpdateActions.length).toBe(0);
        yield expectSegmentList(tracingId, [
          {
            id: 1n,
            anchorPosition: [1, 1, 1],
          },
        ]);
      });

      await task.toPromise();
    });

    it("should split an agglomerate and update the agglomerate tree accordingly", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* () {
        yield call(initializeMappingAndTool, context, tracingId);

        // Set up the split-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield put(
          updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1n));
        yield makeMappingEditableForTest();
        if (othersMayEdit) {
          yield put(setCollaborationModeAction("Concurrent"));
        }

        yield* loadAgglomerateTrees(context, [1n], false, othersMayEdit);

        // Prepare the server's reply for the upcoming split.
        vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
          Promise.resolve([
            {
              position1: getPositionForSegmentId(1),
              position2: getPositionForSegmentId(2),
              segmentId1: 1n,
              segmentId2: 2n,
            },
          ]),
        );

        // Execute the split and wait for the finished mapping.
        yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2n, 1n));
        // Wait till proofreading action is finished; including refreshing agglomerate trees.
        yield take(operationFinished("PROOFREADING"));

        const updatedAgglomerateTrees = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );
        expect(updatedAgglomerateTrees.size()).toBe(2);
        expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(1);
        expect(updatedAgglomerateTrees.getOrThrow(4).nodes.size()).toBe(2);

        const splittingAndAgglomerateReloadingUpdates = getNestedUpdateActions(context).slice(-3);
        yield expect(splittingAndAgglomerateReloadingUpdates).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_tree_syncing/split_should_refresh_agglomerate_trees_with_others_may_edit-${othersMayEdit}.json`,
        );
        yield expectSegmentList(tracingId, [
          {
            id: 1n,
            anchorPosition: [1, 1, 1],
          },
          {
            id: 1339n,
            anchorPosition: [2, 2, 2],
          },
        ]);
      });

      await task.toPromise();
    });

    it("should split an agglomerate and not update an unaffected agglomerate tree", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const { annotation } = Store.getState();
      const { tracingId } = annotation.volumes[0];

      const task = startSaga(function* () {
        yield call(initializeMappingAndTool, context, tracingId);

        // Set up the split-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield put(
          updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1n));
        yield makeMappingEditableForTest();
        if (othersMayEdit) {
          yield put(setCollaborationModeAction("Concurrent"));
        }

        yield* loadAgglomerateTrees(context, [4n], false, othersMayEdit);

        // Prepare the server's reply for the upcoming split.
        vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
          Promise.resolve([
            {
              position1: getPositionForSegmentId(1),
              position2: getPositionForSegmentId(2),
              segmentId1: 1n,
              segmentId2: 2n,
            },
          ]),
        );

        // Execute the split and wait for the finished mapping.
        yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2n, 1n));
        // Wait till proofreading action is finished; including refreshing agglomerate trees.
        yield take(operationFinished("PROOFREADING"));

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
          getPositionForSegmentId(4),
          getPositionForSegmentId(5),
        ]);

        const splitAndCreateSegmentActions = getNestedUpdateActions(context).slice(-2)!;
        yield expect(splitAndCreateSegmentActions).toMatchFileSnapshot(
          `./__snapshots__/agglomerate_tree_syncing/split_should_not_refresh_unaffected_agglomerate_trees_with_others_may_edit-${othersMayEdit}.json`,
        );
        yield expectSegmentList(tracingId, [
          {
            id: 1n,
            anchorPosition: [1, 1, 1],
          },
          {
            id: 1339n,
            anchorPosition: [2, 2, 2],
          },
        ]);
      });

      await task.toPromise();
    });

    it("should auto update agglomerate trees after merge via mesh interaction", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const task = startSaga(function* () {
        const { tracingId } = yield* select(
          (state: WebknossosState) => state.annotation.volumes[0],
        );
        yield call(initializeMappingAndTool, context, tracingId);

        // Load relevant meshes.
        yield makeMappingEditableForTest();
        yield loadAgglomerateMeshes([1, 6]);
        if (othersMayEdit) {
          yield put(setCollaborationModeAction("Concurrent"));
        }

        yield* loadAgglomerateTrees(context, [1n, 6n], false, othersMayEdit);
        yield put(
          updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1n, undefined, null, 1n));

        // Execute the actual merge via meshes merging segment 1 with segment 6.
        yield put(
          proofreadMergeAction(
            null, // mesh actions do not have a usable source position.
            6n,
            6n,
          ),
        );
        yield take(operationFinished("PROOFREADING")); // operation finished

        const agglomerateTrees = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );
        expect(agglomerateTrees.size()).toBe(1);
        const agglomerateTreeOne = agglomerateTrees.getOrThrow(3);
        yield expect(agglomerateTreeOne).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1_after_merging.json",
        );
        yield expectSegmentList(tracingId, [
          {
            id: 1n,
            anchorPosition: [1, 1, 1],
          },
        ]);
      });
      await task.toPromise();
    });

    it("should auto update agglomerate trees after split via mesh interaction", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const task = startSaga(function* () {
        const { tracingId } = yield* select(
          (state: WebknossosState) => state.annotation.volumes[0],
        );
        yield call(initializeMappingAndTool, context, tracingId);

        // Load relevant meshes.
        yield makeMappingEditableForTest();
        yield loadAgglomerateMeshes([1, 6]);
        if (othersMayEdit) {
          yield put(setCollaborationModeAction("Concurrent"));
        }

        yield* loadAgglomerateTrees(context, [1n, 6n], false, othersMayEdit);
        yield put(
          updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1n, undefined, null, 1n));

        // Prepare the server's reply for the upcoming split.
        vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
          Promise.resolve([
            {
              position1: getPositionForSegmentId(1),
              position2: getPositionForSegmentId(2),
              segmentId1: 1n,
              segmentId2: 2n,
            },
          ]),
        );

        // Execute the actual split between segments 1 with segment 2.
        yield put(
          minCutAgglomerateWithPositionAction(
            null, // mesh actions do not have a usable source position.
            2n,
            1n,
          ),
        );
        yield take(operationFinished("PROOFREADING")); // operation finished

        const agglomerateTrees = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );
        expect(agglomerateTrees.size()).toBe(3);
        const agglomerateTreeOne = agglomerateTrees.getOrThrow(3);
        const agglomerateTreeSix = agglomerateTrees.getOrThrow(4);
        const agglomerateTree1339 = agglomerateTrees.getOrThrow(5);
        yield expect(agglomerateTreeOne).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1_after_splitting.json",
        );
        yield expect(agglomerateTreeSix).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_6_after_splitting.json",
        );
        yield expect(agglomerateTree1339).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1339_after_splitting.json",
        );
        yield expectSegmentList(tracingId, [
          {
            id: 1n,
            anchorPosition: [1, 1, 1],
          },
          {
            id: 1339n,
            anchorPosition: [2, 2, 2],
          },
          {
            id: 6n,
            anchorPosition: [6, 6, 6],
          },
        ]);
      });
      await task.toPromise();
    });

    it("should auto update agglomerate trees after splitting from all neighbors", async (context: WebknossosTestContext) => {
      mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getNeighborsForAgglomerateNode).mockReturnValue(
        Promise.resolve({
          segmentId: 2n,
          neighbors: [
            {
              segmentId: 1n,
              position: getPositionForSegmentId(1) as Vector3,
            },
            {
              segmentId: 3n,
              position: getPositionForSegmentId(3) as Vector3,
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
        yield makeMappingEditableForTest();
        if (othersMayEdit) {
          yield put(setCollaborationModeAction("Concurrent"));
        }

        yield* loadAgglomerateTrees(context, [1n, 6n], false, othersMayEdit);
        yield put(
          updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(2) }, tracingId),
        );
        yield put(setActiveCellAction(1n));

        // Execute the actual merge and wait for the finished mapping.
        yield put(
          cutAgglomerateFromNeighborsAction(
            getPositionForSegmentId(2), // unmappedId=2 / mappedId=1 at this position
          ),
        );
        yield take(operationFinished("PROOFREADING")); // operation finished

        const agglomerateTrees = yield* select((state) =>
          getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
        );
        expect(agglomerateTrees.size()).toBe(4);
        const agglomerateTreeOne = agglomerateTrees.getOrThrow(3);
        const agglomerateTreeSix = agglomerateTrees.getOrThrow(4);
        const agglomerateTree1339 = agglomerateTrees.getOrThrow(5);
        const agglomerateTree1340 = agglomerateTrees.getOrThrow(6);
        yield expect(agglomerateTreeOne).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1_after_splitting_from_all_neighbors.json",
        );
        yield expect(agglomerateTreeSix).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_6_after_splitting_from_all_neighbors.json",
        );
        yield expect(agglomerateTree1339).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1339_after_splitting_from_all_neighbors.json",
        );
        yield expect(agglomerateTree1340).toMatchFileSnapshot(
          "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1340_after_splitting_from_all_neighbors.json",
        );
        yield expectSegmentList(tracingId, [
          {
            id: 1n,
            anchorPosition: [2, 2, 2],
          },
          {
            id: 1339n,
            anchorPosition: [1, 1, 1],
          },
          {
            id: 1340n,
            anchorPosition: [3, 3, 3],
          },
        ]);
      });
      await task.toPromise();
    });
  });

  // --------- Multi user tests with injected updates ---------

  it("should merge two agglomerates, apply injected merge update action including agglomerate tree updates and update the agglomerate tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Simulate merging agglomerate 4 into agglomerate 1 by joining segments 1 & 4.
    backendMock.planMultipleVersionInjections(10, mergeSegment1And4WithAgglomerateTrees1And4And6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(4n, { anchorPosition: getPositionForSegmentId(4) }, tracingId));
      yield put(setActiveCellAction(4n));
      yield makeMappingEditableForTest();
      const othersMayEdit = true;
      yield put(setCollaborationModeAction("Concurrent"));

      yield* loadAgglomerateTrees(context, [1n, 4n, 6n], false, othersMayEdit);
      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction(getPositionForSegmentId(6), 6n));
      // Wait till proofreading action is finished; including refreshing agglomerate trees.
      yield take(operationFinished("PROOFREADING"));

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
        getPositionForSegmentId(1),
        getPositionForSegmentId(2),
        getPositionForSegmentId(3),
        getPositionForSegmentId(4),
        getPositionForSegmentId(5),
        getPositionForSegmentId(6),
        getPositionForSegmentId(7),
      ]);

      const mergeAndAgglomerateTreeReloadingUpdates = getNestedUpdateActions(context).slice(-4)!;
      yield expect(mergeAndAgglomerateTreeReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/merge_with_injected_merge_should_refresh_agglomerate_trees.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [4, 4, 4],
        },
      ]);
    });

    await task.toPromise();
  });

  it("should merge two agglomerates, apply injected split update action including agglomerate tree updates and update the agglomerate tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Inject splitting agglomerate 1 between segments 1 & 2 including agglomerate tree update & create segment.
    backendMock.planMultipleVersionInjections(10, splitSegment1And2WithAgglomerateTrees1And6And4);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(4) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();
      const othersMayEdit = true;
      yield put(setCollaborationModeAction("Concurrent"));

      yield* loadAgglomerateTrees(context, [1n, 6n, 4n], false, othersMayEdit);
      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction(getPositionForSegmentId(1), 1n));
      // Wait till proofreading action is finished; including refreshing agglomerate trees.
      yield take(operationFinished("PROOFREADING"));

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(3);
      const agglomerateTreeSix = updatedAgglomerateTrees.getOrThrow(4);
      const agglomerateTreeFour = updatedAgglomerateTrees.getOrThrow(5);
      const agglomerateTree1339 = updatedAgglomerateTrees.getOrThrow(6);
      yield expect(agglomerateTreeSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_6_after_injected_split_and_merge.json",
      );
      yield expect(agglomerateTreeFour).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_4_after_injected_split_and_merge.json",
      );
      yield expect(agglomerateTree1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1339_after_injected_split_and_merge.json",
      );

      const mergeAndAgglomerateTreeReloadingUpdates = getNestedUpdateActions(context).slice(-4)!;
      yield expect(mergeAndAgglomerateTreeReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/merge_with_injected_split_should_refresh_agglomerate_trees.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 4n,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 1339n,
          anchorPosition: [2, 2, 2],
        },
      ]);
    });

    await task.toPromise();
  });

  it("should split an agglomerate, apply injected merge update action including agglomerate tree updates and update the agglomerate tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    // Simulate merging agglomerate 4 into agglomerate 1 by joining segments 1 & 4.
    backendMock.planMultipleVersionInjections(10, mergeSegment1And4WithAgglomerateTrees1And4And6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];
    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();
      yield put(setCollaborationModeAction("Concurrent"));

      yield* loadAgglomerateTrees(context, [1n, 4n, 6n], false, true);

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: getPositionForSegmentId(1),
            position2: getPositionForSegmentId(2),
            segmentId1: 1n,
            segmentId2: 2n,
          },
        ]),
      );

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2n, 1n));
      // Wait till proofreading action is finished; including refreshing agglomerate trees..
      yield take(operationFinished("PROOFREADING")); // operation finished

      const agglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateTrees.size()).toBe(3);
      const agglomerateTreeOne = agglomerateTrees.getOrThrow(3);
      const agglomerateTreeSix = agglomerateTrees.getOrThrow(5);
      const agglomerateTree1339 = agglomerateTrees.getOrThrow(6);
      yield expect(agglomerateTreeOne).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1_after_injected_merge_and_split.json",
      );
      yield expect(agglomerateTreeSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_6_after_injected_merge_and_split.json",
      );
      yield expect(agglomerateTree1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1339_after_injected_merge_and_split.json",
      );

      const splitAndAgglomerateTreeReloadingUpdates = getNestedUpdateActions(context).slice(-3)!;
      yield expect(splitAndAgglomerateTreeReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/split_with_injected_merge_should_refresh_agglomerate_trees.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 1339n,
          anchorPosition: [2, 2, 2],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should split an agglomerate, apply injected split update action including agglomerate tree updates and update the agglomerate tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    // Inject splitting agglomerate 1 between segments 1 & 2 including agglomerate tree update & create segment.
    backendMock.planMultipleVersionInjections(10, splitSegment1And2WithAgglomerateTrees1And4And6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];
    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(2) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();
      yield put(setCollaborationModeAction("Concurrent"));

      yield* loadAgglomerateTrees(context, [1n, 4n, 6n], false, true);

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: getPositionForSegmentId(2),
            position2: getPositionForSegmentId(3),
            segmentId1: 2n,
            segmentId2: 3n,
          },
        ]),
      );

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(3), 3n, 1n));
      // Wait till proofreading action is finished; including refreshing agglomerate trees..
      yield take(operationFinished("PROOFREADING")); // operation finished

      const agglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateTrees.size()).toBe(5);
      const agglomerateTreeOne = agglomerateTrees.getOrThrow(3);
      const agglomerateTreeFour = agglomerateTrees.getOrThrow(4);
      const agglomerateTreeSix = agglomerateTrees.getOrThrow(5);
      const agglomerateTree1339 = agglomerateTrees.getOrThrow(6);
      const agglomerateTree1340 = agglomerateTrees.getOrThrow(7);
      yield expect(agglomerateTreeOne).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1_after_injected_split_and_split.json",
      );
      yield expect(agglomerateTreeFour).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_4_after_injected_split_and_split.json",
      );
      yield expect(agglomerateTreeSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_6_after_injected_split_and_split.json",
      );
      yield expect(agglomerateTree1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1339_after_injected_split_and_split.json",
      );
      yield expect(agglomerateTree1340).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1340_after_injected_split_and_split.json",
      );

      const splitAndAgglomerateTreeReloadingUpdates = getNestedUpdateActions(context).slice(-3)!;
      yield expect(splitAndAgglomerateTreeReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/mincut_with_injected_split_should_refresh_agglomerate_trees.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 1339n,
          anchorPosition: [2, 2, 2],
        },
        {
          id: 1340n,
          anchorPosition: [3, 3, 3],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should split an agglomerate from all neighbors, apply injected merge update action including agglomerate tree updates and update the agglomerate tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    // Simulate merging agglomerate 4 into agglomerate 1 by joining segments 1 & 4.
    backendMock.planMultipleVersionInjections(10, mergeSegment1And4WithAgglomerateTrees1And4And6);

    // Prepare the server's reply for the upcoming split from all neighbors request.
    vi.mocked(context.mocks.getNeighborsForAgglomerateNode).mockReturnValue(
      Promise.resolve({
        segmentId: 2n,
        neighbors: [
          {
            segmentId: 1n,
            position: getPositionForSegmentId(1) as Vector3,
          },
          {
            segmentId: 3n,
            position: getPositionForSegmentId(3) as Vector3,
          },
        ],
      }),
    );

    const task = startSaga(function* () {
      const { tracingId } = yield* select((state: WebknossosState) => state.annotation.volumes[0]);
      yield call(initializeMappingAndTool, context, tracingId);

      // Activate segment 2, setup editable mapping, make it shared and load agglomerate trees.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(2) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();
      yield put(setCollaborationModeAction("Concurrent"));

      yield* loadAgglomerateTrees(context, [1n, 4n, 6n], false, true);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        cutAgglomerateFromNeighborsAction(
          getPositionForSegmentId(2), // unmappedId=2 / mappedId=2 at this position
        ),
      );
      yield take(operationFinished("PROOFREADING")); // operation finished

      const agglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateTrees.size()).toBe(4);
      const agglomerateTreeOne = agglomerateTrees.getOrThrow(3);
      const agglomerateTreeSix = agglomerateTrees.getOrThrow(5);
      const agglomerateTree1339 = agglomerateTrees.getOrThrow(6);
      const agglomerateTree1340 = agglomerateTrees.getOrThrow(7);
      yield expect(agglomerateTreeOne).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1_after_injected_merge_and_splitting_from_all_neighbors.json",
      );
      yield expect(agglomerateTreeSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_6_after_injected_merge_and_splitting_from_all_neighbors.json",
      );
      yield expect(agglomerateTree1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1339_after_injected_merge_and_splitting_from_all_neighbors.json",
      );
      yield expect(agglomerateTree1340).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1340_after_injected_merge_and_splitting_from_all_neighbors.json",
      );

      const splitAndAgglomerateTreeReloadingUpdates = getNestedUpdateActions(context).slice(-5)!;
      yield expect(splitAndAgglomerateTreeReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/split_from_all_neighbors_with_injected_merge_should_refresh_agglomerate_trees.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [2, 2, 2],
        },
        {
          id: 1339n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 1340n,
          anchorPosition: [3, 3, 3],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should split agglomerate via partitioned min-cut, apply injected split update action including agglomerate tree updates and update the agglomerate tree accordingly", async (context: WebknossosTestContext) => {
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
    const backendMock = mockInitialBucketAndAgglomerateData(
      context,
      [
        [1n, 1338n],
        [3n, 1337n],
      ],
      Store.getState(),
    );

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
    // Inject splitting agglomerate 1 between segments 1 <-> 2 <-> 3 including agglomerate tree update & create segment.
    // Update also contains skeleton & segment list updates.
    backendMock.planMultipleVersionInjections(10, splitSegment2And3WithAgglomerateTrees1And4And6);

    // Prepare the server's reply for the upcoming split between 1337 & 1338 edge.
    vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
      Promise.resolve([
        {
          position1: getPositionForSegmentId(1337),
          position2: getPositionForSegmentId(1338),
          segmentId1: 1337n,
          segmentId2: 1338n,
        },
      ]),
    );

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(
        updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1337) }, tracingId),
      );
      yield put(setActiveCellAction(1n, undefined, null, 1337n));

      yield makeMappingEditableForTest();
      yield put(setCollaborationModeAction("Concurrent"));

      yield* loadAgglomerateTrees(context, [1n, 4n, 6n], false, true);

      //Activate Multi-split tool
      yield put(updateUserSettingAction("isMultiSplitActive", true));
      // Select partition 1
      yield put(toggleSegmentInPartitionAction(1n, 1, 1n));
      yield put(toggleSegmentInPartitionAction(1338n, 1, 1n));
      // Select partition 2
      yield put(toggleSegmentInPartitionAction(1337n, 2, 1n));
      yield put(toggleSegmentInPartitionAction(3n, 2, 1n));
      // Execute the actual merge and wait for the finished mapping.
      yield put(minCutPartitionsAction());
      yield take(operationFinished("PROOFREADING")); // operation finished

      const agglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(agglomerateTrees.size()).toBe(5);
      const agglomerateTreeOne = agglomerateTrees.getOrThrow(3);
      const agglomerateTreeFour = agglomerateTrees.getOrThrow(4);
      const agglomerateTreeSix = agglomerateTrees.getOrThrow(5);
      const agglomerateTree1339 = agglomerateTrees.getOrThrow(6);
      const agglomerateTree1340 = agglomerateTrees.getOrThrow(7);
      yield expect(agglomerateTreeOne).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1_after_injected_split_and_partitioned_min_cut.json",
      );
      yield expect(agglomerateTreeFour).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_4_after_injected_split_and_partitioned_min_cut.json",
      );
      yield expect(agglomerateTreeSix).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_6_after_injected_split_and_partitioned_min_cut.json",
      );
      yield expect(agglomerateTree1339).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1339_after_injected_split_and_partitioned_min_cut.json",
      );
      yield expect(agglomerateTree1340).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/auto-sync_agglomerate_tree_1340_after_injected_split_and_partitioned_min_cut.json",
      );

      const splitAndAgglomerateTreeReloadingUpdates = getNestedUpdateActions(context).slice(-4)!;
      yield expect(splitAndAgglomerateTreeReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/multi_split_with_injected_split_should_refresh_agglomerate_trees.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [2, 2, 2],
        },
        {
          id: 1339n,
          anchorPosition: [100, 100, 100],
        },
        {
          id: 1340n,
          anchorPosition: [101, 101, 101],
        },
      ]);
    });

    await task.toPromise();
  });

  it("should merge agglomerates and incorporate injected agglomerate tree loading and then update the tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(7, loadAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();
      yield put(setCollaborationModeAction("Concurrent"));

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction(getPositionForSegmentId(4), 4n));
      // Wait till proofreading action is finished; including refreshing agglomerate trees.
      yield take(operationFinished("PROOFREADING"));

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
        getPositionForSegmentId(1),
        getPositionForSegmentId(2),
        getPositionForSegmentId(3),
        getPositionForSegmentId(4),
        getPositionForSegmentId(5),
      ]);

      const agglomerateTreeReloadingUpdates = getNestedUpdateActions(context).slice(-3)!;
      yield expect(agglomerateTreeReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/merge_should_correctly_update_newly_loaded_agglomerate_tree_due_to_rebasing.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });

    await task.toPromise();
  });

  it("should split an agglomerate and incorporate injected agglomerate tree loading and then update the tree accordingly", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(7, loadAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      vi.mocked(context.mocks.parseProtoTracing).mockRestore();
      yield call(initializeMappingAndTool, context, tracingId);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();
      yield put(setCollaborationModeAction("Concurrent"));

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: getPositionForSegmentId(1),
            position2: getPositionForSegmentId(2),
            segmentId1: 1n,
            segmentId2: 2n,
          },
        ]),
      );

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2n, 1n));
      // Wait till proofreading action is finished; including refreshing agglomerate trees.
      yield take(operationFinished("PROOFREADING"));

      const updatedAgglomerateTrees = yield* select((state) =>
        getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
      );
      expect(updatedAgglomerateTrees.size()).toBe(2);
      expect(updatedAgglomerateTrees.getOrThrow(3).nodes.size()).toBe(1);
      expect(updatedAgglomerateTrees.getOrThrow(4).nodes.size()).toBe(2);
      const splittingAndAgglomerateReloadingUpdates = getNestedUpdateActions(context).slice(-3);
      yield expect(splittingAndAgglomerateReloadingUpdates).toMatchFileSnapshot(
        "./__snapshots__/agglomerate_tree_syncing/split_should_correctly_update_newly_loaded_agglomerate_tree_due_to_rebasing.json",
      );
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 1339n,
          anchorPosition: [2, 2, 2],
        },
      ]);
    });

    await task.toPromise();
  });
});
