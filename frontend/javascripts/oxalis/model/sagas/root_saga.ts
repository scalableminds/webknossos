import type { Saga } from "oxalis/model/sagas/effect-generators";
import { all, call, cancel, fork, take } from "typed-redux-saga";
import { alert } from "libs/window";
import VolumetracingSagas from "oxalis/model/sagas/volumetracing_saga";
import SaveSagas, { toggleErrorHighlighting } from "oxalis/model/sagas/save_saga";
import AnnotationSagas from "oxalis/model/sagas/annotation_saga";
import { watchDataRelevantChanges } from "oxalis/model/sagas/prefetch_saga";
import SkeletontracingSagas from "oxalis/model/sagas/skeletontracing_saga";
import ErrorHandling from "libs/error_handling";
import handleMeshChanges from "oxalis/model/sagas/handle_mesh_changes";
import isosurfaceSaga from "oxalis/model/sagas/isosurface_saga";
import { watchMaximumRenderableLayers } from "oxalis/model/sagas/dataset_saga";
import { watchToolDeselection } from "oxalis/model/sagas/annotation_tool_saga";
import SettingsSaga from "oxalis/model/sagas/settings_saga";
import watchTasksAsync, { warnAboutMagRestriction } from "oxalis/model/sagas/task_saga";
import loadHistogramDataSaga from "oxalis/model/sagas/load_histogram_data_saga";
import listenToClipHistogramSaga from "oxalis/model/sagas/clip_histogram_saga";
import MappingSaga from "oxalis/model/sagas/mapping_saga";
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

function* restartableSaga(): Saga<void> {
  try {
    yield* all([
      call(warnAboutMagRestriction),
      call(SettingsSaga),
      ...SkeletontracingSagas.map((saga) => call(saga)),
      call(listenToClipHistogramSaga),
      call(loadHistogramDataSaga),
      call(watchDataRelevantChanges),
      call(isosurfaceSaga),
      call(watchTasksAsync),
      call(handleMeshChanges),
      call(watchMaximumRenderableLayers),
      call(MappingSaga),
      call(watchToolDeselection),
      ...AnnotationSagas.map((saga) => call(saga)),
      ...SaveSagas.map((saga) => call(saga)),
      ...VolumetracingSagas.map((saga) => call(saga)),
    ]);
  } catch (err) {
    rootSagaCrashed = true;
    console.error("The sagas crashed because of the following error:", err);

    if (process.env.BABEL_ENV !== "test") {
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
