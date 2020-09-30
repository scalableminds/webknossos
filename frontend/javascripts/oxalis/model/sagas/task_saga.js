// @flow
import React from "react";
import _ from "lodash";

import type { APITaskType } from "admin/api_flow_types";
import { type Saga, call, put, select, take } from "oxalis/model/sagas/effect-generators";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateUserSettingAction,
  updateLayerSettingAction,
} from "oxalis/model/actions/settings_actions";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { setMergerModeEnabledAction } from "oxalis/model/actions/skeletontracing_actions";
import { updateLastTaskTypeIdOfUser } from "admin/admin_rest_api";
import NewTaskDescriptionModal from "oxalis/view/new_task_description_modal";
import RecommendedConfigurationModal from "oxalis/view/recommended_configuration_modal";
import Toast from "libs/toast";
import messages from "messages";
import renderIndependently from "libs/render_independently";
import Model from "oxalis/model";

function* maybeShowNewTaskTypeModal(taskType: APITaskType): Saga<void> {
  // Users can acquire new tasks directly in the tracing view. Occasionally,
  // they start working on a new TaskType and need to be instructed.
  const title = `Attention, new Task Type: ${taskType.summary}`;
  let text;
  if (taskType.description) {
    text = `${messages["task.new_description"]}:\n${taskType.description}`;
  } else {
    text = messages["task.no_description"];
  }

  yield* call(renderIndependently, destroy => (
    <NewTaskDescriptionModal title={title} description={text} destroy={destroy} />
  ));
}

function* maybeShowRecommendedConfiguration(taskType: APITaskType): Saga<void> {
  const { recommendedConfiguration } = taskType;
  if (recommendedConfiguration == null || _.size(recommendedConfiguration) === 0) return;

  const userConfiguration = yield* select(state => state.userConfiguration);
  const datasetConfiguration = yield* select(state => state.datasetConfiguration);
  const zoomStep = yield* select(state => state.flycam.zoomStep);
  const segmentationLayerName = yield* call([Model, Model.getSegmentationLayerName]);
  const segmentationOpacity =
    segmentationLayerName != null ? datasetConfiguration.layers[segmentationLayerName].alpha : 0;

  // $FlowFixMe Cannot call `_.find` because number [1] is incompatible with boolean [2] in property `brushSize` of type argument `T`.
  const configurationDifference = _.find(recommendedConfiguration, (value, key: string) => {
    if (key === "zoom" && zoomStep !== value) {
      return true;
    } else if (key === "segmentationOpacity" && segmentationOpacity !== value) {
      return true;
    } else if (key in userConfiguration && userConfiguration[key] !== value) {
      return true;
    } else if (key in datasetConfiguration && datasetConfiguration[key] !== value) {
      return true;
    }
    return false;
  });
  if (configurationDifference == null) return;

  let confirmed = false;
  // The renderIndependently call returns a promise that is only resolved
  // once destroy is called. yield* will wait until the returned promise is resolved.
  yield* call(renderIndependently, destroy => (
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
        yield* put(setZoomStepAction(recommendedConfiguration[key]));
      } else if (key === "segmentationOpacity" && segmentationLayerName != null) {
        yield* put(
          updateLayerSettingAction(segmentationLayerName, "alpha", recommendedConfiguration[key]),
        );
      } else if (key in userConfiguration) {
        // $FlowFixMe Cannot call updateUserSettingAction with key bound to propertyName because an indexer property is missing in UserConfiguration
        yield* put(updateUserSettingAction(key, recommendedConfiguration[key]));
      } else if (key in datasetConfiguration) {
        // $FlowFixMe Cannot call updateDatasetSettingAction with key bound to propertyName because an indexer property is missing in DatasetConfiguration
        yield* put(updateDatasetSettingAction(key, recommendedConfiguration[key]));
      } else {
        console.warn(
          // $FlowFixMe
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
  yield* take("WK_READY");

  const task = yield* select(state => state.task);
  const activeUser = yield* select(state => state.activeUser);
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
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
