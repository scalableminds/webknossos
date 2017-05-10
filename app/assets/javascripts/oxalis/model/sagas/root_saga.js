// @flow

import { watchPushSettingsAsync, initializeSettingsAsync } from "oxalis/model/sagas/settings_saga";
import { watchSkeletonTracingAsync, saveSkeletonTracingAsync } from "oxalis/model/sagas/skeletontracing_saga";
import { pushAnnotationAsync } from "oxalis/model/sagas/save_saga";
import { initializeTaskAsync } from "oxalis/model/sagas/task_saga";
import { alert } from "libs/window";

export default function* rootSaga(): Generator<*, *, *> {
  try {
    yield [
      initializeSettingsAsync(),
      watchPushSettingsAsync(),
      watchSkeletonTracingAsync(),
      saveSkeletonTracingAsync(),
      pushAnnotationAsync(),
      initializeTaskAsync(),
    ];
  } catch (err) {
    alert(`\
Internal error.
Please reload the page to avoid losing data.

${err} ${err.stack}`);
  }
}
