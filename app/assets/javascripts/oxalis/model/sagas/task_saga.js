// @flow
import React from "react";
import _ from "lodash";

import type { APITaskType, APIUser } from "admin/api_flow_types";
import { type Saga, call, put, select } from "oxalis/model/sagas/effect-generators";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { updateUser } from "admin/admin_rest_api";
import NewTaskDescriptionModal from "oxalis/view/new_task_description_modal";
import RecommendConfigurationModal from "oxalis/view/recommended_configuration_modal";
import Toast from "libs/toast";
import messages from "messages";
import renderIndependently from "libs/render_independently";

function* maybeShowNewTaskTypeModal(taskType: APITaskType): Saga<void> {
  // Users can aquire new tasks directly in the tracing view. Occasionally,
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
  const task = yield* select(state => state.task);
  const activeUser = yield* select(state => state.activeUser);
  if (task == null || activeUser == null) return;

  const { lastTaskTypeId } = activeUser;
  const isDifferentTaskType = lastTaskTypeId == null || lastTaskTypeId !== task.type.id;
  if (isDifferentTaskType) {
    yield* call(maybeShowNewTaskTypeModal, task.type);
    yield* call(maybeShowRecommendedConfiguration, task.type);

    const updatedUser: $Shape<APIUser> = { id: activeUser.id, lastTaskTypeId: task.type.id };
    yield* call(updateUser, updatedUser);
  }
}
