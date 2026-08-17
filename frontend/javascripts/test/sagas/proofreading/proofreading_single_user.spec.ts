// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  type WebknossosTestContext,
  setupWebknossosForTesting,
  getFlattenedUpdateActions,
} from "test/helpers/apiHelpers";
import { call, put, take } from "redux-saga/effects";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectedMappingAfterMerge,
  expectedMappingAfterSplit,
  initialMapping,
} from "./proofreading_fixtures";
import {
  expectSegmentList,
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
  getPositionForSegmentId,
} from "./proofreading_test_utils";
import { waitUntilNoActiveOperations } from "viewer/model/sagas/saga_helpers";

describe("Proofreading (Single User)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should merge two agglomerates and update the mapping accordingly", async (context: WebknossosTestContext) => {
    const { api } = context;
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));

      // Execute the actual merge and wait for the finished mapping.
      yield put(proofreadMergeAction(getPositionForSegmentId(4), 4n));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping).toEqual(expectedMappingAfterMerge);

      yield call(() => api.tracing.save());

      yield expectSegmentList(tracingId, [
        {
          id: 1n,
          anchorPosition: [1, 1, 1],
        },
      ]);

      const receivedUpdateActions = getFlattenedUpdateActions(context).slice(-2);

      expect(receivedUpdateActions).toEqual([
        {
          name: "mergeAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId1: 1n,
            agglomerateId2: 4n,
            segmentId1: 1n,
            segmentId2: 4n,
          },
        },
        {
          name: "mergeSegmentItems",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId1: 1n,
            agglomerateId2: 4n,
            segmentId1: 1n,
            segmentId2: 4n,
          },
        },
      ]);
    });

    await task.toPromise();
  });

  it("should split two agglomerates and update the mapping accordingly", async (context: WebknossosTestContext) => {
    const { api, mocks } = context;
    const _backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);

      const mapping0 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(mapping0).toEqual(initialMapping);

      // Set up the split-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1n, { anchorPosition: getPositionForSegmentId(1) }, tracingId));
      yield put(setActiveCellAction(1n));

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

      // Execute the split and wait for the finished mapping.
      yield put(minCutAgglomerateWithPositionAction(getPositionForSegmentId(2), 2n, 1n));
      yield take("FINISH_MAPPING_INITIALIZATION");

      const mapping1 = yield* select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );

      expect(mapping1).toEqual(expectedMappingAfterSplit);

      yield call(() => api.tracing.save());
      yield call(waitUntilNoActiveOperations);
      yield call(() => api.tracing.save());

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

      const receivedUpdateActions = getFlattenedUpdateActions(context);

      expect(receivedUpdateActions.slice(-2)).toEqual([
        {
          name: "splitAgglomerate",
          value: {
            actionTracingId: "volumeTracingId",
            agglomerateId: 1n,
            segmentId1: 1n,
            segmentId2: 2n,
          },
        },
        {
          name: "createSegment",
          value: {
            actionTracingId: "volumeTracingId",
            additionalCoordinates: undefined,
            anchorPosition: getPositionForSegmentId(2),
            color: null,
            creationTime: 1494695001688,
            groupId: null,
            id: 1339n,
            metadata: [],
            name: null,
          },
        },
      ]);
    });

    await task.toPromise();
  });
});
