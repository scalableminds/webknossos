import { afterEach, describe, expect, it } from "vitest";
import update from "immutability-helper";
import { type WebknossosTestContext, setupWebknossosForTesting } from "test/helpers/apiHelpers";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { call, put, select, take } from "redux-saga/effects";
import { startSaga } from "viewer/store";
import {
  initializeMappingAndTool,
  mockInitialBucketAndAgglomerateData,
} from "./proofreading/proofreading_test_utils";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import type { ServerSkeletonTracing, ServerVolumeTracing } from "types/api_types";
import { getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import { proofreadMergeAction } from "viewer/model/actions/proofread_actions";
import {
  updateSegmentAction,
  setActiveCellAction,
} from "viewer/model/actions/volumetracing_actions";
import { Store } from "viewer/singletons";
import { ColoredLogger } from "libs/utils";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { initialMapping } from "./proofreading/proofreading_fixtures";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setToolAction } from "viewer/model/actions/ui_actions";

const blockingUser = { firstName: "Sample", lastName: "User", id: "1111" };

function makeProofreadAnnotation(
  tracings: (ServerSkeletonTracing | ServerVolumeTracing)[],
): (ServerSkeletonTracing | ServerVolumeTracing)[] {
  return tracings.map((tracing) => {
    if (tracing.typ === "Volume") {
      return update(tracing, {
        hasEditableMapping: { $set: true },
        mappingName: { $set: "volumeTracingId" },
        mappingIsLocked: { $set: true },
      });
    }
    return tracing;
  });
}

