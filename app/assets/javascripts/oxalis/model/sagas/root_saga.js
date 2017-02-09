import { watchPushSettingsAsync, initializeDatasetSettingsAsync } from "./settings_saga";

export default function* rootSaga() {
  yield [
    initializeSettingsAsync(),
    watchPushSettingsAsync(),
  ];
}
