// @flow

import { watchPushSettingsAsync, initializeSettingsAsync } from "oxalis/model/sagas/settings_saga";
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
      initializeSettingsAsync(),
      watchPushSettingsAsync(),
      watchSkeletonTracingAsync(),
      collectUndoStates(),
      saveTracingAsync(),
      pushAnnotationAsync(),
      editVolumeLayerAsync(),
      disallowVolumeTracingWarning(),
      watchVolumeTracingAsync(),
    ];
  } catch (err) {
    alert(`\
Internal error.
Please reload the page to avoid losing data.

${err} ${err.stack}`);
  }
}
