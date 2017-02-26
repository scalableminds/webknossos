import { watchPushSettingsAsync, initializeSettingsAsync } from "./settings_saga";
import { watchSkeletonTracingAsync } from "./skeletontracing_saga";

export default function* rootSaga() {
  yield [
    initializeSettingsAsync(),
    watchPushSettingsAsync(),
    watchSkeletonTracingAsync(),
  ];
}
