import { initializeUserSettingsAsync, watchPushSettingsAsync, initializeDatasetSettingsAsync } from "./settings_saga";

export default function* rootSaga() {
  yield [
    initializeUserSettingsAsync(),
    initializeDatasetSettingsAsync(),
    watchPushSettingsAsync(),
  ];
}
