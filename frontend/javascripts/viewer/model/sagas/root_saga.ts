import ErrorHandling from "libs/error_handling";
import { alert } from "libs/window";
import { race } from "redux-saga/effects";
import { all, call, cancel, fork, put, take, takeEvery } from "typed-redux-saga";
import AnnotationSagas from "viewer/model/sagas/annotation_saga";
import toolSaga from "viewer/model/sagas/annotation_tool_saga";
import listenToClipHistogramSaga from "viewer/model/sagas/clip_histogram_saga";
import DatasetSagas from "viewer/model/sagas/dataset_saga";
import type { Saga } from "viewer/model/sagas/effect-generators";
import loadHistogramDataSaga from "viewer/model/sagas/load_histogram_data_saga";
import MappingSaga from "viewer/model/sagas/mapping_saga";
import meshSaga, { handleAdditionalCoordinateUpdate } from "viewer/model/sagas/mesh_saga";
import { watchDataRelevantChanges } from "viewer/model/sagas/prefetch_saga";
import ProofreadSaga from "viewer/model/sagas/proofread_saga";
import ReadySagas from "viewer/model/sagas/ready_sagas";
import SaveSagas, { toggleErrorHighlighting } from "viewer/model/sagas/save_saga";
import SettingsSaga from "viewer/model/sagas/settings_saga";
import SkeletontracingSagas from "viewer/model/sagas/skeletontracing_saga";
import watchTasksAsync, { warnAboutMagRestriction } from "viewer/model/sagas/task_saga";
import UndoSaga from "viewer/model/sagas/undo_saga";
import VolumetracingSagas from "viewer/model/sagas/volumetracing_saga";
import type { EscalateErrorAction } from "../actions/actions";
import { setIsWkReadyAction } from "../actions/ui_actions";
import maintainMaximumZoomForAllMagsSaga from "./flycam_info_cache_saga";
import splitBoundaryMeshSaga from "./split_boundary_mesh_saga";
import { warnIfEmailIsUnverified } from "./user_saga";

let rootSagaCrashed = false;
export default function* rootSaga(): Saga<void> {
  while (true) {
    rootSagaCrashed = false;
    const task = yield* fork(restartableSaga);
    const { restart, doCancel } = yield race({
      restart: take("RESTART_SAGA"),
      doCancel: take("CANCEL_SAGA"),
    });
    yield* cancel(task);
    if (restart) {
      yield* put(setIsWkReadyAction(false));
    }
    if (doCancel) {
      // No restart, leave the while-true-loop
      break;
    }
  }
}

export function hasRootSagaCrashed() {
  return rootSagaCrashed;
}

function* listenToErrorEscalation() {
  // Make the saga deliberately crash when this action has been
  // dispatched. This should be used if an error was thrown in a
  // critical place, which should stop further saga saving.
  yield* takeEvery("ESCALATE_ERROR", (action: EscalateErrorAction) => {
    throw action.error;
  });
}

function* restartableSaga(): Saga<void> {
  try {
    yield* all([
      ...ReadySagas.map((saga) => call(saga)),
      call(warnAboutMagRestriction),
      call(SettingsSaga),
      ...SkeletontracingSagas.map((saga) => call(saga)),
      call(listenToClipHistogramSaga),
      call(loadHistogramDataSaga),
      call(watchDataRelevantChanges),
      call(meshSaga),
      call(watchTasksAsync),
      call(MappingSaga),
      call(ProofreadSaga),
      ...AnnotationSagas.map((saga) => call(saga)),
      ...SaveSagas.map((saga) => call(saga)),
      call(UndoSaga),
      ...VolumetracingSagas.map((saga) => call(saga)),
      call(warnIfEmailIsUnverified),
      call(listenToErrorEscalation),
      call(handleAdditionalCoordinateUpdate),
      call(maintainMaximumZoomForAllMagsSaga),
      ...DatasetSagas.map((saga) => call(saga)),
      call(splitBoundaryMeshSaga),
      call(toolSaga),
    ]);
  } catch (err) {
    rootSagaCrashed = true;
    console.error("The sagas crashed because of the following error:", err);

    if (!process.env.IS_TESTING) {
      // @ts-ignore
      ErrorHandling.notify(err, {});
      // Hide potentially old error highlighting which mentions a retry mechanism.
      toggleErrorHighlighting(false);
      // Show error highlighting which mentions the permanent error.
      toggleErrorHighlighting(true, true);
      alert(`\
Internal error.
Please reload the page to avoid losing data.

${
  JSON.stringify(err)
  // @ts-ignore
} ${err.stack || ""}`);
    }
  }
}
