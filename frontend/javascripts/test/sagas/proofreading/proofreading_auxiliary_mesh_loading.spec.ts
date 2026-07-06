import type { ActionPattern, Task } from "@redux-saga/types";
import type { MinCutTargetEdge } from "admin/rest_api";
import sortBy from "lodash-es/sortBy";
import { all, call, put, race, take } from "redux-saga/effects";
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_server_objects";
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { actionChannel, cancel, delay, takeEvery } from "typed-redux-saga";
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
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";
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
  operationFinished,
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

  function* trackRemovedMeshActions(): Saga<[Set<bigint>, Task<any>]> {
    const removedMeshes = new Set<bigint>();
    function handleRemoveMesh(action: RemoveMeshAction) {
      if ("segmentId" in action) {
        removedMeshes.add(action.segmentId);
      }
    }
    const forkedEffect = (yield* takeEvery("REMOVE_MESH", handleRemoveMesh)) as Task<any>;
    return [removedMeshes, forkedEffect];
  }

  function* trackAddedMeshActions(): Saga<[Set<bigint>, Task<any>]> {
    const addedMeshes = new Set<bigint>();
    function handleAddedMesh(action: FinishedLoadingMeshAction) {
      if ("segmentId" in action) {
        addedMeshes.add(action.segmentId);
      }
    }
    const forkedEffect = (yield* takeEvery("FINISHED_LOADING_MESH", handleAddedMesh)) as Task<any>;
    return [addedMeshes, forkedEffect];
  }

  function* trackMeshes(context: WebknossosTestContext, tracingId: string) {
    const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
    const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
    const channel = yield* actionChannel("FINISHED_LOADING_MESH");

    const consumeFinishedLoadingActions = function* (n: number): Saga<void> {
      const takes = Array.from({ length: n }, () => take(channel));
      const result = yield race({
        meshes: all(takes),
        timeout: delay(2000),
      });
      if (result.timeout) {
        console.warn(`Timeout waiting for ${n} meshes to load`);
      }
      // Also wait so that the addedMeshes listener has a good chance to have fired.
      yield delay(1);
    };

    const cleanUp = function* (): Saga<void> {
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
      channel.close();
    };

    const getMeshInfos = () => ({
      removedMeshes,
      addedMeshes,
      loadedMeshIds: getAllCurrentlyLoadedMeshIds(context, tracingId),
    });

    return {
      consumeFinishedLoadingActions,
      cleanUp,
      getMeshInfos,
    };
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
        expect([...loadedMeshIds]).toEqual([1n]);
      });
      await task.toPromise();
    });

    it(
      "should reload auxiliary meshes after merge",
      { retry: { count: 3, delay: 10 } },
      async (context: WebknossosTestContext) => {
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
            updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
          );
          yield put(setActiveCellAction(1n));
          // Give mesh loading a little time
          const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
          expect(sortBy([...loadedMeshIds])).toEqual([1n, 6n]);
          yield loadAgglomerateMeshes([4]);

          const loadedMeshIds2 = getAllCurrentlyLoadedMeshIds(context, tracingId);
          expect(sortBy([...loadedMeshIds2])).toEqual([1n, 4n, 6n]);

          // Execute the actual merge and wait for the finished mapping.
          const meshTracker = yield* trackMeshes(context, tracingId);
          yield put(proofreadMergeAction(getPositionForSegmentId(4), 4n));
          yield take(operationFinished("PROOFREADING")); // operation finished
          yield meshTracker.consumeFinishedLoadingActions(1);

          const {
            removedMeshes,
            addedMeshes,
            loadedMeshIds: loadedMeshIdsAfterMerge,
          } = meshTracker.getMeshInfos();
          expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 6n]);
          expect(sortBy([...removedMeshes])).toEqual([1n, 4n]);
          expect([...addedMeshes]).toEqual([1n]);
          yield* meshTracker.cleanUp();
          yield expectSegmentList(tracingId, [
            {
              id: 1n,
              anchorPosition: [1, 1, 1],
            },
            {
              id: 6n,
              anchorPosition: [6, 6, 6],
            },
          ]);
        });
        await task.toPromise();
      },
    );

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
          updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId),
        );
        yield put(setActiveCellAction(1n));
        // Give mesh loading a little time
        const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
        expect(sortBy([...loadedMeshIds])).toEqual([1n, 4n]);

        // Prepare the server's reply for the upcoming split.
        vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
          Promise.resolve([
            {
              position1: getPositionForSegmentId(1),
              position2: getPositionForSegmentId(2),
              segmentId1: 1n,
              segmentId2: 2n,
            },
          ]),
        );

        // Execute the actual merge and wait for the finished mapping.
        const meshTracker = yield* trackMeshes(context, tracingId);
        // Execute the split and wait for the auxiliary meshes being reloaded properly.
        yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2n, 1n));
        yield take(operationFinished("PROOFREADING")); // operation finished
        yield* meshTracker.consumeFinishedLoadingActions(2);

        const {
          removedMeshes,
          addedMeshes,
          loadedMeshIds: loadedMeshIdsAfterMerge,
        } = meshTracker.getMeshInfos();
        expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 4n, 1339n]);
        expect(sortBy([...removedMeshes])).toEqual([1n, 1339n]); // Although 1339 is not loaded it is tried to be removed by the proofreading saga to refresh it.
        expect(sortBy([...addedMeshes])).toEqual([1n, 1339n]);
        yield* meshTracker.cleanUp();
        yield expectSegmentList(tracingId, [
          {
            id: 1n,
            anchorPosition: [1, 1, 1],
          },
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
  });

  it("should reload auxiliary meshes after applying foreign merge action (no rebase)", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const task = startSaga(function* task(): Saga<void> {
      const { tracingId } = yield* select((state: WebknossosState) => state.annotation.volumes[0]);
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      yield loadAgglomerateMeshes([1, 4, 6]);
      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect([...loadedMeshIds]).toEqual([1n, 4n, 6n]);

      // After the meshes are loaded simulate a user making a merge.
      backendMock.planMultipleVersionInjections(
        4,
        mergeSegment5And6 as unknown as UpdateActionWithoutIsolationRequirement[][],
      );

      const meshTracker = yield* trackMeshes(context, tracingId);
      // And now load that merge.
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield meshTracker.consumeFinishedLoadingActions(1);

      const {
        removedMeshes,
        addedMeshes,
        loadedMeshIds: loadedMeshIdsAfterMerge,
      } = meshTracker.getMeshInfos();
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 4n]);
      expect(sortBy([...removedMeshes])).toEqual([4n, 6n]);
      expect(sortBy([...addedMeshes])).toEqual([4n]);
      yield* meshTracker.cleanUp();
      yield expectSegmentList(tracingId, [
        {
          id: 4n,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1n,
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
      expect([...loadedMeshIds]).toEqual([1n, 4n, 6n]);

      // After the meshes are loaded simulate a user making a split.
      backendMock.planMultipleVersionInjections(
        4,
        splitSegment2And3 as unknown as UpdateActionWithoutIsolationRequirement[][],
      );

      const meshTracker = yield* trackMeshes(context, tracingId);
      // And now load that merge.
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield meshTracker.consumeFinishedLoadingActions(2);

      const {
        removedMeshes,
        addedMeshes,
        loadedMeshIds: loadedMeshIdsAfterMerge,
      } = meshTracker.getMeshInfos();
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 4n, 6n, 1339n]);
      expect(sortBy([...removedMeshes])).toEqual([1n, 1339n]);
      expect(sortBy([...addedMeshes])).toEqual([1n, 1339n]);
      yield* meshTracker.cleanUp();
      // As the agglomerate meshes were loaded they were added to the segment list.
      // These segment list changes however are not sent to the server yet. Enforce this
      // so that local segment list and the segment list mocked in the backend are equal to use expectSegmentList.
      yield call(() => context.api.tracing.save());
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 4n,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6n,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339n,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when merging agglomerates and incorporating an interfering merge action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(
      9,
      mergeSegment5And6 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIds])).toEqual([1n, 4n, 6n]);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));

      yield makeMappingEditableForTest();

      const meshTracker = yield* trackMeshes(context, tracingId);
      yield put(
        proofreadMergeAction(
          getPositionForSegmentId(4), // unmappedId=4 / mappedId=4 at this position
          4n, // unmappedId=4 maps to 4
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield meshTracker.consumeFinishedLoadingActions(1);

      const {
        removedMeshes,
        addedMeshes,
        loadedMeshIds: loadedMeshIdsAfterMerge,
      } = meshTracker.getMeshInfos();
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n]);
      expect(sortBy([...removedMeshes])).toEqual([1n, 4n, 6n]);
      expect(sortBy([...addedMeshes])).toEqual([1n]);
      yield* meshTracker.cleanUp();
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when merging agglomerates and incorporating an interfering split action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(
      9,
      splitSegment2And3 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIds])).toEqual([1n, 4n, 6n]);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));

      yield makeMappingEditableForTest();

      const meshTracker = yield* trackMeshes(context, tracingId);
      yield put(
        proofreadMergeAction(
          getPositionForSegmentId(4), // unmappedId=4 / mappedId=4 at this position
          4n, // unmappedId=4 maps to 4
        ),
      );
      yield* meshTracker.consumeFinishedLoadingActions(2);

      const {
        removedMeshes,
        addedMeshes,
        loadedMeshIds: loadedMeshIdsAfterMerge,
      } = meshTracker.getMeshInfos();
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 6n, 1339n]);
      expect(sortBy([...removedMeshes])).toEqual([1n, 4n, 1339n]);
      expect(sortBy([...addedMeshes])).toEqual([1n, 1339n]);
      yield* meshTracker.cleanUp();
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 6n,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339n,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when splitting agglomerates and incorporating an interfering merge action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(
      9,
      mergeSegment1And4 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIds])).toEqual([1n, 4n, 6n]);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();

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

      const meshTracker = yield* trackMeshes(context, tracingId);
      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2n, 1n));
      yield* meshTracker.consumeFinishedLoadingActions(2);

      const {
        removedMeshes,
        addedMeshes,
        loadedMeshIds: loadedMeshIdsAfterMerge,
      } = meshTracker.getMeshInfos();
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 6n, 1339n]);
      expect(sortBy([...removedMeshes])).toEqual([1n, 4n, 1339n]);
      expect(sortBy([...addedMeshes])).toEqual([1n, 1339n]);
      yield* meshTracker.cleanUp();
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 6n,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339n,
          anchorPosition: [2, 2, 2],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when splitting agglomerates and incorporating an interfering split action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(
      9,
      splitSegment2And3 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIds])).toEqual([1n, 4n, 6n]);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));
      yield makeMappingEditableForTest();

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

      const meshTracker = yield* trackMeshes(context, tracingId);
      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2n, 1n));
      yield take("FINISH_MAPPING_INITIALIZATION");
      // Loading meshes 1, 1339, 1340.
      yield* meshTracker.consumeFinishedLoadingActions(3);

      const {
        removedMeshes,
        addedMeshes,
        loadedMeshIds: loadedMeshIdsAfterMerge,
      } = meshTracker.getMeshInfos();
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 4n, 6n, 1339n, 1340n]);
      expect(sortBy([...removedMeshes])).toEqual([1n, 1339n, 1340n]);
      expect(sortBy([...addedMeshes])).toEqual([1n, 1339n, 1340n]);
      yield* meshTracker.cleanUp();
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 4n,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6n,
          anchorPosition: [6, 6, 6],
        },
        {
          id: 1339n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 1340n,
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
          [1n, 1339n],
          [2n, 1n],
          [3n, 1340n],
          [4n, 4n],
          [5n, 4n],
          [6n, 6n],
          [7n, 6n],
        ]),
      );
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1340n) as ActionPattern,
      );

      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 4n, 6n, 1339n, 1340n]);
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [2, 2, 2],
        },
        {
          id: 4n,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6n,
          anchorPosition: [6, 6, 6],
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

  it("should reload auxiliary proofreading meshes correctly when cutting agglomerate from all neighbors after incorporating a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { mocks } = context;
    prepareGetNeighborsForAgglomerateNode(mocks, 9, false);

    backendMock.planMultipleVersionInjections(
      10,
      splitSegment1And2 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

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
          [1n, 1n],
          [2n, 1339n],
          [3n, 1340n],
          [4n, 4n],
          [5n, 4n],
          [6n, 6n],
          [7n, 6n],
        ]),
      );
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1n) as ActionPattern,
      );

      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 4n, 6n, 1339n, 1340n]);
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 4n,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6n,
          anchorPosition: [6, 6, 6],
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

  it("should reload agglomerate meshes correctly when merging two agglomerate trees and incorporating a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Merging agglomerates 4 & 6 based on the segments 5 & 6.
    // As agglomerate trees 1 & 4 are loaded their updates are included as well
    backendMock.planMultipleVersionInjections(
      11,
      mergeSegment5And6WithAgglomerateTree1And4 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

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
          [1n, 1n],
          [2n, 1n],
          [3n, 1n],
          [4n, 1n],
          [5n, 1n],
          [6n, 1n],
          [7n, 1n],
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1n) as ActionPattern,
      );

      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n]);
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [3, 3, 3],
        },
      ]);
    });
    await task.toPromise();
  });

  it("should reload auxiliary proofreading meshes when splitting agglomerate tree and incorporating a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(
      10,
      splitSegment1And2WithAgglomerateTree1 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

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
          [1n, 1n],
          [2n, 1339n],
          [3n, 1340n],
          [4n, 4n],
          [5n, 4n],
          [6n, 6n],
          [7n, 6n],
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1n) as ActionPattern,
      );
      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 4n, 6n, 1339n, 1340n]);
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 4n,
          anchorPosition: [4, 4, 4],
        },
        {
          id: 6n,
          anchorPosition: [6, 6, 6],
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

  it("should min cut agglomerate via node ids and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    // Additional edge to create agglomerate 1 with edges 1-2,2-3,1-3 to enforce cut with multiple edges.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1n, 3n]], Store.getState());
    // Mock backend answer telling saga to split edges 3-2 and 3-1.
    mockEdgesForAgglomerateMinCut(context.mocks, 12, [
      {
        position1: getPositionForSegmentId(3),
        position2: getPositionForSegmentId(1),
        segmentId1: 3n,
        segmentId2: 1n,
      } as MinCutTargetEdge,
    ]);

    backendMock.planMultipleVersionInjections(
      10,
      mergeSegment5And6WithAgglomerateTree1 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

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
          [1n, 1339n],
          [2n, 1339n],
          [3n, 1n],
          [4n, 4n],
          [5n, 4n],
          [6n, 4n],
          [7n, 4n],
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 4n) as ActionPattern,
      );
      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 4n, 1339n]);
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 4n,
          anchorPosition: [5, 5, 5],
        },
        {
          id: 1339n,
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
        [1n, 1338n],
        [3n, 1337n],
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
    backendMock.planMultipleVersionInjections(
      9,
      mergeSegment1And4 as unknown as UpdateActionWithoutIsolationRequirement[][],
    );

    // An intentional cycle within agglomerate 1 is created here by adding the edge 1337 -> 5.
    // This means there is no createSegment action but an updateSegmentPartial and the agglomerate ids
    // in the merge actions are identical.
    backendMock.planMultipleVersionInjections(12, [
      [
        {
          name: "updateSegmentPartial" as const,
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            id: 1n,
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
            agglomerateId1: 1n,
            agglomerateId2: 1n,
            segmentId1: 1337n,
            segmentId2: 5n,
          },
        },
      ],
      [
        {
          name: "mergeSegmentItems" as const,
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            agglomerateId1: 1n,
            agglomerateId2: 1n,
            segmentId1: 1337n,
            segmentId2: 5n,
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
          [1n, 1n],
          [2n, 1n],
          [3n, 1n],
          [4n, 1n],
          [5n, 1n],
          [6n, 6n],
          [7n, 6n],
          [1337n, 1n], // Loaded as this segment is part of a split proofreading action done in this test.
          [1338n, 1n], // Loaded as this segment is part of a split proofreading action done in this test.
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1n) as ActionPattern,
      );
      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context, tracingId);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1n, 6n]);
      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 6n,
          anchorPosition: [6, 6, 6],
        },
      ]);
    });
    await task.toPromise();
  });
});
