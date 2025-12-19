import { call, put, take } from "redux-saga/effects";
import { type WebknossosTestContext, setupWebknossosForTesting } from "test/helpers/apiHelpers";
import { WkDevFlags } from "viewer/api/wk_dev";
import {
  minCutAgglomerateWithPositionAction,
  proofreadAtPosition,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { type Saga, select } from "viewer/model/sagas/effect-generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { type WebknossosState, startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeMappingAndTool,
  makeMappingEditableHelper,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import { cancel, takeEvery } from "typed-redux-saga";
import {
  setOthersMayEditForAnnotationAction,
  type FinishedLoadingMeshAction,
  type RemoveMeshAction,
} from "viewer/model/actions/annotation_actions";
import type { Task } from "@redux-saga/types";
import { Store } from "viewer/singletons";
import _ from "lodash";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";

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

  function getAllCurrentlyLoadedMeshIds(context: WebknossosTestContext) {
    const loadedMeshIds = new Set();
    for (const layerName of Object.keys(context.segmentLodGroups)) {
      for (const lodGroup of context.segmentLodGroups[layerName].children) {
        for (const meshGroup of lodGroup.children) {
          if ("segmentId" in meshGroup) {
            loadedMeshIds.add(meshGroup.segmentId);
          }
        }
      }
    }
    return loadedMeshIds;
  }

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

  function* loadAgglomerateMeshes(agglomerateIds: number[]): Saga<void> {
    for (const id of agglomerateIds) {
      yield put(proofreadAtPosition([id, id, id]));
      yield take("FINISHED_LOADING_MESH");
    }
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
        expect(_.sortBy([...loadedMeshIds])).toEqual([1, 6]);
        yield loadAgglomerateMeshes([4]);

        const loadedMeshIds2 = getAllCurrentlyLoadedMeshIds(context);
        expect(_.sortBy([...loadedMeshIds2])).toEqual([1, 4, 6]);

        // Execute the actual merge and wait for the finished mapping.
        const [removedMeshes, forkedEffect1] = yield* trackRemovedMeshActions();
        const [addedMeshes, forkedEffect2] = yield* trackAddedMeshActions();
        yield put(proofreadMergeAction([4, 4, 4], 1));
        yield take("FINISH_MAPPING_INITIALIZATION");

        yield take("FINISHED_LOADING_MESH");
        const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
        expect(_.sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6]);
        expect(_.sortBy([...removedMeshes])).toEqual([1, 4]);
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
        expect(_.sortBy([...loadedMeshIds])).toEqual([1, 4]);

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
        yield take("FINISH_MAPPING_INITIALIZATION");
        yield take("FINISHED_LOADING_MESH");
        yield take("FINISHED_LOADING_MESH");

        const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
        expect(_.sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 1339]);
        expect(_.sortBy([...removedMeshes])).toEqual([1, 1339]); // Although 1339 is not loaded it is tried to be removed by the proofreading saga to refresh it.
        expect(_.sortBy([...addedMeshes])).toEqual([1, 1339]);
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
      yield take("FINISHED_LOADING_MESH");

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(_.sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4]);
      expect(_.sortBy([...removedMeshes])).toEqual([4, 6]);
      expect(_.sortBy([...addedMeshes])).toEqual([4]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });
    await task.toPromise();
  });

  //---------------------------------------------------------------------------------
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
      yield take("FINISHED_LOADING_MESH");
      yield take("FINISHED_LOADING_MESH");

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(_.sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339]);
      expect(_.sortBy([...removedMeshes])).toEqual([1, 1339]);
      expect(_.sortBy([...addedMeshes])).toEqual([1, 1339]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });
    await task.toPromise();
  });
  //---------------------------------------------------------------------------------

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
      expect(_.sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

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
      yield take("FINISHED_LOADING_MESH");

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(_.sortBy([...loadedMeshIdsAfterMerge])).toEqual([1]);
      expect(_.sortBy([...removedMeshes])).toEqual([1, 4, 6]);
      expect(_.sortBy([...addedMeshes])).toEqual([1]);
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
      expect(_.sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

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
      yield take("FINISHED_LOADING_MESH");
      yield take("FINISHED_LOADING_MESH");

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(_.sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6, 1339]);
      expect(_.sortBy([...removedMeshes])).toEqual([1, 4, 1339]);
      expect(_.sortBy([...addedMeshes])).toEqual([1, 1339]);
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
      expect(_.sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

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
      yield take("FINISHED_LOADING_MESH");
      yield take("FINISHED_LOADING_MESH");

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(_.sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 6, 1339]);
      expect(_.sortBy([...removedMeshes])).toEqual([1, 4, 1339]); // TODOM: check why 1339 is removed. Maybe due to mesh assembling stuff?
      expect(_.sortBy([...addedMeshes])).toEqual([1, 1339]);
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
      expect(_.sortBy([...loadedMeshIds])).toEqual([1, 4, 6]);

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
      yield take("FINISHED_LOADING_MESH");
      yield take("FINISHED_LOADING_MESH");
      yield take("FINISHED_LOADING_MESH");

      const loadedMeshIdsAfterMerge = getAllCurrentlyLoadedMeshIds(context);
      expect(_.sortBy([...loadedMeshIdsAfterMerge])).toEqual([1, 4, 6, 1339, 1340]);
      expect(_.sortBy([...removedMeshes])).toEqual([1, 1339, 1340]); // TODOM: check why 1340 is removed. Maybe due to mesh assembling stuff?
      expect(_.sortBy([...addedMeshes])).toEqual([1, 1339, 1340]);
      yield cancel(forkedEffect1);
      yield cancel(forkedEffect2);
    });

    await task.toPromise();
  });
});
