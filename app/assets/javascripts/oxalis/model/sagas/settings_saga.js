// @flow
import {
  type Saga,
  _all,
  _throttle,
  call,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import { updateUserConfiguration, updateDatasetConfiguration } from "admin/admin_rest_api";

function* pushUserSettingsAsync(): Saga<void> {
  const activeUser = yield* select(state => state.activeUser);
  if (activeUser == null) return;

  const userConfiguration = yield* select(state => state.userConfiguration);
  yield* call(updateUserConfiguration, userConfiguration);
}

function* pushDatasetSettingsAsync(): Saga<void> {
  const activeUser = yield* select(state => state.activeUser);
  if (activeUser == null) return;

  const dataset = yield* select(state => state.dataset);
  const datasetConfiguration = yield* select(state => state.datasetConfiguration);
  yield* call(updateDatasetConfiguration, dataset, datasetConfiguration);
}

export default function* watchPushSettingsAsync(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");
  yield _all([
    _throttle(500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    _throttle(500, "UPDATE_DATASET_SETTING", pushDatasetSettingsAsync),
    _throttle(500, "UPDATE_LAYER_SETTING", pushDatasetSettingsAsync),
  ]);
}
