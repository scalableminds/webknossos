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
import { watchAnnotationAsync } from "oxalis/model/sagas/annotation_saga";
import { alert } from "libs/window";
import { select, fork, take, cancel } from "redux-saga/effects";
import Model from "oxalis/model";
import Toast from "libs/toast";
import messages from "messages";

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
  const warnMaybe = function* warnMaybe() {
    const shouldWarn = Model.shouldDisplaySegmentationData() && !Model.canDisplaySegmentationData();
    if (shouldWarn) {
      const isVolumeTracing = yield select(state => state.tracing.type === "volume");
      if (isVolumeTracing) {
        Toast.message("error", messages["tracing.segmentation_zoom_warning"], true);
      } else {
        Toast.message("info", messages["tracing.segmentation_zoom_warning"], false, 3000);
      }
    } else if (!shouldWarn) {
      Toast.close(messages["tracing.segmentation_zoom_warning"]);
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
