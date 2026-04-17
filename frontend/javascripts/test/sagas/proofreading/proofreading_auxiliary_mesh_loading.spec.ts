import type { ActionPattern, Task } from "@redux-saga/types";
import type { MinCutTargetEdge } from "admin/rest_api";
import sortBy from "lodash-es/sortBy";
import { call, put, take } from "redux-saga/effects";
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_server_objects";
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { cancel, delay, takeEvery } from "typed-redux-saga";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  type FinishedLoadingMeshAction,
  type RemoveMeshAction,
  setCollaborationModeAction,
} from "viewer/model/actions/annotation_actions";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { type Saga, select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga, type WebknossosState } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeSegment1And4,
  mergeSegment5And6,
  mergeSegment5And6WithAgglomerateTree1,
  mergeSegment5And6WithAgglomerateTree1And4,
  splitSegment1And2,
  splitSegment1And2WithAgglomerateTree1,
  splitSegment2And3,
} from "./proofreading_interaction_update_action_fixtures";
import {
  mockEdgesForAgglomerateMinCut,
  performMergeTreesProofreading,
  performMinCutWithNodesProofreading,
  performSplitTreesProofreading,
} from "./proofreading_skeleton_test_utils";
import {
  expectSegmentList,
  getAllCurrentlyLoadedMeshIds,
  getPositionForSegmentId,
  initializeMappingAndTool,
  loadAgglomerateMeshes,
  makeMappingEditableForTest,
  mockEdgesForPartitionedAgglomerateMinCut,
  mockInitialBucketAndAgglomerateData,
  performCutFromAllNeighbours,
  prepareGetNeighborsForAgglomerateNode,
  simulatePartitionedSplitAgglomeratesViaMeshes,
} from "./proofreading_test_utils";

