// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import { type WebknossosTestContext, setupWebknossosForTesting } from "test/helpers/apiHelpers";
import { call, delay, put } from "redux-saga/effects";
import {
  createCellAction,
  removeSegmentAction,
  setActiveCellAction,
  updateProofreadingMarkerPositionAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPositionForSegmentId,
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading_test_utils";

function* clickSegmentWithProofreadingTool(tracingId: string, segmentId: bigint) {
  // A proofreading click first activates the clicked segment and then sets the marker.
  const position = getPositionForSegmentId(Number(segmentId));
  yield put(setActiveCellAction(segmentId, position));
  yield put(updateProofreadingMarkerPositionAction(position, tracingId));
  yield call(waitForSagas);
}

function* waitForSagas() {
  // Actions that are put by a saga are handled by other sagas after the put finished.
  // Wait for that before checking the marker.
  yield delay(0);
}

function* getMarkerPosition(tracingId: string) {
  return yield* select(
    (state) => state.localSegmentationStateByLayer[tracingId]?.proofreadingMarkerPosition,
  );
}

describe("Proofreading marker", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "hybrid");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should be cleared when the user activates another segment", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));

      // E.g., "Activate Segment ID" in the segment list.
      yield put(setActiveCellAction(4n, getPositionForSegmentId(4)));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toBeUndefined();
    });
    await task.toPromise();
  });

  it("should be cleared when the user creates a new segment id", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      const largestSegmentId = yield* select(
        (state) => state.annotation.volumes[0].largestSegmentId ?? 0n,
      );
      yield put(createCellAction(1n, largestSegmentId));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toBeUndefined();
    });
    await task.toPromise();
  });

  it("should be kept when the active segment id doesn't change", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      // E.g., selecting another supervoxel of the same agglomerate in the 3D viewport.
      yield put(setActiveCellAction(1n, undefined, undefined, 2n));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));
    });
    await task.toPromise();
  });

  it("should be kept when the active segment is adapted to the segment at the marker", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      // This is what adaptActiveSegmentToProofreadingMarker does when the agglomerate at
      // the marker changed (e.g., due to a split).
      const markerPosition = yield* getMarkerPosition(tracingId);
      yield put(setActiveCellAction(1337n, markerPosition));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));
    });
    await task.toPromise();
  });

  it("should be kept when the active segment item is removed by something other than the segment list", async (context: WebknossosTestContext) => {
    // E.g., by another user (via update actions) or by the cleanup after a merge. Only the
    // segment list clears the marker when the user removes the active segment there.
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      yield put(removeSegmentAction(1n, tracingId));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));
    });
    await task.toPromise();
  });
});
