import type { Saga } from "oxalis/model/sagas/effect-generators";
import { all, call, cancel, fork, take, takeEvery } from "typed-redux-saga";
import { alert } from "libs/window";
import VolumetracingSagas from "oxalis/model/sagas/volumetracing_saga";
import SaveSagas, { toggleErrorHighlighting } from "oxalis/model/sagas/save_saga";
import UndoSaga from "oxalis/model/sagas/undo_saga";
import AnnotationSagas from "oxalis/model/sagas/annotation_saga";
import { watchDataRelevantChanges } from "oxalis/model/sagas/prefetch_saga";
import SkeletontracingSagas from "oxalis/model/sagas/skeletontracing_saga";
import ErrorHandling from "libs/error_handling";
import meshSaga, { handleAdditionalCoordinateUpdate } from "oxalis/model/sagas/mesh_saga";
import DatasetSagas from "oxalis/model/sagas/dataset_saga";
import { watchToolDeselection, watchToolReset } from "oxalis/model/sagas/annotation_tool_saga";
import SettingsSaga from "oxalis/model/sagas/settings_saga";
import watchTasksAsync, { warnAboutMagRestriction } from "oxalis/model/sagas/task_saga";
import loadHistogramDataSaga from "oxalis/model/sagas/load_histogram_data_saga";
import listenToClipHistogramSaga from "oxalis/model/sagas/clip_histogram_saga";
import MappingSaga from "oxalis/model/sagas/mapping_saga";
import ProofreadSaga from "oxalis/model/sagas/proofread_saga";
import { listenForWkReady } from "oxalis/model/sagas/wk_ready_saga";
import { warnIfEmailIsUnverified } from "./user_saga";
import type { EscalateErrorAction } from "../actions/actions";

let rootSagaCrashed = false;
export default function* rootSaga(): Saga<void> {
  while (true) {
    rootSagaCrashed = false;
    const task = yield* fork(restartableSaga);
    yield* take("RESTART_SAGA");
    yield* cancel(task);
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
      call(listenForWkReady),
      call(warnAboutMagRestriction),
      call(SettingsSaga),
      ...SkeletontracingSagas.map((saga) => call(saga)),
      call(listenToClipHistogramSaga),
      call(loadHistogramDataSaga),
      call(watchDataRelevantChanges),
      call(meshSaga),
      call(watchTasksAsync),
      call(MappingSaga),
      call(watchToolDeselection),
      call(watchToolReset),
      call(ProofreadSaga),
      ...AnnotationSagas.map((saga) => call(saga)),
      ...SaveSagas.map((saga) => call(saga)),
      call(UndoSaga),
      ...VolumetracingSagas.map((saga) => call(saga)),
      call(warnIfEmailIsUnverified),
      call(listenToErrorEscalation),
      call(handleAdditionalCoordinateUpdate),
      ...DatasetSagas.map((saga) => call(saga)),
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
