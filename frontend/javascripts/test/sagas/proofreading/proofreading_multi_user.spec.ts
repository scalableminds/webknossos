// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  getFlattenedUpdateActions,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { type ActionPattern, actionChannel, call, flush, put, take } from "redux-saga/effects";
import { VOLUME_TRACING_ID } from "test/fixtures/volumetracing_object";
import { waitUntilNotBusy } from "test/helpers/saga_test_helpers";
import { delay } from "typed-redux-saga";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { Vector3 } from "viewer/constants";
import type { Action } from "viewer/model/actions/actions";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  removeSegmentAction,
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { VERSION_POLL_INTERVAL_COLLAB } from "viewer/model/sagas/saving/save_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectedMappingAfterMerge,
  expectedMappingAfterMerge2,
  expectedMappingAfterMergeRebase,
  initialMapping,
} from "./proofreading_fixtures";
import {
  expectMapping,
  expectSegmentList,
  initializeMappingAndTool,
  makeMappingEditableHelper,
  mockInitialBucketAndAgglomerateData,
  performCutFromAllNeighbours,
  prepareGetNeighborsForAgglomerateNode,
} from "./proofreading_test_utils";
import { publishDebuggingState } from "test/helpers/debugging_state_serializer";
import {
  mergeSegment1337And5,
  mergeSegment1And4,
  mergeSegment2And4,
  mergeSegment5And6,
  splitSegment1And2,
  splitSegment2And3,
} from "./proofreading_interaction_update_action_fixtures";

