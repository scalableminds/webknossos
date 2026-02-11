import type { ActionPattern, Task } from "@redux-saga/types";
import sortBy from "lodash-es/sortBy";
import { call, put, take } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { cancel, delay, takeEvery } from "typed-redux-saga";
import { WkDevFlags } from "viewer/api/wk_dev";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  type FinishedLoadingMeshAction,
  type RemoveMeshAction,
  setOthersMayEditForAnnotationAction,
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
import { type Saga, select } from "viewer/model/sagas/effect-generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga, type WebknossosState } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockEdgesForAgglomerateMinCut,
  performMergeTreesProofreading,
  performMinCutWithNodesProofreading,
  performSplitTreesProofreading,
} from "./proofreading_skeleton_test_utils";
import {
  getAllCurrentlyLoadedMeshIds,
  initializeMappingAndTool,
  loadAgglomerateMeshes,
  makeMappingEditableHelper,
  mockEdgesForPartitionedAgglomerateMinCut,
  mockInitialBucketAndAgglomerateData,
  performCutFromAllNeighbours,
  prepareGetNeighborsForAgglomerateNode,
  simulatePartitionedSplitAgglomeratesViaMeshes,
} from "./proofreading_test_utils";

describe("Proofreading (with auxiliary mesh loading enabled)", () => {
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
      const _backendMock = mockInitialBucketAndAgglomerateData(context);

      const task = startSaga(function* task(): Saga<void> {
        const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield loadAgglomerateMeshes([1]);
        const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
        expect([...loadedMeshIds]).toEqual([1]);
      });
      await task.toPromise();
    });

    it("should reload auxiliary meshes after merge", async (context: WebknossosTestContext) => {
      const _backendMock = mockInitialBucketAndAgglomerateData(context);

      const task = startSaga(function* task(): Saga<void> {
        const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }

        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield loadAgglomerateMeshes([1, 6]);

        yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1));
        // Give mesh loading a little time
        const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
        expect(sortBy([...loadedMeshIds])).toEqual([1, 6]);
        yield loadAgglomerateMeshes([4]);

        const loadedMeshIds2 = getAllCurrentlyLoadedMeshIds(context);
        expect(sortBy([...loadedMeshIds2])).toEqual([1, 4, 6]);

        // Execute the actual merge and wait for the finished mapping.
        const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
        const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
        yield put(proofreadMergeAction([4, 4, 4], 1));
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

        const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
        expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6]);
        expect(sortBy([...removedMeshes])).toEqual([1, 4]);
        expect([...addedMeshes]).toEqual([1]);
        yield cancel(forkedEffect1);
        yield cancel(forkedEffect2);
      });
      await task.toPromise();
    });

    it("should reload auxiliary meshes after split", async (context: WebknossosTestContext) => {
      const { mocks } = context;
      const _backendMock = mockInitialBucketAndAgglomerateData(context);

      const task = startSaga(function* task(): Saga<void> {
        const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
        yield call(initializeMappingAndTool, context, tracingId);
        if (othersMayEdit) {
          yield put(setOthersMayEditForAnnotationAction(true));
        }
        // Set up the merge-related segment partners. Normally, this would happen
        // due to the user's interactions.
        yield loadAgglomerateMeshes([1, 4]);

        yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
        yield put(setActiveCellAction(1));
        // Give mesh loading a little time
        const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
        expect(sortBy([...loadedMeshIds])).toEqual([1, 4]);

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

        // Execute the actual merge and wait for the finished mapping.
        const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
        const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
        // Execute the split and wait for the auxiliary meshes being reloaded properly.
        yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 1));
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

        const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
        expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 1339]);
        expect(sortBy([...removedMeshes])).toEqual([1, 1339]); // Although 1339 is not loaded it is tried to be removed by the proofreading saga to refresh it.
        expect(sortBy([...addedMeshes])).toEqual([1, 1339]);
        yield cancel(forkedEffect1);
        yield cancel(forkedEffect2);
      });
      await task.toPromise();
    });
  });

  it("should reload auxiliary meshes after applying foreign merge action (no rebase)", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task(): Saga<void> {
      const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setOthersMayEditForAnnotationAction(true));

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield loadAgglomerateMeshes([1, 4, 6]);
      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
      expect([...loadedMeshIds]).toEqual([1, 4, 6]);

      // After the meshes are loaded simulate a user making a merge.
      backendMock.injectVersion(
        [
          {
            name: "mergeAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 5,
              segmentId2: 6,
              agglomerateId1: 4,
              agglomerateId2: 6,
            },
          },
        ],
        4,
      );

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

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4]);
      expect(sortBy([...removedMeshes])).toEqual([4, 6]);
      expect(sortBy([...addedMeshes])).toEqual([4]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });
    await task.toPromise();
  });

  it("should reload auxiliary meshes after applying foreign split action (no rebase)", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    const task = startSaga(function* task(): Saga<void> {
      const { tracingId } = yield select((state: WebknossosState) => state.annotation.volumes[0]);
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setOthersMayEditForAnnotationAction(true));

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield loadAgglomerateMeshes([1, 4, 6]);
      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
      expect([...loadedMeshIds]).toEqual([1, 4, 6]);

      // After the meshes are loaded simulate a user making a split.
      backendMock.injectVersion(
        [
          {
            name: "splitAgglomerate",
            value: {
              actionTracingId: "volumeTracingId",
              segmentId1: 3,
              segmentId2: 2,
              agglomerateId: 1,
            },
          },
        ],
        4,
      );
      backendMock.injectVersion(
        [
          {
            name: "createSegment",
            value: {
              actionTracingId: "volumeTracingId",
              id: 1339,
              anchorPosition: [0, 0, 0],
              name: null,
              color: null,
              groupId: null,
              metadata: [],
              creationTime: 1494695001688,
            },
          },
        ],
        5,
      );

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

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339]);
      expect(sortBy([...removedMeshes])).toEqual([1, 1339]);
      expect(sortBy([...addedMeshes])).toEqual([1, 1339]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });
    await task.toPromise();
  });

  it("should load auxiliary meshes when merging agglomerates and incorporating an interfering merge action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(9, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 5,
          segmentId2: 6,
          agglomerateId1: 4,
          agglomerateId2: 6,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setOthersMayEditForAnnotationAction(true));

      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      yield makeMappingEditableHelper();

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1]);
      expect(sortBy([...removedMeshes])).toEqual([1, 4, 6]);
      expect(sortBy([...addedMeshes])).toEqual([1]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });

    await task.toPromise();
  });

  it("should load auxiliary meshes when merging agglomerates and incorporating an interfering split action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(9, [
      {
        name: "splitAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 3,
          segmentId2: 2,
          agglomerateId: 1,
        },
      },
    ]);
    backendMock.planVersionInjection(10, [
      {
        name: "createSegment",
        value: {
          actionTracingId: "volumeTracingId",
          id: 1339,
          anchorPosition: [0, 0, 0],
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

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setOthersMayEditForAnnotationAction(true));

      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      yield makeMappingEditableHelper();

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1339) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1339 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6, 1339]);
      expect(sortBy([...removedMeshes])).toEqual([1, 4, 1339]);
      expect(sortBy([...addedMeshes])).toEqual([1, 1339]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });

    await task.toPromise();
  });

  it("should load auxiliary meshes when splitting agglomerates and incorporating an interfering merge action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(9, [
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
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setOthersMayEditForAnnotationAction(true));

      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();

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

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 1));
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1339) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1339 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6, 1339]);
      expect(sortBy([...removedMeshes])).toEqual([1, 4, 1339]);
      expect(sortBy([...addedMeshes])).toEqual([1, 1339]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });

    await task.toPromise();
  });

  it("should load auxiliary meshes when splitting agglomerates and incorporating an interfering split action from the backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(9, [
      {
        name: "splitAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 3,
          segmentId2: 2,
          agglomerateId: 1,
        },
      },
    ]);
    backendMock.planVersionInjection(10, [
      {
        name: "createSegment",
        value: {
          actionTracingId: "volumeTracingId",
          id: 1339,
          anchorPosition: [0, 0, 0],
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

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setOthersMayEditForAnnotationAction(true));

      // Load all meshes for all affected agglomerate meshes and one more.
      yield loadAgglomerateMeshes([4, 6, 1]);

      const loadedMeshIds = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));
      yield makeMappingEditableHelper();

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

      const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
      const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction([2, 2, 2], 2, 1));
      yield take("FINISH_MAPPING_INITIALIZATION");
      // Loading meshes 1, 1339, 1340.
      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1340) as ActionPattern,
      );
      // Wait so that the addedMeshes listener has a 100% chance to register that mesh with id 1340 was added.
      yield delay(1);

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
      expect(sortBy([...removedMeshes])).toEqual([1, 1339, 1340]);
      expect(sortBy([...addedMeshes])).toEqual([1, 1339, 1340]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });

    await task.toPromise();
  });

  it("should reload auxiliary proofreading meshes correctly when cutting agglomerate from all neighbors", async (context: WebknossosTestContext) => {
    const _backendMock = mockInitialBucketAndAgglomerateData(context);
    const { mocks } = context;
    prepareGetNeighborsForAgglomerateNode(mocks, 9, true);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performCutFromAllNeighbours(context, tracingId, true);

      // First check mapping
      const finalMapping = yield select(
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
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
    });

    await task.toPromise();
  });

  it("should reload auxiliary proofreading meshes correctly when cutting agglomerate from all neighbors after incorporating a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    const { mocks } = context;
    prepareGetNeighborsForAgglomerateNode(mocks, 9, false);

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
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performCutFromAllNeighbours(context, tracingId, true);

      // First check mapping
      const finalMapping = yield select(
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
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1340) as ActionPattern,
      );

      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
    });

    await task.toPromise();
  });

  it("should reload agglomerate meshes correctly when merging two agglomerate skeletons and incorporating a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    // TODOM: skeleton updates are missing
    const injectedMerge = {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 5,
        segmentId2: 6,
        agglomerateId1: 4,
        agglomerateId2: 6,
      },
    };
    backendMock.planVersionInjection(11, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const shouldSaveAfterLoadingTrees = false;
      yield performMergeTreesProofreading(context, shouldSaveAfterLoadingTrees, true);

      const finalMapping = yield select(
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
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1]);
    });

    await task.toPromise();
  });

  it("should reload auxiliary proofreading meshes when splitting agglomerate skeleton and incorporating a new split action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);
    const injectedSplit = {
      name: "splitAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 1,
        segmentId2: 2,
        agglomerateId: 1,
      },
    };
    backendMock.planVersionInjection(10, [injectedSplit]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performSplitTreesProofreading(context, true);
      const finalMapping = yield select(
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
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1340) as ActionPattern,
      );
      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
    });

    await task.toPromise();
  }, 8000);

  it("should min cut agglomerate via node ids and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    // Additional edge to create agglomerate 1 with edges 1-2,2-3,1-3 to enforce cut with multiple edges.
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1, 3]]);
    // Mock backend answer telling saga to split edges 3-2 and 3-1.
    mockEdgesForAgglomerateMinCut(context.mocks, 9);

    const injectedMerge = {
      name: "mergeAgglomerate" as const,
      value: {
        actionTracingId: "volumeTracingId",
        segmentId1: 5,
        segmentId2: 6,
        agglomerateId1: 4,
        agglomerateId2: 6,
      },
    };
    backendMock.planVersionInjection(10, [injectedMerge]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performMinCutWithNodesProofreading(context, true);
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      // Agglomerate 4 and 6 were merged and then agglomerate 1 was splitted between segment 2 and 3.
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
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1339) as ActionPattern,
      );
      // Then check auxiliary meshes.
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 1339]);
    });

    await task.toPromise();
  }, 8000);

  it("should reload auxiliary proofreading meshes when performing partitioned min cut if min-cutted edges with outdated edge info due to interfering merge operations.", async (context: WebknossosTestContext) => {
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
    const backendMock = mockInitialBucketAndAgglomerateData(context, [
      [1, 1338],
      [3, 1337],
    ]);

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
    ]);

    backendMock.planVersionInjection(11, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 5,
          segmentId2: 1337,
          agglomerateId1: 1,
          agglomerateId2: 1,
        },
      },
    ]);

    mockEdgesForPartitionedAgglomerateMinCut(mocks, 9);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task(): Saga<void> {
      yield simulatePartitionedSplitAgglomeratesViaMeshes(context, true);

      const finalMapping = yield select(
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
      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6]);
    });

    await task.toPromise();
  });
});
