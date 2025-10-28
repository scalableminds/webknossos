import { afterEach, describe, expect, it, vi } from "vitest";
import update from "immutability-helper";
import { type WebknossosTestContext, setupWebknossosForTesting } from "test/helpers/apiHelpers";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { call, put, select, take } from "redux-saga/effects";
import { startSaga } from "viewer/store";
import { mockInitialBucketAndAgglomerateData } from "./proofreading/proofreading_test_utils";
import { setOthersMayEditForAnnotationAction } from "viewer/model/actions/annotation_actions";
import type { ServerSkeletonTracing, ServerVolumeTracing } from "types/api_types";
import { proofreadMergeAction } from "viewer/model/actions/proofread_actions";
import {
  updateSegmentAction,
  setActiveCellAction,
} from "viewer/model/actions/volumetracing_actions";
import { tracing as volumeTracing } from "test/fixtures/volumetracing_server_objects";
import { Store } from "viewer/singletons";
import { sleep } from "libs/utils";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setToolAction } from "viewer/model/actions/ui_actions";
import { powerOrga } from "test/fixtures/dummy_organization";
import { getCurrentMag } from "viewer/model/accessors/flycam_accessor";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { WkDevFlags } from "viewer/api/wk_dev";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";

const blockingUser = { firstName: "Sample", lastName: "User", id: "1111" };

function makeProofreadAnnotation(
  tracings: (ServerSkeletonTracing | ServerVolumeTracing)[],
): (ServerSkeletonTracing | ServerVolumeTracing)[] {
  return tracings.map((tracing) => {
    if (tracing.typ === "Volume" && tracing.id === volumeTracing.id) {
      return update(tracing, {
        hasEditableMapping: { $set: true },
        mappingName: { $set: "volumeTracingId" },
        mappingIsLocked: { $set: true },
      });
    }
    return tracing;
  });
}

async function makeProofreadMerge(context: WebknossosTestContext): Promise<void> {
  const { annotation } = Store.getState();
  const { tracingId } = annotation.volumes[0];

  const task = startSaga(function* () {
    yield put(setActiveOrganizationAction(powerOrga));
    yield put(setZoomStepAction(0.3));
    const currentMag = yield select((state) => getCurrentMag(state, tracingId));
    expect(currentMag).toEqual([1, 1, 1]);
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
    yield put(proofreadMergeAction([4, 4, 4], 1));
    // Wait for UI made busy and back to idle again to ensure saving of the whole sagas is done.
    yield take("SET_BUSY_BLOCKING_INFO_ACTION");
    yield take("SET_BUSY_BLOCKING_INFO_ACTION");
  });
  await task.toPromise();
}

