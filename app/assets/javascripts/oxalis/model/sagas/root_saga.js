import { watchPushSettingsAsync, initializeSettingsAsync } from "oxalis/model/sagas/settings_saga";
import { watchSkeletonTracingAsync } from "oxalis/model/sagas/skeletontracing_saga";
import { pushAnnotationAsync, saveTracingAsync } from "oxalis/model/sagas/save_saga";
import { editVolumeLayerAsync, disallowVolumeTracingWarning } from "oxalis/model/sagas/volumetracing_saga";
import { alert } from "libs/window";

export default function* rootSaga() {
  try {
    yield [
      initializeSettingsAsync(),
      watchPushSettingsAsync(),
      watchSkeletonTracingAsync(),
      saveTracingAsync(),
      pushAnnotationAsync(),
      editVolumeLayerAsync(),
      disallowVolumeTracingWarning(),
    ];
  } catch (err) {
    alert(`\
Internal error.
Please reload the page to avoid losing data.

${err} ${err.stack}`);
  }
}
