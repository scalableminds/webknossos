// @flow
import React from "react";
import _ from "lodash";

import type { APITaskType } from "admin/api_flow_types";
import { type Saga, call, put, select, take } from "oxalis/model/sagas/effect-generators";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
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

  const isConfigurationDifferent = _.reduce(
    settingsObject,
    (acc: boolean, value, key: string) =>
      acc || (userConfiguration[key] !== value && datasetConfiguration[key] !== value),
    false,
  );

  if (!isConfigurationDifferent) return;

  let confirmed = false;
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
      if (userConfiguration[key] != null) {
        yield* put(updateUserSettingAction(key, settingsObject[key]));
      } else if (datasetConfiguration[key] != null) {
        yield* put(updateDatasetSettingAction(key, settingsObject[key]));
      }
    }
    Toast.success("You are using the recommended settings now.");
  }
}

export default function* watchTasksAsync(): Saga<void> {
  yield* take("WK_READY");

  const task = yield* select(state => state.task);
  const { version } = getSomeTracing(yield* select(state => state.tracing));
  // Only execute these functions for tasks that are not modified yet
  if (task != null && version <= 1) {
    yield* call(maybeShowNewTaskTypeModal, task.type);
    yield* call(maybeShowRecommendedConfiguration, task.type);
  }
}
