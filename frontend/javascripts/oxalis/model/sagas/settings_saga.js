// @flow
import {
  type Saga,
  _all,
  _takeEvery,
  _throttle,
  call,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import { updateUserConfiguration, updateDatasetConfiguration } from "admin/admin_rest_api";
import { trackAction } from "oxalis/model/helpers/analytics";
import { type UpdateUserSettingAction } from "oxalis/model/actions/settings_actions";

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

function* trackUserSettingsAsync(action: UpdateUserSettingAction): Saga<void> {
  if (action.propertyName === "newNodeNewTree") {
    yield* call(trackAction, `${action.value ? "Enabled" : "Disabled"} soma clicking`);
  }
}

export default function* watchPushSettingsAsync(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");
  yield _all([
    _throttle(500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    _throttle(500, "UPDATE_DATASET_SETTING", pushDatasetSettingsAsync),
    _throttle(500, "UPDATE_LAYER_SETTING", pushDatasetSettingsAsync),
    _takeEvery("UPDATE_USER_SETTING", trackUserSettingsAsync),
  ]);
}
