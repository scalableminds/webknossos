import { watchPushSettingsAsync, initializeSettingsAsync } from "oxalis/model/sagas/settings_saga";

export default function* rootSaga() {
  yield [
    initializeSettingsAsync(),
    watchPushSettingsAsync(),
  ];
}
