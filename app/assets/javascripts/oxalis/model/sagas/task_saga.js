// @flow
import React from "react";
import _ from "lodash";

import type { APITaskType } from "admin/api_flow_types";
import { type Saga, call, put, select, take } from "oxalis/model/sagas/effect-generators";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import NewTaskDescriptionModal from "oxalis/view/new_task_description_modal";
import RecommendConfigurationModal from "oxalis/view/recommended_configuration_modal";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import renderIndependently from "libs/render_independently";

function* maybeShowNewTaskTypeModal(taskType: APITaskType): Saga<void> {
  // Users can aquire new tasks directly in the tracing view. Occasionally,
  // they start working on a new TaskType and need to be instructed.
  const hasDifferentTaskType = yield* call(Utils.hasUrlParam, "differentTaskType");
  if (!hasDifferentTaskType) {
    return;
  }

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
  if (recommendedConfiguration == null) return;

  const settingsObject = JSON.parse(recommendedConfiguration);
  if (_.size(settingsObject) === 0) return;

  const userConfiguration = yield* select(state => state.userConfiguration);
  const datasetConfiguration = yield* select(state => state.datasetConfiguration);
  const zoomStep = yield* select(state => state.flycam.zoomStep);

  const configurationDifference = _.find(settingsObject, (value, key: string) => {
    if (key === "zoom" && zoomStep !== value) {
      return true;
    } else if (userConfiguration[key] != null && userConfiguration[key] !== value) {
      return true;
    } else if (datasetConfiguration[key] != null && datasetConfiguration[key] !== value) {
      return true;
    }
    return false;
  });
  if (configurationDifference == null) return;

  let confirmed = false;
  // The renderIndependently call returns a promise that is only resolved
  // once destroy is called. yield* will wait until the returned promise is resolved.
  yield* call(renderIndependently, destroy => (
    <RecommendConfigurationModal
      config={settingsObject}
      onOk={() => {
        confirmed = true;
      }}
      destroy={destroy}
    />
  ));

  if (confirmed) {
    for (const key of Object.keys(settingsObject)) {
      if (key === "zoom") {
        yield* put(setZoomStepAction(settingsObject[key]));
      } else if (userConfiguration[key] != null) {
        yield* put(updateUserSettingAction(key, settingsObject[key]));
      } else if (datasetConfiguration[key] != null) {
        yield* put(updateDatasetSettingAction(key, settingsObject[key]));
      }
    }
    Toast.success("You are using the recommended settings now.");
  }
}

export default function* watchTasksAsync(): Saga<void> {
  const wkReadyAction = yield* take("WK_READY");

  const task = yield* select(state => state.task);
  const { version } = getSomeTracing(yield* select(state => state.tracing));
  // Only execute these functions for tasks that are not modified yet
  if (wkReadyAction.initialDispatch && task != null && version <= 1) {
    yield* call(maybeShowNewTaskTypeModal, task.type);
    yield* call(maybeShowRecommendedConfiguration, task.type);
  }
}
