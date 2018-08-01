// @flow
import { all, throttle, call, select, take } from "redux-saga/effects";
import Request from "libs/request";

function* pushUserSettingsAsync(): Generator<*, *, *> {
  const activeUser = yield select(state => state.activeUser);
  if (activeUser == null) return;

  const payload = yield select(state => state.userConfiguration);
  yield call(Request.sendJSONReceiveJSON, "/api/user/userConfiguration", { data: payload });
}

function* pushDatasetSettingsAsync(): Generator<*, *, *> {
  const activeUser = yield select(state => state.activeUser);
  if (activeUser == null) return;

  const datasetName = yield select(state => state.dataset.name);
  const payload = yield select(state => state.datasetConfiguration);
  yield call(Request.sendJSONReceiveJSON, `/api/dataSetConfigurations/${datasetName}`, {
    data: payload,
  });
}

export default function* watchPushSettingsAsync(): Generator<*, *, *> {
  yield take("INITIALIZE_SETTINGS");
  yield all([
    throttle(500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    throttle(500, "UPDATE_DATASET_SETTING", pushDatasetSettingsAsync),
    throttle(500, "UPDATE_LAYER_SETTING", pushDatasetSettingsAsync),
  ]);
}