describe("Annotation Saga", () => {
  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
  });
  // Properties that can influence whether mutex acquisition is called are:
  // - othersMayEdit
  // - isUpdatingCurrentlyAllowed
  // - activeTool
  // - activeVolumeTracing
  it<WebknossosTestContext>("An annotation with allowUpdate = false and othersMayEdit = false should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(
      context,
      "hybrid",
      ({ tracings, annotationProto, dataset, annotation }) => {
        const annotationWithUpdatingAllowedFalse = update(annotation, {
          restrictions: { allowUpdate: { $set: false }, allowSave: { $set: false } },
        });
        return {
          tracings,
          annotationProto,
          dataset,
          annotation: annotationWithUpdatingAllowedFalse,
        };
      },
    );
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with allowUpdate = false and othersMayEdit = true should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(
      context,
      "hybrid",
      ({ tracings, annotationProto, dataset, annotation }) => {
        const annotationWithUpdatingAllowedFalse = update(annotation, {
          restrictions: { allowUpdate: { $set: false }, allowSave: { $set: false } },
          othersMayEdit: { $set: true },
        });
        return {
          tracings,
          annotationProto,
          dataset,
          annotation: annotationWithUpdatingAllowedFalse,
        };
      },
    );
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with allowUpdate = true and othersMayEdit = false should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    // allowUpdate = true and othersMayEdit = false are the defaults for the annotation,
    // no manual changes via a function passed to setupWebknossosForTesting is needed
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with isUpdatingCurrentlyAllowed = true and othersMayEdit = true should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(
      context,
      "hybrid",
      ({ tracings, annotationProto, dataset, annotation }) => {
        const annotationWithUpdatingAllowedTrue = update(annotation, {
          restrictions: { allowUpdate: { $set: true }, allowSave: { $set: true } },
          othersMayEdit: { $set: true },
        });
        return {
          tracings,
          annotationProto,
          dataset,
          annotation: annotationWithUpdatingAllowedTrue,
        };
      },
    );
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
    const isUpdatingAllowed = Store.getState().annotation.isUpdatingCurrentlyAllowed;
    expect(isUpdatingAllowed).toBe(true);
  });

  it<WebknossosTestContext>("An annotation where othersMayEdit is turned on should try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    const task = startSaga(function* task() {
      yield put(setOthersMayEditForAnnotationAction(true));
      const hasMutex = yield select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      yield take("SET_IS_MUTEX_ACQUIRED");
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      const hasMutexAfterAcquiring = yield select(
        (state) => state.save.mutexState.hasAnnotationMutex,
      );
      expect(hasMutexAfterAcquiring).toBe(true);
      const blockedByUser = yield select((state) => state.save.mutexState.blockedByUser);
      expect(blockedByUser).toBe(null);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("An annotation where othersMayEdit is turned on should try to acquire the annotation mutex and not allow editing if mutex is not returned as can edit.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    context.mocks.acquireAnnotationMutex.mockImplementation(async () => ({
      canEdit: false,
      blockedByUser: blockingUser,
    }));
    const task = startSaga(function* task() {
      yield put(setOthersMayEditForAnnotationAction(true));
      const hasMutex = yield select((state) => state.save.mutexState.hasAnnotationMutex);
      expect(hasMutex).toBe(false);
      // Waiting for saga to update which user is holding the mutex.
      yield take("SET_USER_HOLDING_MUTEX");
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      const hasMutexAfterAcquiring = yield select(
        (state) => state.save.mutexState.hasAnnotationMutex,
      );
      expect(hasMutexAfterAcquiring).toBe(false);
      const blockedByUser = yield select((state) => state.save.mutexState.blockedByUser);
      expect(blockedByUser).toBe(blockingUser);
      const isUpdatingCurrentlyAllowed = yield select(
        (state) => state.annotation.isUpdatingCurrentlyAllowed,
      );
      expect(isUpdatingCurrentlyAllowed).toBe(false);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayShare = false should not try to instantly acquire the mutex.", async (context: WebknossosTestContext) => {
    await setupWebknossosForTesting(
      context,
      "hybrid",
      ({ tracings, annotationProto, dataset, annotation }) => {
        return {
          tracings: makeProofreadAnnotation(tracings),
          annotationProto,
          dataset,
          annotation,
        };
      },
    );
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayShare  = true should not  try to instantly acquire the mutex only after an proofread annotation action.", async (context: WebknossosTestContext) => {
    // setupWebknossosForTesting is needed to have a valid api for mockInitialBucketAndAgglomerateData.
    // And mockInitialBucketAndAgglomerateData is needed to have the backend mocked for properly from the beginning for the proofreading annotation.
    await setupWebknossosForTesting(context, "hybrid");
    mockInitialBucketAndAgglomerateData(context);
    await setupWebknossosForTesting(
      context,
      "hybrid",
      ({ tracings, annotationProto, dataset, annotation }) => {
        const annotationWithUpdatingAllowedTrue = update(annotation, {
          restrictions: { allowUpdate: { $set: true }, allowSave: { $set: true } },
          othersMayEdit: { $set: true },
        });
        return {
          tracings: makeProofreadAnnotation(tracings),
          annotationProto,
          dataset,
          annotation: annotationWithUpdatingAllowedTrue,
        };
      },
    );
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();

    const { annotation } = Store.getState();
    const { tracingId } = annotation.volumes[0];

    const task = startSaga(function* () {
      yield put(setToolAction(AnnotationTool.PROOFREAD));

      // Read data from the 0,0,0 bucket so that it is in memory (important because the mapping
      // is only maintained for loaded buckets). => Forces loading of mapping.
      const valueAt444 = yield call(() => context.api.data.getDataValue(tracingId, [4, 4, 4], 0));
      expect(valueAt444).toBe(4);
      yield take("SET_MAPPING");
      // Set up the merge-related segment partners. Normally, this would happen
      // due to the user's interactions.
      yield put(updateSegmentAction(1, { somePosition: [1, 1, 1] }, tracingId));
      yield put(setActiveCellAction(1));

      // Execute the actual merge and wait for the finished mapping.
      // TODOM: check why this does not trigger a mutex fetch
      yield put(proofreadMergeAction([4, 4, 4], 1));
      yield take("FINISH_MAPPING_INITIALIZATION");
      const mapping = yield select(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, tracingId).mapping,
      );
      expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      console.log("mapping", mapping);
    });
    await task.toPromise();
  });
});
