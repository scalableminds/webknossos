import { updateLastTaskTypeIdOfUser } from "admin/rest_api";
import { Button } from "antd";
import renderIndependently from "libs/render_independently";
import Toast from "libs/toast";
import { clamp } from "libs/utils";
import _ from "lodash";
import messages from "messages";
import React from "react";
import { call, delay, put, take } from "typed-redux-saga";
import type { APITaskType } from "types/api_types";
import { getSegmentationLayers } from "viewer/model/accessors/dataset_accessor";
import {
  getValidTaskZoomRange,
  isMagRestrictionViolated,
} from "viewer/model/accessors/flycam_accessor";
import { setZoomStepAction } from "viewer/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { setMergerModeEnabledAction } from "viewer/model/actions/skeletontracing_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import Store, { type RecommendedConfiguration } from "viewer/store";
import NewTaskDescriptionModal from "viewer/view/new_task_description_modal";
import RecommendedConfigurationModal from "viewer/view/recommended_configuration_modal";
import { ensureWkReady } from "./ready_sagas";

function* maybeShowNewTaskTypeModal(taskType: APITaskType): Saga<void> {
  // Users can acquire new tasks directly in the tracing view. Occasionally,
  // they start working on a new TaskType and need to be instructed.
  const title = `Attention, new Task Type: ${taskType.summary}`;
  let text: string;

  if (taskType.description) {
    text = `${messages["task.new_description"]}:\n${taskType.description}`;
  } else {
    text = messages["task.no_description"];
  }

  yield* call(renderIndependently, (destroy) => (
    <NewTaskDescriptionModal title={title} description={text} destroy={destroy} />
  ));
}

function* maybeShowRecommendedConfiguration(taskType: APITaskType): Saga<void> {
  const { recommendedConfiguration } = taskType;
  if (recommendedConfiguration == null || _.size(recommendedConfiguration) === 0) return;
  const userConfiguration = yield* select((state) => state.userConfiguration);
  const datasetConfiguration = yield* select((state) => state.datasetConfiguration);
  const zoomStep = yield* select((state) => state.flycam.zoomStep);
  const segmentationLayers = yield* select((state) => getSegmentationLayers(state.dataset));

  const configurationDifference = _.find(recommendedConfiguration, (value, _key) => {
    const key = _key as keyof RecommendedConfiguration;
    if (key === "zoom" && zoomStep !== value) {
      return true;
    } else if (key === "segmentationOpacity") {
      const opacities = _.uniq(
        segmentationLayers.map((layer) => datasetConfiguration.layers[layer.name].alpha),
      );

      // If there are different opacity values for the segmentation layers, the recommendation
      // differs. Otherwise, we compare the one opacity value with the recommended one.
      if (opacities.length > 1 || opacities[0] !== value) {
        return true;
      } else {
        return false;
      }
      // @ts-ignore
    } else if (key in userConfiguration && userConfiguration[key] !== value) {
      return true;
      // @ts-ignore
    } else if (key in datasetConfiguration && datasetConfiguration[key] !== value) {
      return true;
    }

    return false;
  });

  if (configurationDifference == null) return;
  let confirmed = false;
  // The renderIndependently call returns a promise that is only resolved
  // once destroy is called. yield* will wait until the returned promise is resolved.
  yield* call(renderIndependently, (destroy) => (
    <RecommendedConfigurationModal
      config={recommendedConfiguration}
      onOk={() => {
        confirmed = true;
      }}
      destroy={destroy}
    />
  ));

  if (confirmed) {
    for (const key of Object.keys(recommendedConfiguration)) {
      if (key === "zoom") {
        const newZoom = recommendedConfiguration[key];
        if (newZoom != null) {
          yield* put(setZoomStepAction(newZoom));
        }
      } else if (key === "segmentationOpacity") {
        const alphaValue = recommendedConfiguration[key];
        if (alphaValue != null) {
          for (const segmentationLayer of segmentationLayers) {
            yield* put(updateLayerSettingAction(segmentationLayer.name, "alpha", alphaValue));
          }
        }
      } else if (key in userConfiguration) {
        // @ts-ignore
        yield* put(updateUserSettingAction(key, recommendedConfiguration[key]));
      } else if (key in datasetConfiguration) {
        // @ts-ignore
        yield* put(updateDatasetSettingAction(key, recommendedConfiguration[key]));
      } else {
        console.warn(
          // @ts-ignore
          `Cannot apply recommended default for key/value: ${key}/${recommendedConfiguration[key]}`,
        );
      }
    }

    Toast.success("You are using the recommended settings now.");
  }
}

