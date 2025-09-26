import { call, put, select, take } from "redux-saga/effects";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { createEditableMapping } from "viewer/model/sagas/volume/proofread_saga";
import { Store } from "viewer/singletons";
import { type NumberLike, startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialMapping } from "./proofreading_fixtures";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import type { Vector3 } from "viewer/constants";
import type { MinCutTargetEdge } from "admin/rest_api";
import _ from "lodash";

describe("Proofreading (with mesh actions)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  // Mesh interactions tests
  it("should merge two agglomerates correctly even when merged segments are not loaded (such an action can be triggered via mesh proofreading)", async (context: WebknossosTestContext) => {
    const { api } = context;
    const _backendMock = mockInitialBucketAndAgglomerateData(context);

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
      yield put(setActiveCellAction(1, undefined, null, 1));

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
          null, // mesh actions do not have a usable source position.
          1337,
          1337,
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");
      // Checking optimistic merge is not necessary as no "foreign" update was injected.
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            segmentId1: 1,
            segmentId2: 1337,
            agglomerateId1: 1,
            agglomerateId2: 1337,
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
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
          [1337, 1], // loaded due to it being part of the merge operation above.
          // [1338, 1], not loaded
        ]),
      );
    });

    await task.toPromise();
  }, 8000);

  it("should update the mapping correctly if not loaded part of the mapping is changed due to own mesh split operation", async (context: WebknossosTestContext) => {
    const { api, mocks } = context;
    // Initial mapping should be
    // [[1, 6],
    //  [2, 6],
    //  [3, 1],
    //  [4, 4],
    //  [5, 4],
    //  [6, 6],
    //  [7, 6],
    //  [1337, 6],
    //  [1338, 6]]
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [
      [7, 1337],
      [1338, 1],
    ]);

    vi.mocked(mocks.getEdgesForAgglomerateMinCut).mockImplementation(
      async (
        _tracingStoreUrl: string,
        _tracingId: string,
        segmentsInfo: {
          partition1: NumberLike[];
          partition2: NumberLike[];
          mag: Vector3;
          agglomerateId: NumberLike;
          editableMappingId: string;
        },
      ): Promise<Array<MinCutTargetEdge>> => {
        const { agglomerateId, partition1, partition2 } = segmentsInfo;
        if (agglomerateId === 6 && _.isEqual(partition1, [1337]) && _.isEqual(partition2, [1338])) {
          return [
            {
              position1: [1337, 1337, 1337],
              position2: [1338, 1338, 1338],
              segmentId1: 1337,
              segmentId2: 1338,
            },
          ];
        }
        throw new Error("Unexpected min cut request");
      },
    );

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* task() {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(
        new Map([
          [1, 6],
          [2, 6],
          [3, 6],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(6, { somePosition: [1337, 1337, 1337] }, tracingId));
      yield put(setActiveCellAction(6, undefined, null, 1337));

      yield call(createEditableMapping);

      // After making the mapping editable, it should not have changed (as no other user did any update actions in between).
      const mapping1 = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping1).toEqual(
        new Map([
          [1, 6],
          [2, 6],
          [3, 6],
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
        ]),
      );
      // setOthersMayEditForAnnotationAction must be after making the mapping editable as this action is not supported to be integrated.
      // TODOM: Support integrating this action, if it originates from this user.
      yield put(setOthersMayEditForAnnotationAction(true));
      // Execute the actual merge and wait for the finished mapping.
      yield put(
        minCutAgglomerateWithPositionAction(
          null, // mesh actions do not have a usable source position.
          1338,
          6,
        ),
      );
      yield take("FINISH_MAPPING_INITIALIZATION");
      // Checking optimistic merge is not necessary as no "foreign" update was injected.
      yield call(() => api.tracing.save()); // Also pulls newest version from backend.

      const mergeSaveActionBatch = context.receivedDataPerSaveRequest.at(-1)![0]?.actions;

      expect(mergeSaveActionBatch).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 6,
            segmentId1: 1337,
            segmentId2: 1338,
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
          [4, 4],
          [5, 4],
          [6, 6],
          [7, 6],
          [1337, 6], // loaded due to split mesh operation
          [1338, 1339], // loaded due to split mesh operation
        ]),
      );
    });

    await task.toPromise();
  }, 8000);
});
