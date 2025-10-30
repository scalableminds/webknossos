import { actionChannel, call, flush, put, select, take } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  cutAgglomerateFromNeighborsAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { createEditableMapping } from "viewer/model/sagas/volume/proofread_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectedMappingAfterMerge,
  expectedMappingAfterMergeRebase,
  initialMapping,
} from "./proofreading_fixtures";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import { WkDevFlags } from "viewer/api/wk_dev";

describe("Proofreading (Multi User)", () => {
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

  it("should merge two agglomerates optimistically and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(5, [
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
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);
      yield put(setOthersMayEditForAnnotationAction(true));

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      yield call(createEditableMapping);

      // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping1).toEqual(initialMapping);
      // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
      // TODOM: Support integrating this action, if it originates from this user.
      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
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
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(expectedMappingAfterMergeRebase);
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerates optimistically and incorporate a new split action from backend", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(7, [
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

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
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

      yield call(createEditableMapping);
      // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping1).toEqual(initialMapping);
      // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
      // TODOM: Support integrating this action, if it originates from this user.
      yield put(setOthersMayEditForAnnotationAction(true));

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 4,
            agglomerateId1: 1339,
            agglomerateId2: 4,
          },
        },
      ]);
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1],
          [4, 1339],
          [5, 1339],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should cut agglomerate from all neighbors after incorporating a new merge action from backend", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(7, [
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
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(2, { somePosition: [2, 2, 2] }, tracingId));
      yield put(setActiveCellAction(2));

      yield call(createEditableMapping);
      // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping1).toEqual(initialMapping);
      // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
      // TODOM: Support integrating this action, if it originates from this user.
      yield put(setOthersMayEditForAnnotationAction(true));

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        cutAgglomerateFromNeighborsAction(
          [2, 2, 2], // unmappedId=2 / mappedId=2 at this position
        ),
      );
      yield take("DONE_SAVING");
      yield call(() => api.tracing.save());

      const splitSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(splitSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 2,
            segmentId2: 3,
            agglomerateId: 1339,
          },
        },
      ]);
      yield take("FINISH_MAPPING_INITIALIZATION");
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
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerates after incorporating a new merge action from backend", async (context: WebknossosTestContext) => {
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    backendMock.planVersionInjection(7, [
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
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(3, { somePosition: [3, 3, 3] }, tracingId));
      yield put(setActiveCellAction(3));

      yield call(createEditableMapping);
      // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping1).toEqual(initialMapping);
      // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
      // TODOM: Support integrating this action, if it originates from this user.
      yield put(setOthersMayEditForAnnotationAction(true));

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          3, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      yield take("DONE_SAVING");
      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 3,
            segmentId2: 4,
            agglomerateId1: 1339,
            agglomerateId2: 4,
          },
        },
      ]);
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1],
          [2, 1339],
          [3, 1339],
          [4, 1339],
          [5, 1339],
          [6, 6],
          [7, 6],
        ]),
      );
    });

    await task.toPromise();
  });

  it("should merge two agglomerates optimistically and incorporate a new merge action from backend referring to a not loaded segment", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context);

    /* Should lead to the following full mapping:
     * [[ 1, 1 ],
     *  [ 2, 1 ],
     *  [ 3, 1 ],
     *  [ 4, 1337 ],
     *  [ 5, 1337 ],
     *  [ 6, 6 ],
     *  [ 7, 6 ],
     *  [ 1337, 1337 ]
     *  [ 1338, 1337 ]]
     */
    backendMock.planVersionInjection(7, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1337,
          segmentId2: 5,
          agglomerateId1: 1337,
          agglomerateId2: 4,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(4, { somePosition: [4, 4, 4] }, tracingId));
      yield put(setActiveCellAction(4));

      yield call(createEditableMapping);
      // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping1).toEqual(initialMapping);
      // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
      // TODOM: Support integrating this action, if it originates from this user.
      yield put(setOthersMayEditForAnnotationAction(true));

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [1, 1, 1], // unmappedId=4 / mappedId=4 at this position
          4, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(
        new Map([
          [1, 4],
          [2, 4],
          [3, 4],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 4,
            segmentId2: 1,
            agglomerateId1: 1337,
            agglomerateId2: 1,
          },
        },
      ]);
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1337],
          [2, 1337],
          [3, 1337],
          [4, 1337],
          [5, 1337],
          [6, 6],
          [7, 6],
          // [1337, 1337], not loaded
          // [1338, 1337], not loaded
        ]),
      );
    });

    await task.toPromise();
  });

  it("should merge two agglomerates optimistically and incorporate new split and merge actions from backend referring to a not loaded segment", async (context: WebknossosTestContext) => {
    const { api } = context;

    /* Initial mapping should now be
     * [[ 1, 1 ],
     *  [ 2, 1 ],
     *  [ 3, 1 ],
     *  [ 4, 4 ],
     *  [ 5, 4 ],
     *  [ 6, 1337 ],
     *  [ 7, 1337 ],
     *  [ 1337, 1337 ],
     *  [ 1338, 1337 ]]
     */
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1337, 7]]);

    /* Should lead to the following full mapping:
     * [[ 1, 1 ],
     *  [ 2, 1 ],
     *  [ 3, 1 ],
     *  [ 4, 4 ],
     *  [ 5, 4 ],
     *  [ 6, 1337 ],
     *  [ 7, 1337 ],
     *  [ 1337, 1339 ],
     *  [ 1338, 1339 ]]
     */
    backendMock.planVersionInjection(7, [
      {
        name: "splitAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 7,
          segmentId2: 1337,
          agglomerateId: 1337,
        },
      },
    ]);

    /* Should lead to the following full mapping:
     * [[ 1, 1 ],
     *  [ 2, 1 ],
     *  [ 3, 1 ],
     *  [ 4, 1339 ],
     *  [ 5, 1339 ],
     *  [ 6, 1337 ],
     *  [ 7, 1337 ],
     *  [ 1337, 1339 ],
     *  [ 1338, 1339 ]]
     */
    backendMock.planVersionInjection(8, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1337,
          segmentId2: 5,
          agglomerateId1: 1339,
          agglomerateId2: 4,
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      const initialExpectedMapping = new Map([
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 4],
        [5, 4],
        [6, 1337],
        [7, 1337],
        // [1337, 1337], not loaded
      ]);
      expect(mapping0).toEqual(initialExpectedMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(4, { somePosition: [4, 4, 4] }, tracingId));
      yield put(setActiveCellAction(4));

      yield call(createEditableMapping);
      // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping1).toEqual(initialExpectedMapping);
      // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
      // TODOM: Support integrating this action, if it originates from this user.
      yield put(setOthersMayEditForAnnotationAction(true));

      // Execute the1339 actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [1, 1, 1], // unmappedId=4 / mappedId=4 at this position
          4, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mappingAfterOptimisticUpdate = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mappingAfterOptimisticUpdate).toEqual(
        new Map([
          [1, 4],
          [2, 4],
          [3, 4],
          [4, 4],
          [5, 4],
          [6, 1337],
          [7, 1337],
          // [1337, 1337], not loaded
        ]),
      );

      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 4,
            segmentId2: 1,
            agglomerateId1: 1339,
            agglomerateId2: 1,
          },
        },
      ]);
      const finalMapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(finalMapping).toEqual(
        new Map([
          [1, 1339],
          [2, 1339],
          [3, 1339],
          [4, 1339],
          [5, 1339],
          [6, 1337],
          [7, 1337],
          // [1337, 1339], not loaded
          // [1338, 1339], not loaded
        ]),
      );
    });

    await task.toPromise();
  });

  it("should merge two agglomerates optimistically and not trigger rebasing due to no incoming backend actions", async (context: WebknossosTestContext) => {
    const { api } = context;
    const _backendMock = mockInitialBucketAndAgglomerateData(context);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const rebaseActionChannel = yield actionChannel(["PREPARE_REBASING", "FINISHED_REBASING"]);

      yield call(initializeMappingAndTool, context, tracingId);
      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      yield call(createEditableMapping);
      yield put(setOthersMayEditForAnnotationAction(true));
      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
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
          // [1337, 1337], not loaded
          // [1338, 1337], not loaded
        ]),
      );

      // Asserting no rebasing relevant actions were triggered.
      const rebasingActions = yield flush(rebaseActionChannel);
      expect(rebasingActions.length).toBe(0);
    });

    await task.toPromise();
  }, 8000);
});