describe("Proofreading (with auxiliary mesh loading enabled)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  function* trackRemovedMeshActions(): Saga<[Set<number>, Task<any>]> {
    const removedMeshes = new Set<number>();
    function handleRemoveMesh(action: RemoveMeshAction) {
      if ("segmentId" in action) {
        removedMeshes.add(action.segmentId);
      }
    }
    const forkedEffect = (yield* takeEvery("REMOVE_MESH", handleRemoveMesh)) as Task<any>;
    return [removedMeshes, forkedEffect];
  }

  function* trackAddedMeshActions(): Saga<[Set<number>, Task<any>]> {
    const addedMeshes = new Set<number>();
    function handleAddedMesh(action: FinishedLoadingMeshAction) {
      if ("segmentId" in action) {
        addedMeshes.add(action.segmentId);
      }
    }
    const forkedEffect = (yield* takeEvery("FINISHED_LOADING_MESH", handleAddedMesh)) as Task<any>;
    return [addedMeshes, forkedEffect];
  }

  describe.each([false, true])("With othersMayEdit=%s", (othersMayEdit: boolean) => {
    it("should load auxiliary meshes", async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const task = startSaga(function* task(): Saga<void> {
        const { tracingId } = yield* select(
          (state: WebknossosState) => state.annotation.volumes[0],
        );
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setCollaborationModeAction(othersMayEdit ? "Concurrent" : "OwnerOnly"));
        }

        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield loadAgglomerateMeshes([1]);
        const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
        expect([...loadedMeshIds]).toEqual([1]);
      });
      await task.toPromise();
    });

    it("should reload auxiliary meshes after merge", async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const task = startSaga(function* task(): Saga<void> {
        const { tracingId } = yield* select(
          (state: WebknossosState) => state.annotation.volumes[0],
        );
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setCollaborationModeAction(othersMayEdit ? "Concurrent" : "OwnerOnly"));
        }

        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield loadAgglomerateMeshes([1, 6]);

        yield put(
          updateSegmentAction(1, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1));
        // Give mesh loading a little time
        const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
        expect(sortBy([...loadedMeshIds])).toEqual([1, 6]);
        yield loadAgglomerateMeshes([4]);

        const loadedMeshIds2 = getAllCurrentlyLoadedMeshIds(context, tracingId);
        expect(sortBy([...loadedMeshIds2])).toEqual([1, 4, 6]);

        // Execute the actual merge and wait for the finished mapping.
        const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
        const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
        yield put(proofreadMergeAction(getPositionForSegmentId(4), 4));
        yield take(
          ((action: Action) =>
            action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
            !action.value.isBusy) as ActionPattern,
        );
        yield take(
          ((action: Action) =>
            action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1) as ActionPattern,
        );
        // Wait so that the addedMeshes listener has a 100% chance
        // to register that mesh with id 1 was added.
        yield delay(1);

        const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
        expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6]);
        expect(sortBy([...removedMeshes])).toEqual([1, 4]);
        expect([...addedMeshes]).toEqual([1]);
        yield cancel(forkedEffect1);
        yield cancel(forkedEffect2);
        yield expectSegmentList(tracingId, [
          {
            id: 1,
            anchorPosition: [1, 1, 1],
          },
          {
            id: 6,
            anchorPosition: [6, 6, 6],
          },
        ]);
      });
      await task.toPromise();
    });

    it("should reload auxiliary meshes after split", async (context: WebknossosTestContext) => {
      const { mocks } = context;
      const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

      const task = startSaga(function* task(): Saga<void> {
        const { tracingId } = yield* select(
          (state: WebknossosState) => state.annotation.volumes[0],
        );
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setCollaborationModeAction(othersMayEdit ? "Concurrent" : "OwnerOnly"));
        }
        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield loadAgglomerateMeshes([1, 4]);

        yield put(
          updateSegmentAction(1, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1));
        // Give mesh loading a little time
        const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
        expect(sortBy([...loadedMeshIds])).toEqual([1, 4]);

        // Prepare the server's reply for the upcoming split.
        vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
          Promise.resolve([
            {
              position1: getPositionForSegmentId(1),
              position2: getPositionForSegmentId(2),
              segmentId1: 1,
              segmentId2: 2,
            },
          ]),
        );

        // Execute the actual merge and wait for the finished mapping.
        const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
        const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
        // Execute the split and wait for the auxiliary meshes being reloaded properly.
        yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2, 1));
        yield take(
          ((action: Action) =>
            action.type === "SET_BUSY_BLOCKING_INFO_ACTION" &&
            !action.value.isBusy) as ActionPattern,
        );
        yield take(
          ((action: Action) =>
            action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1339) as ActionPattern,
        );
        // Wait so that the addedMeshes listener has a 100% chance
        // to register that mesh with id 1339 was added.
        yield delay(1);

        const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
        expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 1339]);
        expect(sortBy([...removedMeshes])).toEqual([1, 1339]); // Although 1339 is not loaded it is tried to be removed by the proofreading saga to refresh it.
        expect(sortBy([...addedMeshes])).toEqual([1, 1339]);
        yield cancel(forkedEffect1);
        yield cancel(forkedEffect2);
        yield expectSegmentList(tracingId, [
          {
            id: 1,
            anchorPosition: [1, 1, 1],
          },
          {
            id: 4,
            anchorPosition: [4, 4, 4],
          },
          {
            id: 1339,
            anchorPosition: [2, 2, 2],
          },
        ]);
      });
      await task.toPromise();
    });
  });

  it("should reload auxiliary meshes after applying foreign merge action (no rebase)", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task(): Saga<void> {
      const { tracingId } = yield* select((state: WebknossosState) => state.annotation.volumes[0]);
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      yield loadAgglomerateMeshes([1, 4, 6]);
      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect([...loadedMeshIds]).toEqual([1, 4, 6]);

      // After the meshes are loaded simulate a user making a merge.
      backendMock.planMultipleVersionInjections(4, mergeSegment5And6);

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      // And now load that merge.
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 4) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 4 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4]);
      expect(sortBy([...removedMeshes])).toEqual([4, 6]);
      expect(sortBy([...addedMeshes])).toEqual([4]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
      yield expectSegmentList(tracingId, [
        {
          id: 4,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should reload auxiliary meshes after applying foreign split action (no rebase)", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task(): Saga<void> {
      const { tracingId } = yield* select((state: WebknossosState) => state.annotation.volumes[0]);
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      yield loadAgglomerateMeshes([1, 4, 6]);
      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect([...loadedMeshIds]).toEqual([1, 4, 6]);

      // After the meshes are loaded simulate a user making a split.
      backendMock.planMultipleVersionInjections(4, splitSegment2And3);

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      // And now load that merge.
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339]);
      expect(sortBy([...removedMeshes])).toEqual([1, 1339]);
      expect(sortBy([...addedMeshes])).toEqual([1, 1339]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
      // As the agglomerate meshes were loaded they were added to the segment list.
      // These segment list changes however are not sent to the server yet. Enforce this
      // so that local segment list and the segment list mocked in the backend are equal to use expectSegmentList.
      yield call(() => context.api.tracing.save());
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 4,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when merging agglomerates and incorporating an interfering merge action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(9, mergeSegment5And6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1));

      yield makeMappingEditableForTest();

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      yield put(
        proofreadMergeAction(
          getPositionForSegmentId(4), // unmappedId=4 / mappedId=4 at this position
          4, // unmappedId=4 maps to 4
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1]);
      expect(sortBy([...removedMeshes])).toEqual([1, 4, 6]);
      expect(sortBy([...addedMeshes])).toEqual([1]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when merging agglomerates and incorporating an interfering split action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(9, splitSegment2And3);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1));

      yield makeMappingEditableForTest();

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      yield put(
        proofreadMergeAction(
          getPositionForSegmentId(4), // unmappedId=4 / mappedId=4 at this position
          4, // unmappedId=4 maps to 4
        ),
      );
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1339) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1339 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6, 1339]);
      expect(sortBy([...removedMeshes])).toEqual([1, 4, 1339]);
      expect(sortBy([...addedMeshes])).toEqual([1, 1339]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 6,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when splitting agglomerates and incorporating an interfering merge action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(9, mergeSegment1And4);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableForTest();

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: getPositionForSegmentId(1),
            position2: getPositionForSegmentId(2),
            segmentId1: 1,
            segmentId2: 2,
          },
        ]),
      );

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2, 1));
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1339) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1339 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6, 1339]);
      expect(sortBy([...removedMeshes])).toEqual([1, 4, 1339]);
      expect(sortBy([...addedMeshes])).toEqual([1, 1339]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 6,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339,
          anchorPosition: [2, 2, 2],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when splitting agglomerates and incorporating an interfering split action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(9, splitSegment2And3);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableForTest();

      // Prepare the server's reply for the upcoming split.
      vi.mocked(context.mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: getPositionForSegmentId(1),
            position2: getPositionForSegmentId(2),
            segmentId1: 1,
            segmentId2: 2,
          },
        ]),
      );

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2, 1));
      yield take("FINISH_MAPPING_INITIALIZATION");
      // Loading meshes 1, 1339, 1340.
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1340) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1340 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
      expect(sortBy([...removedMeshes])).toEqual([1, 1339, 1340]);
      expect(sortBy([...addedMeshes])).toEqual([1, 1339, 1340]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 4,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 1340,
          anchorPosition: [2, 2, 2],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should reload auxiliary proofreading meshes correctly when cutting agglomerate from all neighbors", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { mocks } = context;
    prepareGetNeighborsForAgglomerateNode(mocks, 9, true);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performCutFromAllNeighbours(context, tracingId, true);

      // First check mapping
      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1],
          [3, 1340],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1340) as ActionPattern,
      );

      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [2, 2, 2],
        },
        {
          id: 4,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 1340,
          anchorPosition: [3, 3, 3],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should reload auxiliary proofreading meshes correctly when cutting agglomerate from all neighbors after incorporating a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { mocks } = context;
    prepareGetNeighborsForAgglomerateNode(mocks, 9, false);

    backendMock.planMultipleVersionInjections(10, splitSegment1And2);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performCutFromAllNeighbours(context, tracingId, true);

      // First check mapping
      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1339],
          [3, 1340],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1) as ActionPattern,
      );

      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 4,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339,
          anchorPosition: [2, 2, 2],
        },
        {
          id: 1340,
          anchorPosition: [3, 3, 3],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should reload agglomerate meshes correctly when merging two agglomerate skeletons and incorporating a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Merging agglomerates 4 & 6 based on the segments 5 & 6.
    // As agglomerate trees 1 & 4 are loaded their updates are included as well
    backendMock.planMultipleVersionInjections(11, mergeSegment5And6WithAgglomerateTree1And4);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = false;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, true);

      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 1],
          [5, 1],
          [6, 1],
          [7, 1],
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1) as ActionPattern,
      );

      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1]);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [3, 3, 3],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should reload auxiliary proofreading meshes when splitting agglomerate skeleton and incorporating a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(10, splitSegment1And2WithAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, true);
      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1339],
          [3, 1340],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1) as ActionPattern,
      );
      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 4,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339,
          anchorPosition: [2, 2, 2],
        },
        {
          id: 1340,
          anchorPosition: [3, 3, 3],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should min cut agglomerate via node ids and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    // Additional edge to create agglomerate 1 with edges 1-2,2-3,1-3 to enforce cut with multiple edges.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1, 3]], Store.getState());
    // Mock backend answer telling saga to split edges 3-2 and 3-1.
    mockEdgesForAgglomerateMinCut(context.mocks, 12, [
      {
        position1: getPositionForSegmentId(3),
        position2: getPositionForSegmentId(1),
        segmentId1: 3,
        segmentId2: 1,
      } as MinCutTargetEdge,
    ]);

    backendMock.planMultipleVersionInjections(10, mergeSegment5And6WithAgglomerateTree1);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, true);
      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 4 and 6 were merged and then agglomerate 1 was split between segment 2 and 3.
      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1],
          [4, 4],
          [5, 4],
          [6, 4],
          [7, 4],
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 4) as ActionPattern,
      );
      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 1339]);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 4,
          anchorPosition: [5, 5, 5],
        },
        {
          id: 1339,
          anchorPosition: [2, 2, 2],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should reload auxiliary proofreading meshes when performing partitioned min cut if min-cutted edges with outdated edge info due to interfering merge operations. The merge is thus, incomplete.", async (context: WebknossosTestContext) => {
    const { mocks } = context;
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
        [1, 1338],
        [3, 1337],
      ],
      Store.getState(),
    );

    // Mapping after interference should be
    // [[1, 1],
    //  [2, 1],
    //  [3, 1],
    //  [4, 1],
    //  [5, 1],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 1],
    //  [1338, 1]]
    // Contains two circles now but only one is split by the min-cut request.
    backendMock.planMultipleVersionInjections(9, mergeSegment1And4);

    // An intentional cycle within agglomerate 1 is created here by adding the edge 1337 -> 5.
    // This means there is no createSegment action but an updateSegmentPartial and the agglomerate ids
    // in the merge actions are identical.
    backendMock.planMultipleVersionInjections(12, [
      [
        {
          name: "updateSegmentPartial" as const,
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            id: 1,
            anchorPosition: getPositionForSegmentId(1337),
          },
        },
      ],
      [
        // This action intentionally creates a cycle in the agglomerate.
        {
          name: "mergeAgglomerate" as const,
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId1: 1,
            agglomerateId2: 1,
            segmentId1: 1337,
            segmentId2: 5,
          },
        },
      ],
      [
        {
          name: "mergeSegmentItems" as const,
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId1: 1,
            agglomerateId2: 1,
            segmentId1: 1337,
            segmentId2: 5,
          },
        },
      ],
    ]);

    mockEdgesForPartitionedAgglomerateMinCut(mocks, 8);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield simulatePartitionedSplitAgglomeratesViaMeshes(context, true);

      const finalMapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 1],
          [5, 1],
          [6, 6],
          [7, 6],
          [1337, 1], // Loaded as this segment is part of a split proofreading action done in this test.
          [1338, 1], // Loaded as this segment is part of a split proofreading action done in this test.
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1) as ActionPattern,
      );
      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6]);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 6,
          anchorPosition: [6, 6, 6],
        },
      ]);
    });
    await task.toPromise();
  });
});
