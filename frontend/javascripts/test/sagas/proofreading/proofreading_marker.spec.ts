// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import { type WebknossosTestContext, setupWebknossosForTesting } from "test/helpers/apiHelpers";
import { call, delay, fork, put, take } from "redux-saga/effects";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import { updateMetadataOfAnnotation } from "viewer/model/sagas/volume/update_actions";
import {
  registerOperationAction,
  unregisterOperationAction,
} from "viewer/model/actions/operation_context_actions";
import {
  createCellAction,
  removeSegmentAction,
  setActiveCellAction,
  updateProofreadingMarkerPositionAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { select } from "viewer/model/sagas/effect_generators";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { MISSING_GROUP_ID } from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
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

function* getActiveCellId(tracingId: string) {
  return yield* select(
    (state) =>
      state.annotation.volumes.find((volume) => volume.tracingId === tracingId)?.activeCellId,
  );
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
      yield put(setActiveCellAction(1337n, markerPosition, undefined, undefined, true));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));
    });
    await task.toPromise();
  });

  it("should be cleared when the user activates another segment whose anchor is at the marker", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      // E.g., "Activate Segment ID" in the segment list for an older segment item that was
      // created at the same position.
      const markerPosition = yield* getMarkerPosition(tracingId);
      yield put(setActiveCellAction(1337n, markerPosition));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toBeUndefined();
    });
    await task.toPromise();
  });

  it("should be cleared when the active segment is removed", async (context: WebknossosTestContext) => {
    // Otherwise, the mapping saga would re-add the segment at the marker to the segment list.
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      // E.g., "Remove Segment From List" in the segment list.
      yield put(removeSegmentAction(1n, tracingId));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toBeUndefined();
    });
    await task.toPromise();
  });

  it("should be cleared when a segment group with the active segment is deleted", async (context: WebknossosTestContext) => {
    const { api } = context;
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      // Deleting the root group removes all segments (within a batch action).
      api.tracing.deleteSegmentGroup(MISSING_GROUP_ID, false, tracingId);
      yield call(waitForSagas);
      expect(Store.getState().annotation.volumes[0].segments.has(1n)).toBe(false);
      expect(yield* getMarkerPosition(tracingId)).toBeUndefined();
    });
    await task.toPromise();
  });

  it("should be kept when another segment is removed", async (context: WebknossosTestContext) => {
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(updateSegmentAction(4n, { anchorPosition: getPositionForSegmentId(4) }, tracingId));
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      yield put(removeSegmentAction(4n, tracingId));
      yield call(waitForSagas);
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));
    });
    await task.toPromise();
  });

  it("should be kept when the active segment is removed during a proofreading operation", async (context: WebknossosTestContext) => {
    // After a proofreading operation, outdated agglomerate ids are removed from the segment
    // list. The marker has to stay, so that the active segment can be adapted to the new id.
    mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);

      yield put(registerOperationAction("PROOFREADING"));
      yield put(removeSegmentAction(1n, tracingId));
      yield call(waitForSagas);
      yield put(unregisterOperationAction("PROOFREADING"));
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));
    });
    await task.toPromise();
  });

  it("should be kept when another user removes the active segment", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);
      yield call(() => api.tracing.save());
      expect(Store.getState().annotation.volumes[0].segments.has(1n)).toBe(true);

      backendMock.planVersionInjection(Store.getState().annotation.version + 1, [
        {
          name: "deleteSegment",
          value: {
            actionTracingId: tracingId,
            id: 1n,
          },
        },
      ]);
      // Saving pulls the newest version from the backend if there are local changes.
      yield put(updateSegmentAction(4n, { anchorPosition: getPositionForSegmentId(4) }, tracingId));
      yield call(() => api.tracing.save());
      yield call(waitForSagas);

      expect(Store.getState().annotation.volumes[0].segments.has(1n)).toBe(false);
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));
    });
    await task.toPromise();
  });

  it("should adapt the active segment when another user merges the segment at the marker", async (context: WebknossosTestContext) => {
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(clickSegmentWithProofreadingTool, tracingId, 4n);
      yield call(() => api.tracing.save());
      expect(yield* getActiveCellId(tracingId)).toBe(4n);

      backendMock.injectVersion(
        [
          {
            name: "mergeAgglomerate",
            value: {
              actionTracingId: tracingId,
              segmentId1: 1n,
              segmentId2: 4n,
              agglomerateId1: 1n,
              agglomerateId2: 4n,
            },
          },
        ],
        Store.getState().annotation.version + 1,
      );
      yield call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
      yield call(waitForSagas);

      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(4));
      expect(yield* getActiveCellId(tracingId)).toBe(1n);
    });
    await task.toPromise();
  });

  it("should be kept when the user activates another segment during a rebase", async (context: WebknossosTestContext) => {
    // While rebasing, the store temporarily contains the server's state (including its active
    // segment id) and the reducer drops SET_ACTIVE_CELL actions. Afterwards, the unsaved local
    // changes (including the active segment id) are re-applied.
    const { api } = context;
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* () {
      yield call(initializeMappingAndTool, context, tracingId);
      yield put(setCollaborationModeAction("Concurrent"));
      yield call(() => api.tracing.save());

      // The click is not saved yet, so saving triggers a rebase onto the injected version.
      yield call(clickSegmentWithProofreadingTool, tracingId, 1n);
      backendMock.planVersionInjection(Store.getState().annotation.version + 1, [
        updateMetadataOfAnnotation("Changed by another user"),
      ]);
      let wasSegmentActivatedDuringRebase = false;
      yield fork(function* () {
        yield take("REWIND_FOR_REBASE");
        expect(yield* getActiveCellId(tracingId)).not.toBe(1n);
        yield put(setActiveCellAction(4n, getPositionForSegmentId(4)));
        wasSegmentActivatedDuringRebase = true;
      });
      yield call(() => api.tracing.save());
      yield call(waitForSagas);

      expect(wasSegmentActivatedDuringRebase).toBe(true);
      expect(Store.getState().annotation.description).toBe("Changed by another user");
      expect(yield* getActiveCellId(tracingId)).toBe(1n);
      expect(yield* getMarkerPosition(tracingId)).toEqual(getPositionForSegmentId(1));
    });
    await task.toPromise();
  });
});