const initialLiveCollab = WkDevFlags.liveCollab;
describe("Save Mutex Saga", () => {
  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    expect(hasRootSagaCrashed()).toBe(false);
    vi.clearAllMocks(); // clears call counts of *all* spies
    WkDevFlags.liveCollab = initialLiveCollab;
  });
  // Properties that can influence whether mutex acquisition is called are:
  // - othersMayEdit
  // - isUpdatingCurrentlyAllowed
  // - activeTool
  // - activeVolumeTracing
  it<WebknossosTestContext>("An annotation with allowUpdate = false and othersMayEdit = false should not try to acquire the annotation mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
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
    WkDevFlags.liveCollab = false;
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
    WkDevFlags.liveCollab = false;
    // allowUpdate = true and othersMayEdit = false are the defaults for the annotation,
    // no manual changes via a function passed to setupWebknossosForTesting is needed
    await setupWebknossosForTesting(context, "hybrid");
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with isUpdatingCurrentlyAllowed = true and othersMayEdit = true should try to acquire the annotation mutex in liveCollab scenario.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
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

  it<WebknossosTestContext>("An annotation with isUpdatingCurrentlyAllowed = true and othersMayEdit = true should try to acquire the annotation mutex not in liveCollab.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
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
    WkDevFlags.liveCollab = false;
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
    WkDevFlags.liveCollab = false;
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

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayEdit = false should not try to instantly acquire the mutex nor should it be fetched upon proofreading action.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
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
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(500);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    await makeProofreadMerge(context);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayEdit = true and liveCollab = true should not try to instantly acquire the mutex; only after an proofread annotation action.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = true;
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
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(500);
    expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
    await makeProofreadMerge(context);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
  });

  it<WebknossosTestContext>("An annotation with an active proofreading volume annotation with othersMayEdit = true and liveCollab disabled should try to instantly acquire the mutex.", async (context: WebknossosTestContext) => {
    WkDevFlags.liveCollab = false;
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
    mockInitialBucketAndAgglomerateData(context);
    // Give mutex saga time to potentially acquire the mutex. This should not happen!
    await sleep(500);
    expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
  });
  const ToolsAllowedInProofreadingModeWithoutLiveCollabSupport = [
    AnnotationTool.SKELETON,
    AnnotationTool.BOUNDING_BOX,
  ];

  describe.each(ToolsAllowedInProofreadingModeWithoutLiveCollabSupport)(
    "[With AnnotationTool=%s]:",
    (annotationToolWithoutLiveCollabSupport) => {
      it<WebknossosTestContext>(`An annotation with an active proofreading volume annotation with othersMayEdit = false and liveCollab enabled should not try to acquire the mutex despite the user switching a non Proofreading Tool ${annotationToolWithoutLiveCollabSupport.id}.`, async (context: WebknossosTestContext) => {
        WkDevFlags.liveCollab = true;
        await setupWebknossosForTesting(
          context,
          "hybrid",
          ({ tracings, annotationProto, dataset, annotation }) => {
            const annotationWithUpdatingAllowedTrue = update(annotation, {
              restrictions: { allowUpdate: { $set: true }, allowSave: { $set: true } },
              othersMayEdit: { $set: false },
            });
            return {
              tracings: makeProofreadAnnotation(tracings),
              annotationProto,
              dataset,
              annotation: annotationWithUpdatingAllowedTrue,
            };
          },
        );
        mockInitialBucketAndAgglomerateData(context);
        // Give mutex saga time to potentially acquire the mutex. This should not happen!
        await sleep(500);
        expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
        Store.dispatch(setToolAction(annotationToolWithoutLiveCollabSupport));
        await sleep(500);
        expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      });

      it<WebknossosTestContext>(`An annotation with an active proofreading volume annotation with othersMayEdit = true and liveCollab enabled should not try to instantly acquire the mutex only after the user switches to a non Proofreading Tool ${annotationToolWithoutLiveCollabSupport.id}.`, async (context: WebknossosTestContext) => {
        WkDevFlags.liveCollab = true;
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
        mockInitialBucketAndAgglomerateData(context);
        // Give mutex saga time to potentially acquire the mutex. This should not happen!
        await sleep(500);
        expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
        Store.dispatch(setToolAction(annotationToolWithoutLiveCollabSupport));
        await sleep(500);
        expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      });
    },
  );

  const othersMayEditValues = [true, false];
  describe.each(othersMayEditValues)("[With othersMayEdit=%s]:", (othersMayEdit) => {
    it<WebknossosTestContext>(`An annotation with an active proofreading volume annotation with othersMayEdit = ${othersMayEditValues} should ${!othersMayEditValues ? "not " : ""}try to acquire the mutex upon activating a different volume annotation layer.`, async (context: WebknossosTestContext) => {
      WkDevFlags.liveCollab = true;
      await setupWebknossosForTesting(
        context,
        "multiVolume",
        ({ tracings, annotationProto, dataset, annotation }) => {
          const annotationWithUpdatingAllowedTrue = update(annotation, {
            restrictions: { allowUpdate: { $set: true }, allowSave: { $set: true } },
            othersMayEdit: { $set: othersMayEdit },
          });
          return {
            tracings: makeProofreadAnnotation(tracings),
            annotationProto,
            dataset,
            annotation: annotationWithUpdatingAllowedTrue,
          };
        },
      );
      mockInitialBucketAndAgglomerateData(context);
      // Give mutex saga time to potentially acquire the mutex. This should not happen!
      await sleep(500);
      expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      const volumeTracingId2 = Store.getState().annotation.volumes.at(-1);
      if (!volumeTracingId2) {
        throw new Error("No additional volume tracing found to activate.");
      }
      // Switch to other layer. Saga should, depending on othersMayEdit, try to acquire mutex now as the active layer no longer has an editable mapping and thus no liveCollab support.
      Store.dispatch(updateLayerSettingAction(volumeTracingId2.tracingId, "isDisabled", false));
      await sleep(500);
      if (othersMayEdit) {
        expect(context.mocks.acquireAnnotationMutex).toHaveBeenCalled();
      } else {
        expect(context.mocks.acquireAnnotationMutex).not.toHaveBeenCalled();
      }
    });
  });
});
