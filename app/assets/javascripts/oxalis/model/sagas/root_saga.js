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
import { select, fork, take, cancel } from "redux-saga/effects";
import Model from "oxalis/model";
import Toast from "libs/toast";

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

// TODO: move this saga functionality as soon as annotation_saga.js was merged

function* warnAboutSegmentationOpacity(): Generator<*, *, *> {
  let zoomStepWarningToast;
  const warnMaybe = function*() {
    const shouldWarn = Model.shouldDisplaySegmentationData() && !Model.canDisplaySegmentationData();
    if (shouldWarn && zoomStepWarningToast == null) {
      const toastType = yield select(
        state => (state.tracing.type === "volume" ? "danger" : "info"),
      );
      zoomStepWarningToast = Toast.message(
        toastType,
        "Segmentation data and volume tracing is only fully supported at a smaller zoom level.",
        true,
      );
    } else if (!shouldWarn && zoomStepWarningToast != null) {
      zoomStepWarningToast.remove();
      zoomStepWarningToast = null;
    }
  };

  yield take("INITIALIZE_SETTINGS");
  yield* warnMaybe();

  while (true) {
    yield take([
      "ZOOM_IN",
      "ZOOM_OUT",
      "ZOOM_BY_DELTA",
      "SET_ZOOM_STEP",
      action =>
        action.type === "UPDATE_DATASET_SETTING" && action.propertyName === "segmentationOpacity",
    ]);
    yield* warnMaybe();
  }
}
