import { watchPushSettingsAsync, initializeSettingsAsync } from "oxalis/model/sagas/settings_saga";
import { watchSkeletonTracingAsync, saveSkeletonTracingAsync } from "./skeletontracing_saga";

export default function* rootSaga() {
  yield [
    initializeSettingsAsync(),
    watchPushSettingsAsync(),
    watchSkeletonTracingAsync(),
    saveSkeletonTracingAsync(),
  ];
}