function* maybeActivateMergerMode(taskType: APITaskType): Saga<void> {
  if (taskType.settings.mergerMode) yield* put(setMergerModeEnabledAction(true));
}

export default function* watchTasksAsync(): Saga<void> {
  yield* call(ensureWkReady);
  const task = yield* select((state) => state.task);
  const activeUser = yield* select((state) => state.activeUser);
  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  if (task == null || activeUser == null || !allowUpdate) return;
  yield* call(maybeActivateMergerMode, task.type);
  const { lastTaskTypeId } = activeUser;
  const isDifferentTaskType = lastTaskTypeId == null || lastTaskTypeId !== task.type.id;

  if (isDifferentTaskType) {
    yield* call(maybeShowNewTaskTypeModal, task.type);
    yield* call(maybeShowRecommendedConfiguration, task.type);
    const fullUser = yield* call(updateLastTaskTypeIdOfUser, activeUser.id, task.type.id);
    yield* put(setActiveUserAction(fullUser));
  }
}
export function* warnAboutMagRestriction(): Saga<void> {
  function* warnMaybe(): Saga<void> {
    const { allowUpdate } = yield* select((state) => state.annotation.restrictions);

    if (!allowUpdate) {
      // If updates are not allowed in general, we return here, since we don't
      // want to show any warnings when the user cannot edit the annotation in the first
      // place (e.g., when viewing the annotation of another user).
      return;
    }

    const isViolated = yield* select(isMagRestrictionViolated);
    const toastConfig = {
      sticky: true,
      key: "mag-restriction-warning",
    };

    if (isViolated) {
      const [min, max] = yield* select((storeState) => getValidTaskZoomRange(storeState, true));

      const clampZoom = () => {
        const currentZoomStep = Store.getState().flycam.zoomStep;
        const newZoomValue = clamp(min, currentZoomStep, max);
        Store.dispatch(setZoomStepAction(newZoomValue));
      };

      let constraintString = `between ${min.toFixed(2)} and ${max.toFixed(2)}`;
      if (min === 0) {
        constraintString = `lower than ${max.toFixed(2)}`;
      } else if (max === Number.POSITIVE_INFINITY) {
        constraintString = `greater than ${min.toFixed(2)}`;
      }

      const message = (
        <React.Fragment>
          Annotating data is restricted to a certain zoom range. Please adapt the zoom value so that
          it is {constraintString}. Alternatively, click{" "}
          <Button
            type="link"
            onClick={clampZoom}
            style={{
              padding: 0,
            }}
          >
            here
          </Button>{" "}
          to adjust the zoom accordingly.
        </React.Fragment>
      );
      Toast.error(message, toastConfig);
    } else {
      Toast.close(toastConfig.key);
    }
  }

  yield* call(ensureWkReady);
  // Wait before showing the initial warning. Due to initialization lag it may only be visible very briefly, otherwise.
  yield* delay(5000);
  yield* warnMaybe();

  while (true) {
    yield* take(["ZOOM_IN", "ZOOM_OUT", "ZOOM_BY_DELTA", "SET_ZOOM_STEP", "SET_STORED_LAYOUTS"]);
    yield* warnMaybe();
  }
}
