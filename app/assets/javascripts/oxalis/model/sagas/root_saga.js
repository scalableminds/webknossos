import { watchPushSettingsAsync, initializeSettingsAsync } from "oxalis/model/sagas/settings_saga";
import { watchSkeletonTracingAsync, saveSkeletonTracingAsync } from "oxalis/model/sagas/skeletontracing_saga";
import { pushAnnotationAsync } from "oxalis/model/sagas/save_saga";

export default function* rootSaga() {
  yield [
    initializeSettingsAsync(),
    watchPushSettingsAsync(),
    watchSkeletonTracingAsync(),
    saveSkeletonTracingAsync(),
    pushAnnotationAsync(),
  ];
}
