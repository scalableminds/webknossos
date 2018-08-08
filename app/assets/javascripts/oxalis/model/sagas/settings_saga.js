// @flow
import {
  _all,
  _throttle,
  call,
  select,
  take,
  type Saga,
} from "oxalis/model/sagas/effect-generators";
import Request from "libs/request";
import { updateUserConfiguration, updateDatasetSettings } from "admin/admin_rest_api";

function* pushUserSettingsAsync(): Saga<void> {
  const activeUser = yield* select(state => state.activeUser);
  if (activeUser == null) return;

  const payload = yield* select(state => state.userConfiguration);
  yield* call(updateUserConfiguration, payload);
}

function* pushDatasetSettingsAsync(): Saga<void> {
  const activeUser = yield* select(state => state.activeUser);
  if (activeUser == null) return;

  const datasetName = yield* select(state => state.dataset.name);
  const payload = yield* select(state => state.datasetConfiguration);
  yield* call(updateDatasetSettings, datasetName, payload);
}

export default function* watchPushSettingsAsync(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");
  yield _all([
    _throttle(500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    _throttle(500, "UPDATE_DATASET_SETTING", pushDatasetSettingsAsync),
    _throttle(500, "UPDATE_LAYER_SETTING", pushDatasetSettingsAsync),
  ]);
}
