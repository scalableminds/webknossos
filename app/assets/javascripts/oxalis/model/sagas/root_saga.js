import { watchPushSettingsAsync, initializeSettingsAsync } from "./settings_saga";

export default function* rootSaga() {
  yield [
    initializeSettingsAsync(),
    watchPushSettingsAsync(),
  ];
}