function* prepareEditableMapping(
  context: WebknossosTestContext,
  tracingId: string,
  activeSegmentId: number,
  anchorPosition: Vector3,
  initialExpectedMapping?: Map<number, number>,
): Saga<void> {
  initialExpectedMapping = initialExpectedMapping ?? initialMapping;
  yield call(initializeMappingAndTool, context, tracingId);
  yield* expectMapping(tracingId, initialExpectedMapping);
  yield put(setOthersMayEditForAnnotationAction(true));

  // Set up the merge-related segment partners. Normally, this would happen
  // due to the user's interactions.
  yield put(
    updateSegmentAction(
      activeSegmentId,
      { name: `Segment ${activeSegmentId}`, anchorPosition },
      tracingId,
    ),
  );
  yield put(setActiveCellAction(activeSegmentId));

  yield call(makeMappingEditableHelper);

  // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
  yield* expectMapping(tracingId, initialExpectedMapping);
}

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
    /*
      Initial Mapping:
      {1 -> 2 -> 3}
      {4 -> 5}
      {6 -> 7}
      {1337, 1338}

      - Backend merges segments 5 and 6
      - Frontend merges 1 and 4

      The resulting mapping will be:
      {6 <- 5 <- 4 -> 1 -> 2 -> 3}
      {1337, 1338}
     */
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(5, mergeSegment5And6);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield* prepareEditableMapping(context, tracingId, 1, [1, 1, 1]);
      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // At this position is: unmappedId=4 / mappedId=4
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      yield* expectMapping(tracingId, expectedMappingAfterMerge);

      yield call(waitUntilNotBusy);
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const receivedUpdateActions = getFlattenedUpdateActions(context).slice(-2);

      expect(receivedUpdateActions).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 1,
            segmentId2: 4,
            agglomerateId1: 1,
            agglomerateId2: 4,
          },
        },
        {
          name: "mergeSegmentItems",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 4,
            agglomerateId1: 1,
            agglomerateId2: 4,
          },
        },
      ]);
      yield* expectMapping(tracingId, expectedMappingAfterMergeRebase);

      yield call(publishDebuggingState, backendMock);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
      ]);

      const currentSegments = Store.getState().annotation.volumes[0].segments;
      expect(currentSegments.size()).toEqual(1);

      const segment1AfterSaving = currentSegments.getNullable(1);
      expect(segment1AfterSaving).toMatchObject({
        name: "Segment 1",
        anchorPosition: [1, 1, 1],
      });
    });

    await task.toPromise();
  }, 8000);

  it("(II) should merge two agglomerates optimistically and incorporate a new merge action from backend", async (context: WebknossosTestContext) => {
    /*
      Initial Mapping:
      {1 -> 2 -> 3}
      {4 -> 5}
      {6 -> 7}
      {1337, 1338}

      - Backend merges 1 and 4
      - Frontend merges segments 5 and 6

      The resulting mapping will be:
      {6 <- 5 <- 4 -> 1 -> 2 -> 3}
      {1337, 1338}
     */
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(5, [
      ...mergeSegment1And4.slice(0, 1), // creates segment 1
      [
        {
          name: "updateSegmentPartial",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            id: 1,
            anchorPosition: [1, 1, 1],
            additionalCoordinates: undefined,
            name: "Custom Name 1",
            color: [1, 2, 3],
            groupId: null,
            creationTime: 0,
          },
        },
        {
          name: "createSegment",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            id: 4,
            anchorPosition: [4, 4, 4],
            additionalCoordinates: undefined,
            name: "Custom Name 4",
            color: [1, 2, 3],
            groupId: null,
            creationTime: 0,
            metadata: [],
          },
        },
      ],
      ...mergeSegment1And4.slice(1),
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield* prepareEditableMapping(context, tracingId, 4, [4, 4, 4]);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [6, 6, 6], // At this position is: unmappedId=6 / mappedId=6
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      yield* expectMapping(tracingId, expectedMappingAfterMerge2);
      yield call(waitUntilNotBusy);
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const receivedUpdateActions = getFlattenedUpdateActions(context);
      expect(receivedUpdateActions.slice(-3)).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 4,
            segmentId2: 6,
            agglomerateId1: 1,
            agglomerateId2: 6,
          },
        },
        {
          name: "mergeSegmentItems",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 4,
            segmentId2: 6,
            agglomerateId1: 1,
            agglomerateId2: 6,
          },
        },
        {
          name: "updateSegmentPartial",
          value: {
            actionTracingId: "volumeTracingId",
            anchorPosition: [4, 4, 4],
            id: 1,
          },
        },
      ]);

      yield* expectMapping(tracingId, expectedMappingAfterMergeRebase);

      yield call(publishDebuggingState, backendMock);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [4, 4, 4],
        },
      ]);

      const segment1AfterSaving = Store.getState().annotation.volumes[0].segments.getNullable(1);
      expect(segment1AfterSaving).toBeTruthy();

      const segment4AfterSaving = Store.getState().annotation.volumes[0].segments.getNullable(4);
      expect(segment4AfterSaving).toBeUndefined();

      const segment6AfterSaving = Store.getState().annotation.volumes[0].segments.getNullable(6);
      expect(segment6AfterSaving).toBeUndefined();
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerates optimistically and incorporate a new split action from backend", async (context: WebknossosTestContext) => {
    /*
      Initial Mapping:
      {1 -> 2 -> 3}
      {4 -> 5}
      {6 -> 7}
      {1337, 1338}

      - Backend splits agglomerate 1 (segments 2 and 3)
      - Frontend merges agglomerates 4 and 1

      The resulting mapping will be:
      [1, 1339],
      [2, 1339],
      [3, 1],
      [4, 1339],
      [5, 1339],
      [6, 6],
      [7, 6],
     */
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(5, splitSegment2And3);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield* prepareEditableMapping(context, tracingId, 1, [1, 1, 1]);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // At this position is: unmappedId=4 / mappedId=4
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      yield* expectMapping(tracingId, expectedMappingAfterMerge);

      // Wait until proofreading saga is done
      yield call(waitUntilNotBusy);
      yield call(() => api.tracing.save());

      const receivedUpdateActions = getFlattenedUpdateActions(context);
      expect(receivedUpdateActions.at(-3)).toEqual({
        name: "mergeAgglomerate",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 1,
          segmentId2: 4,
          agglomerateId1: 1339,
          agglomerateId2: 4,
        },
      });
      expect(receivedUpdateActions.at(-2)).toEqual({
        name: "mergeSegmentItems",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 1,
          segmentId2: 4,
          agglomerateId1: 1339,
          agglomerateId2: 4,
        },
      });

      expect(receivedUpdateActions.at(-1)).toMatchObject({
        name: "updateSegmentPartial",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          id: 1339,
          anchorPosition: [1, 1, 1],
        },
      });

      yield* expectMapping(
        tracingId,
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

      yield call(publishDebuggingState, backendMock);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [3, 3, 3],
        },
        {
          id: 1339,
          anchorPosition: [1, 1, 1],
        },
      ]);
    });

    await task.toPromise();
  }, 8000);

  it("should cut agglomerate from all neighbors after incorporating a new split action from backend", async (context: WebknossosTestContext) => {
    /*
      - Backend splits agglomerate 1 (segments 1 and 2)
      - Frontend cuts agglomerate 2 from its neighbors (segment 3)

      The resulting mapping will reflect both the frontend cut and the backend split.
     */
    const { mocks } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    prepareGetNeighborsForAgglomerateNode(mocks, 6, false);

    backendMock.planMultipleVersionInjections(7, splitSegment1And2);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performCutFromAllNeighbours(context, tracingId, false);

      const splitSaveActionBatch = getFlattenedUpdateActions(context).slice(-3);
      expect(splitSaveActionBatch).toEqual([
        {
          name: "createSegment",
          value: {
            actionTracingId: "volumeTracingId",
            additionalCoordinates: undefined,
            anchorPosition: [2, 2, 2],
            color: null,
            creationTime: 1494695001688,
            groupId: null,
            id: 1339,
            metadata: [],
            name: null,
          },
        },
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 2,
            segmentId2: 3,
            agglomerateId: 1339,
          },
        },
        {
          name: "createSegment",
          value: {
            actionTracingId: "volumeTracingId",
            additionalCoordinates: undefined,
            anchorPosition: [3, 3, 3],
            color: null,
            creationTime: 1494695001688,
            groupId: null,
            id: 1340,
            metadata: [],
            name: null,
          },
        },
      ]);
      yield* expectMapping(
        tracingId,
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

      // todop
      // yield call(publishDebuggingState, backendMock);
      // yield expectSegmentList(tracingId, [
      //   {
      //     id: 1339,
      //     anchorPosition: [2, 2, 2],
      //   },
      //   {
      //     id: 1340,
      //     anchorPosition: [3, 3, 3],
      //   },
      // ]);
    });

    await task.toPromise();
  }, 8000);

  it("should not cut agglomerate from all neighbors due to interfering merge action", async (context: WebknossosTestContext) => {
    /*
      - Backend merges agglomerates 1 and 4 (segments 4 and 2)
      - Frontend attempts to cut agglomerate 2 from all neighbors (segment 3)

      The resulting mapping shows segment 3 cut from 2, but 2 remains merged with 4 due to the backend action.
     */
    const { mocks } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    prepareGetNeighborsForAgglomerateNode(mocks, 6, false);

    backendMock.planMultipleVersionInjections(7, mergeSegment2And4);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield performCutFromAllNeighbours(context, tracingId, false);

      const splitSaveActionBatch = getFlattenedUpdateActions(context).slice(-2);

      expect(splitSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 2,
            segmentId2: 3,
            agglomerateId: 1,
          },
        },
        {
          name: "createSegment",
          value: {
            actionTracingId: "volumeTracingId",
            additionalCoordinates: undefined,
            anchorPosition: [3, 3, 3],
            color: null,
            creationTime: 1494695001688,
            groupId: null,
            id: 1339,
            metadata: [],
            name: null,
          },
        },
      ]);
      yield* expectMapping(
        tracingId,
        // A new edge from 4 to 2 was created and one between 2 and 3 was removed.
        // -> agglomerate 1 was merged into agglomerate 4 and then segment 3 was cut off from it due to the remove from allneighbours.
        // But as answer to the edges to remove was on version before the merge, the newly added edge afterwards is not included in the edges that need to be removed to completely isolate the segment 2.
        // Thus, only 3 was cut off from segment 2.
        new Map([
          [1, 1],
          [2, 1],
          [3, 1339],
          [5, 1],
          [4, 1],
          [6, 6],
          [7, 6],
        ]),
      );

      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [2, 2, 2],
        },
        {
          id: 1339,
          anchorPosition: [3, 3, 3],
        },
      ]);
    });

    await task.toPromise();
  }, 8000);

  it("should merge two agglomerates after incorporating a new split action from backend", async (context: WebknossosTestContext) => {
    /*
      - Backend splits agglomerate 1 (segments 1 and 2)
      - Frontend merges agglomerates 4 and 1 (segments 4 and 1)

      The resulting mapping incorporates both the frontend merge and the backend split.
     */
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    backendMock.planMultipleVersionInjections(5, splitSegment1And2);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      // todop: what did I want to do here?
      yield* prepareEditableMapping(context, tracingId, 1, [2, 2, 2]);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // At this position is: unmappedId=4 / mappedId=4
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield take("SNAPSHOT_ANNOTATION_STATE_FOR_NEXT_REBASE");

      const receivedUpdateActions = getFlattenedUpdateActions(context);
      expect(receivedUpdateActions.slice(-2)).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 2,
            segmentId2: 4,
            agglomerateId1: 1339,
            agglomerateId2: 4,
          },
        },
        {
          name: "mergeSegmentItems",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 2,
            segmentId2: 4,
            agglomerateId1: 1339,
            agglomerateId2: 4,
          },
        },
      ]);
      yield* expectMapping(
        tracingId,
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

      yield call(publishDebuggingState, backendMock);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
        {
          id: 1339,
          anchorPosition: [2, 2, 2],
        },
      ]);
    });

    await task.toPromise();
  });

  it("should merge two agglomerates optimistically and incorporate a new merge action from backend referring to a not loaded segment", async (context: WebknossosTestContext) => {
    /*
      - Backend merges agglomerates 1337 and 4 (segments 1337 and 5), where 1337 is initially not loaded
      - Frontend merges agglomerates 4 and 1 (target segment 4)

      The resulting mapping correctly incorporates the backend merge, even with the initially not-loaded segment.
     */
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

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
    backendMock.planMultipleVersionInjections(5, mergeSegment1337And5);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield* prepareEditableMapping(context, tracingId, 4, [4, 4, 4]);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [1, 1, 1], // At this position is: unmappedId=1 / mappedId=1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      yield* expectMapping(
        tracingId,
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

      yield take("SNAPSHOT_ANNOTATION_STATE_FOR_NEXT_REBASE");
      yield take("SET_BUSY_BLOCKING_INFO_ACTION");
      yield call(waitUntilNotBusy);

      const receivedUpdateActions = getFlattenedUpdateActions(context).slice(-3);

      expect(receivedUpdateActions).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 4,
            segmentId2: 1,
            agglomerateId1: 1337,
            agglomerateId2: 1,
          },
        },
        {
          name: "mergeSegmentItems",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 4,
            segmentId2: 1,
            agglomerateId1: 1337,
            agglomerateId2: 1,
          },
        },
        {
          name: "updateSegmentPartial",
          value: {
            actionTracingId: "volumeTracingId",
            anchorPosition: [4, 4, 4],
            id: 1337,
          },
        },
      ]);
      yield* expectMapping(
        tracingId,
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

      yield call(publishDebuggingState, backendMock);
      yield expectSegmentList(tracingId, [
        {
          id: 1337,
          anchorPosition: [4, 4, 4],
        },
      ]);
    });

    await task.toPromise();
  });

  it("should merge two agglomerates optimistically and incorporate new split and merge actions from backend referring to a not loaded segment", async (context: WebknossosTestContext) => {
    /*
      - Backend splits agglomerate 1337 (segments 7 and 1337)
      - Backend merges agglomerates 1339 and 4 (segments 1337 and 5)
      - Frontend merges agglomerates 4 and 1 (target segment 1)

      The resulting mapping correctly incorporates all backend split and merge actions, including those involving initially not-loaded segments.
     */

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
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1337, 7]], Store.getState());

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
    backendMock.planVersionInjection(5, [
      {
        name: "splitAgglomerate",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 7, // will keep its agglomerate id
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
    backendMock.planVersionInjection(6, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 1337,
          segmentId2: 5,
          agglomerateId1: 1339,
          agglomerateId2: 4,
        },
      },
      {
        name: "mergeSegmentItems",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 1337,
          segmentId2: 5,
          agglomerateId1: 1339,
          agglomerateId2: 4,
        },
      },
      {
        name: "updateSegmentPartial",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          id: 1339,
          name: "Custom Name for 1339",
        },
      },
      {
        name: "updateMetadataOfSegment",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          id: 1339,
          removeEntriesByKey: [],
          upsertEntriesByKey: [{ key: "key1", stringValue: "value for 1339" }],
        },
      },
      {
        name: "updateSegmentPartial",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          id: 1,
          name: "Custom Name for 1",
        },
      },
      {
        name: "updateMetadataOfSegment",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          id: 1,
          removeEntriesByKey: [],
          upsertEntriesByKey: [{ key: "key1", stringValue: "value for 1" }],
        },
      },
    ]);

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
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
      yield* prepareEditableMapping(context, tracingId, 4, [4, 4, 4], initialExpectedMapping);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [1, 1, 1], // At this position is: unmappedId=1 / mappedId=1
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");

      yield* expectMapping(
        tracingId,
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

      yield take("SNAPSHOT_ANNOTATION_STATE_FOR_NEXT_REBASE");
      yield take("SET_BUSY_BLOCKING_INFO_ACTION");
      yield call(waitUntilNotBusy);

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const currentSegments = state.annotation.volumes[0].segments;
        expect(currentSegments.size()).toEqual(1);

        const segment1339AfterSaving = currentSegments.getNullable(1339);
        expect(segment1339AfterSaving).toMatchObject({
          name: "Custom Name for 1339 and Custom Name for 1",
          metadata: [
            { key: "key1-1339", stringValue: "value for 1339" },
            { key: "key1-1", stringValue: "value for 1" },
          ],
          anchorPosition: [4, 4, 4],
        });
      }

      const receivedUpdateActions = getFlattenedUpdateActions(context).slice(-2);

      expect(receivedUpdateActions).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 4,
            segmentId2: 1,
            agglomerateId1: 1339,
            agglomerateId2: 1,
          },
        },
        {
          name: "mergeSegmentItems",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 4,
            segmentId2: 1,
            agglomerateId1: 1339,
            agglomerateId2: 1,
          },
        },
      ]);

      yield* expectMapping(
        tracingId,
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
    /*
      Initial Mapping:
      {1 -> 2 -> 3}
      {4 -> 5}
      {6 -> 7}
      {1337, 1338}

      - Frontend merges agglomerates 4 and 1 (target segment 1)
      - No backend actions are applied.

      The resulting mapping reflects only the frontend merge, and no rebasing is triggered.
     */
    const { api } = context;
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      const rebaseActionChannel = yield actionChannel(["PREPARE_REBASING", "FINISHED_REBASING"]);

      yield* prepareEditableMapping(context, tracingId, 1, [1, 1, 1]);

      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // At this position is: unmappedId=4 / mappedId=4
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");
      yield call(waitUntilNotBusy);
      yield call(() => api.tracing.save());

      const mergeSaveActionBatch = getFlattenedUpdateActions(context).slice(-2);

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 1,
            segmentId2: 4,
            agglomerateId1: 1,
            agglomerateId2: 4,
          },
        },
        {
          name: "mergeSegmentItems",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            segmentId1: 1,
            segmentId2: 4,
            agglomerateId1: 1,
            agglomerateId2: 4,
          },
        },
      ]);
      yield* expectMapping(
        tracingId,
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

      yield call(publishDebuggingState, _backendMock);
      yield expectSegmentList(tracingId, [
        {
          id: 1,
          anchorPosition: [1, 1, 1],
        },
      ]);

      // Asserting no rebasing relevant actions were triggered.
      const rebasingActions = yield flush(rebaseActionChannel);
      expect(rebasingActions.length).toBe(0);
    });

    await task.toPromise();
  }, 8000);

  it("should not deadlock upon proofreading action when not receiving mutex after some time and auto timeout polling already ends in the waiting-loop for the ui busy lock", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context);
    const blockingUser = { firstName: "Sample", lastName: "User", id: "1111" };

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield* prepareEditableMapping(context, tracingId, 1, [1, 1, 1]);
      yield call(() => context.api.tracing.save());
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: false,
        blockedByUser: blockingUser,
      }));
      // Execute the actual merge and wait for the finished mapping.
      yield put(
        proofreadMergeAction(
          [4, 4, 4], // unmappedId=4 / mappedId=4 at this position
          1, // unmappedId=1 maps to 1
        ),
      );
      const waitingTimeTillPollingTimeoutWasTriggered = VERSION_POLL_INTERVAL_COLLAB * 2 + 100;
      yield delay(waitingTimeTillPollingTimeoutWasTriggered);
      context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
        canEdit: true,
        blockedByUser: null,
      }));
      // Wait till not busy anymore to check that no dead lock happens.
      yield take(
        ((action: Action) =>
          action.type === "SET_BUSY_BLOCKING_INFO_ACTION" && !action.value.isBusy) as ActionPattern,
      );
    });

    await task.toPromise();
  }, 8000);

  it("should not create a segment item after splitting when another user performed a merge that swallows that item", async (context: WebknossosTestContext) => {
    const { api, mocks } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1337, 7]], Store.getState());

    backendMock.planVersionInjection(5, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 1337,
          segmentId2: 5,
          agglomerateId1: 1337,
          agglomerateId2: 4,
        },
      },
    ]);
    backendMock.planVersionInjection(6, [
      {
        name: "mergeSegmentItems",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
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
      yield* prepareEditableMapping(context, tracingId, 4, [4, 4, 4], initialExpectedMapping);

      // Prepare the server's reply for the upcoming split.
      vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockReturnValue(
        Promise.resolve([
          {
            position1: [4, 4, 4],
            position2: [5, 5, 5],
            segmentId1: 4,
            segmentId2: 5,
          },
        ]),
      );

      // Execute the actual min cut and wait for the finished mapping.
      yield put(
        minCutAgglomerateWithPositionAction(
          [5, 5, 5], // At this position is: unmappedId=5 / mappedId=4
        ),
      );
      yield call(waitUntilNotBusy);

      yield take("FINISH_MAPPING_INITIALIZATION");
      yield take("FINISH_MAPPING_INITIALIZATION");

      yield* expectMapping(
        tracingId,
        new Map([
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 1337],
          [5, 1339],
          [6, 1339],
          [7, 1339],
          // [1337, 1339], not loaded
          // [1338, 1339], not loaded
        ]),
      );

      yield take(
        ((action: Action) =>
          action.type === "FINISHED_LOADING_MESH" && action.segmentId === 1339) as ActionPattern,
      );
      yield call(waitUntilNotBusy);
      yield call(() => api.tracing.save());

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const currentSegments = state.annotation.volumes[0].segments;
        expect(currentSegments.size()).toEqual(2);

        const segment1337AfterSaving = currentSegments.getNullable(1337);
        expect(segment1337AfterSaving).toMatchObject({
          name: "Segment 1337 and Segment 4",
          anchorPosition: [4, 4, 4],
        });

        const segment1339AfterSaving = currentSegments.getNullable(1339);
        expect(segment1339AfterSaving).toMatchObject({
          name: null,
          anchorPosition: [5, 5, 5],
        });
      }

      const receivedUpdateActions = getFlattenedUpdateActions(context);

      expect(receivedUpdateActions).toContainEqual({
        name: "splitAgglomerate",
        value: {
          actionTracingId: "volumeTracingId",
          segmentId1: 4,
          segmentId2: 5,
          agglomerateId: 1337,
        },
      });
    });

    await task.toPromise();
  }, 8000);

  it("should update correct segment item if that one was merged into another segment by another user", async (context: WebknossosTestContext) => {
    /*
     * The local user updates segment item 4. However, another user already merged 1337 and 4 so that
     * segment item does not exist, anymore. All updates to segment item 4 should now be adapted
     * so that they are applied to segment 1337.
     */
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1337, 7]], Store.getState());

    backendMock.planVersionInjection(5, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 1337,
          segmentId2: 5,
          agglomerateId1: 1337,
          agglomerateId2: 4,
        },
      },
    ]);
    backendMock.planVersionInjection(6, [
      {
        name: "mergeSegmentItems",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
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
      yield* prepareEditableMapping(context, tracingId, 5, [5, 5, 5], initialExpectedMapping);

      let name = "Some segment name";
      const anchorPosition: Vector3 = [4, 4, 4];
      const metadata = [{ key: "key", stringValue: "stringValue" }];
      yield put(
        // Will result in a createSegment action (at least locally; it will
        // be converted to an updateSegmentPartial action during rebasing
        // because segment 1337 (to which that anchorPosition will
        // refer to) already exists).
        updateSegmentAction(
          4,
          {
            name,
            anchorPosition,
          },
          tracingId,
        ),
      );
      name = "Some other segment name";
      yield put(
        // Will result in multiple actions:
        // - updateSegmentPartial action
        // - updateMetadataOfSegment action
        // - updateSegmentVisibility action
        updateSegmentAction(
          4,
          {
            name,
            metadata,
            isVisible: false,
          },
          tracingId,
        ),
      );

      yield call(() => api.tracing.save());

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const currentSegments = state.annotation.volumes[0].segments;
        expect(currentSegments.size()).toEqual(2);

        const segment1337AfterSaving = currentSegments.getNullable(1337);
        expect(segment1337AfterSaving).toMatchObject({
          name,
          anchorPosition,
          metadata,
          isVisible: false,
        });
      }
    });

    await task.toPromise();
  }, 8000);

  it("should ignore segment item removal if that one was merged into another segment by another user", async (context: WebknossosTestContext) => {
    /*
     * The local user removes segment item 4. However, another user already merged 1337 and 4 so that
     * segment item does not exist, anymore (instead segment item 1337 will exist).
     * The removal will now be ignored. One can argue whether the removal should now be applied to
     * segment 1337, but the implementation of that would more complicated which is why the code
     * behaves like this currently. The reason for why it would be more complicated is that the
     * look up from old id to new id is done by using the anchor position of the segment item.
     * However, the segment item doesn't exist locally anymore (because it was removed by the user).
     */
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [[1337, 7]], Store.getState());

    backendMock.planVersionInjection(5, [
      {
        name: "mergeAgglomerate",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          segmentId1: 1337,
          segmentId2: 5,
          agglomerateId1: 1337,
          agglomerateId2: 4,
        },
      },
    ]);
    backendMock.planVersionInjection(6, [
      {
        name: "mergeSegmentItems",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
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
      yield* prepareEditableMapping(context, tracingId, 4, [4, 4, 4], initialExpectedMapping);

      yield put(removeSegmentAction(4, tracingId));

      yield call(() => api.tracing.save());

      const backendState = backendMock.getState();
      const frontendState = Store.getState();

      for (const state of [frontendState, backendState]) {
        const currentSegments = state.annotation.volumes[0].segments;
        expect(currentSegments.size()).toEqual(1);

        const segment1337AfterSaving = currentSegments.getNullable(1337);
        expect(segment1337AfterSaving).toMatchObject({
          name: "Segment 1337 and Segment 4",
          anchorPosition: [4, 4, 4],
        });
      }
    });

    await task.toPromise();
  }, 8000);
});
