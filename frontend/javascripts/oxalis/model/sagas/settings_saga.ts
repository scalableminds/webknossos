import { updateDatasetConfiguration, updateUserConfiguration } from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import messages from "messages";
import type { UpdateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { type Saga, select, take } from "oxalis/model/sagas/effect-generators";
import {
  SETTINGS_MAX_RETRY_COUNT,
  SETTINGS_RETRY_DELAY,
} from "oxalis/model/sagas/save_saga_constants";
import type { DatasetConfiguration, DatasetLayerConfiguration } from "oxalis/store";
import { all, call, debounce, retry, takeEvery } from "typed-redux-saga";

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

  const maybeMaskedDatasetConfiguration = yield* prepareDatasetSettingsForSaving(
    datasetConfiguration,
    originalDatasetSettings,
  );

  try {
    yield* retry(
      SETTINGS_MAX_RETRY_COUNT,
      SETTINGS_RETRY_DELAY,
      updateDatasetConfiguration,
      dataset.id,
      maybeMaskedDatasetConfiguration,
    );
  } catch (error) {
    // We catch errors in view mode as they are not that important here and may annoy the user.
    const annotation = yield* select((state) => state.annotation);
    const isViewMode = annotation.annotationType === "View";

    if (!isViewMode) {
      throw error;
    } else {
      // Still log the error to airbrake in view mode.
      // @ts-ignore
      yield* call({ context: ErrorHandling, fn: ErrorHandling.notify }, error);
    }
  }
}

function* prepareDatasetSettingsForSaving(
  datasetConfiguration: DatasetConfiguration,
  originalDatasetSettings: DatasetConfiguration,
) {
  /**
   * If an annotation is open, we don't want to change the visibility settings for
   * the data layers within the dataset configuration. Instead, the visibilities
   * are stored separately within the annotation (see annotation_saga.ts).
   * Therefore, we restore the layer visibilities to their original value before
   * sending them to the back-end.
   * This is not very elegant, but currently the workaround to achieve that creating
   * a new annotation with a fresh volume layer does not hide the original segmentation
   * layer by default when opening the corresponding dataset again.
   * Alternatively, annotation and dataset related settings could be maintained in the
   * Store. However, implementing this would be quite involved.
   * Also refer to the discussion here:
   * https://github.com/scalableminds/webknossos/pull/6186/files#r861800882
   */
  const controlMode = yield* select((state) => state.temporaryConfiguration.controlMode);

  if (controlMode === "VIEW") {
    return datasetConfiguration;
  }

  const newLayers: Record<string, DatasetLayerConfiguration> = {};
  for (const layerName of Object.keys(datasetConfiguration.layers)) {
    newLayers[layerName] = {
      ...datasetConfiguration.layers[layerName],
      isDisabled: originalDatasetSettings.layers[layerName].isDisabled,
    };
  }

  const maskedDatasetConfiguration = {
    ...datasetConfiguration,
    layers: newLayers,
  };
  return maskedDatasetConfiguration;
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
    throw new Error("Unexpected action. Satisfy typescript.");
  }

  const { originalDatasetSettings } = action;

  yield* all([
    debounce(2500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    debounce(2500, "UPDATE_DATASET_SETTING", () =>
      pushDatasetSettingsAsync(originalDatasetSettings),
    ),
    debounce(2500, "UPDATE_LAYER_SETTING", () => pushDatasetSettingsAsync(originalDatasetSettings)),
    takeEvery("UPDATE_USER_SETTING", showUserSettingToast),
  ]);
}
