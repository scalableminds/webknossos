// @flow

import watchPushSettingsAsync from "oxalis/model/sagas/settings_saga";
import { watchSkeletonTracingAsync } from "oxalis/model/sagas/skeletontracing_saga";
import {
  pushAnnotationAsync,
  saveTracingAsync,
  collectUndoStates,
} from "oxalis/model/sagas/save_saga";
import {
  editVolumeLayerAsync,
  disallowVolumeTracingWarning,
  watchVolumeTracingAsync,
} from "oxalis/model/sagas/volumetracing_saga";
import { watchDataRelevantChanges } from "oxalis/model/sagas/prefetch_saga";
import {
  warnAboutSegmentationOpacity,
  watchAnnotationAsync,
} from "oxalis/model/sagas/annotation_saga";
import { alert } from "libs/window";
import { fork, take, cancel } from "redux-saga/effects";

export default function* rootSaga(): Generator<*, *, *> {
  while (true) {
    const task = yield fork(restartableSaga);
    yield take("RESTART_SAGA");
    yield cancel(task);
  }
}

function* restartableSaga(): Generator<*, *, *> {
  try {
    yield [
      warnAboutSegmentationOpacity(),
      watchPushSettingsAsync(),
      watchSkeletonTracingAsync(),
      collectUndoStates(),
      saveTracingAsync(),
      pushAnnotationAsync(),
      editVolumeLayerAsync(),
      disallowVolumeTracingWarning(),
      watchVolumeTracingAsync(),
      watchAnnotationAsync(),
      watchDataRelevantChanges(),
    ];
  } catch (err) {
    console.error(err);
    alert(`\
Internal error.
Please reload the page to avoid losing data.

${err} ${err.stack}`);
  }
}
