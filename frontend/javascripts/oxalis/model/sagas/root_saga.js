// @flow

import { type Saga, _all, _call, _cancel, fork, take } from "oxalis/model/sagas/effect-generators";
import { alert } from "libs/window";
import {
  editVolumeLayerAsync,
  ensureToolIsAllowedInResolution,
  floodFill,
  watchVolumeTracingAsync,
} from "oxalis/model/sagas/volumetracing_saga";
import {
  pushAnnotationAsync,
  saveTracingAsync,
  collectUndoStates,
  toggleErrorHighlighting,
} from "oxalis/model/sagas/save_saga";
import {
  warnAboutSegmentationZoom,
  watchAnnotationAsync,
} from "oxalis/model/sagas/annotation_saga";
import { watchDataRelevantChanges } from "oxalis/model/sagas/prefetch_saga";
import { watchSkeletonTracingAsync } from "oxalis/model/sagas/skeletontracing_saga";
import ErrorHandling from "libs/error_handling";
import handleMeshChanges from "oxalis/model/sagas/handle_mesh_changes";
import isosurfaceSaga from "oxalis/model/sagas/isosurface_saga";
import { watchMaximumRenderableLayers } from "oxalis/model/sagas/dataset_saga";
import watchPushSettingsAsync from "oxalis/model/sagas/settings_saga";
import watchTasksAsync, { warnAboutMagRestriction } from "oxalis/model/sagas/task_saga";
import loadHistogramData from "oxalis/model/sagas/load_histogram_data_saga";

let rootSagaCrashed = false;
export default function* rootSaga(): Saga<void> {
  while (true) {
    rootSagaCrashed = false;
    const task = yield* fork(restartableSaga);
    yield* take("RESTART_SAGA");
    yield _cancel(task);
  }
}

export function hasRootSagaCrashed() {
  return rootSagaCrashed;
}

function* restartableSaga(): Saga<void> {
  try {
    yield _all([
      _call(warnAboutSegmentationZoom),
      _call(warnAboutMagRestriction),
      _call(watchPushSettingsAsync),
      _call(watchSkeletonTracingAsync),
      _call(collectUndoStates),
      _call(saveTracingAsync),
      _call(pushAnnotationAsync),
      _call(editVolumeLayerAsync),
      _call(ensureToolIsAllowedInResolution),
      _call(floodFill),
      _call(watchVolumeTracingAsync),
      _call(watchAnnotationAsync),
      _call(loadHistogramData),
      _call(watchDataRelevantChanges),
      _call(isosurfaceSaga),
      _call(watchTasksAsync),
      _call(handleMeshChanges),
      _call(watchMaximumRenderableLayers),
    ]);
  } catch (err) {
    rootSagaCrashed = true;
    console.error("The sagas crashed because of the following error:", err);
    if (process.env.BABEL_ENV !== "test") {
      ErrorHandling.notify(err, {});
      toggleErrorHighlighting(true);
      alert(`\
Internal error.
Please reload the page to avoid losing data.

${JSON.stringify(err)} ${err.stack || ""}`);
    }
  }
}
