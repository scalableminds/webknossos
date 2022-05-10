import _ from "lodash";
import {
  SETTINGS_MAX_RETRY_COUNT,
  SETTINGS_RETRY_DELAY,
} from "oxalis/model/sagas/save_saga_constants";
import { type Saga, take } from "oxalis/model/sagas/effect-generators";
import { all, takeEvery, throttle, call, retry } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import type { UpdateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { trackAction } from "oxalis/model/helpers/analytics";
import { updateUserConfiguration, updateDatasetConfiguration } from "admin/admin_rest_api";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import messages from "messages";
import { DatasetConfiguration } from "oxalis/store";

function* pushUserSettingsAsync(): Saga<void> {
  const activeUser = yield* select((state) => state.activeUser);
  if (activeUser == null) return;
  const userConfiguration = yield* select((state) => state.userConfiguration);
  yield* retry(
    SETTINGS_MAX_RETRY_COUNT,
    SETTINGS_RETRY_DELAY,
    updateUserConfiguration,
    userConfiguration,
  );
}

function* pushDatasetSettingsAsync(originalDatasetSettings: DatasetConfiguration): Saga<void> {
  const activeUser = yield* select((state) => state.activeUser);
  if (activeUser == null) return;
  const dataset = yield* select((state) => state.dataset);
  const datasetConfiguration = yield* select((state) => state.datasetConfiguration);

  const maskedDatasetConfiguration = _.cloneDeep(datasetConfiguration);
  const controlMode = yield* select((state) => state.temporaryConfiguration.controlMode);

  if (controlMode != "VIEW") {
    for (const layerName of Object.keys(datasetConfiguration.layers)) {
      maskedDatasetConfiguration.layers[layerName].isDisabled =
        originalDatasetSettings.layers[layerName].isDisabled;
    }
  }

  try {
    yield* retry(
      SETTINGS_MAX_RETRY_COUNT,
      SETTINGS_RETRY_DELAY,
      updateDatasetConfiguration,
      dataset,
      maskedDatasetConfiguration,
    );
  } catch (error) {
    // We catch errors in view mode as they are not that important here and may annoy the user.
    const tracing = yield* select((state) => state.tracing);
    const isViewMode = tracing.annotationType === "View";

    if (!isViewMode) {
      throw error;
    } else {
      // Still log the error to airbrake in view mode.
      // @ts-ignore
      yield* call({ context: ErrorHandling, fn: ErrorHandling.notify }, error);
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
    const moveValue = yield* select((state) => state.userConfiguration[propertyName]);
    const moveValueMessage = messages["tracing.changed_move_value"] + moveValue;
    Toast.success(moveValueMessage, {
      key: "CHANGED_MOVE_VALUE",
    });
  }
}

export default function* watchPushSettingsAsync(): Saga<void> {
  const action = yield* take("INITIALIZE_SETTINGS");
  if (action.type !== "INITIALIZE_SETTINGS") {
    throw new Error("Unexpected action. Satisfy flow.");
  }

  const { originalDatasetSettings } = action;

  yield* all([
    throttle(500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    throttle(500, "UPDATE_DATASET_SETTING", () =>
      pushDatasetSettingsAsync(originalDatasetSettings),
    ),
    throttle(500, "UPDATE_LAYER_SETTING", () => pushDatasetSettingsAsync(originalDatasetSettings)),
    takeEvery("UPDATE_USER_SETTING", trackUserSettingsAsync),
    takeEvery("UPDATE_USER_SETTING", showUserSettingToast),
  ]);
}
