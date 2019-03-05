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
import messages from "messages";
import Toast from "libs/toast";

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

function* showUserSettingToast(action: UpdateUserSettingAction): Saga<void> {
  if (action.propertyName === "moveValue" || action.propertyName === "moveValue3d") {
    // $FlowFixMe moveValue and moveValue3d are both numbers
    const moveValue: number = yield* select(state => state.userConfiguration[action.propertyName]);
    const moveValueMessage = messages["tracing.changed_move_value"] + moveValue;
    Toast.success(moveValueMessage, { key: "CHANGED_MOVE_VALUE" });
  }
}

export default function* watchPushSettingsAsync(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");
  yield _all([
    _throttle(500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    _throttle(500, "UPDATE_DATASET_SETTING", pushDatasetSettingsAsync),
    _throttle(500, "UPDATE_LAYER_SETTING", pushDatasetSettingsAsync),
    _takeEvery("UPDATE_USER_SETTING", trackUserSettingsAsync),
    _takeEvery("UPDATE_USER_SETTING", showUserSettingToast),
  ]);
}
