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
import { _all, _call, fork, take, _cancel, type Saga } from "oxalis/model/sagas/effect-generators";

export default function* rootSaga(): Saga<void> {
  while (true) {
    const task = yield* fork(restartableSaga);
    yield* take("RESTART_SAGA");
    yield _cancel(task);
  }
}

function* restartableSaga(): Saga<void> {
  try {
    yield _all([
      _call(warnAboutSegmentationOpacity),
      _call(watchPushSettingsAsync),
      _call(watchSkeletonTracingAsync),
      _call(collectUndoStates),
      _call(saveTracingAsync),
      _call(pushAnnotationAsync),
      _call(editVolumeLayerAsync),
      _call(disallowVolumeTracingWarning),
      _call(watchVolumeTracingAsync),
      _call(watchAnnotationAsync),
      _call(watchDataRelevantChanges),
    ]);
  } catch (err) {
    console.error(err);
    alert(`\
Internal error.
Please reload the page to avoid losing data.

${err} ${err.stack}`);
  }
}
