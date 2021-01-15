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
  try {
    yield* call(updateDatasetConfiguration, dataset, datasetConfiguration);
  } catch (error) {
    // We catch errors in view mode as they are not that important here and may annoy the user.
    const tracing = yield* select(state => state.tracing);
    const isViewMode = tracing.annotationType === "View";
    if (!isViewMode) {
      throw error;
    }
  }
}

function* trackUserSettingsAsync(action: UpdateUserSettingAction): Saga<void> {
  if (action.propertyName === "newNodeNewTree") {
    yield* call(trackAction, `${action.value ? "Enabled" : "Disabled"} soma clicking`);
  }
}

function* showUserSettingToast(action: UpdateUserSettingAction): Saga<void> {
  const { propertyName } = action;
  if (propertyName === "moveValue" || propertyName === "moveValue3d") {
    const moveValue = yield* select(state => state.userConfiguration[propertyName]);
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
