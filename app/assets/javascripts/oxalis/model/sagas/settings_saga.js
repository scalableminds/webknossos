// @flow
import { throttle, call, select, put, take } from "redux-saga/effects";
import Request from "libs/request";
import { initializeSettingsAction } from "oxalis/model/actions/settings_actions";

export function* initializeSettingsAsync(): Generator<*, *, *> {
  yield take("SET_DATASET");
  const datasetName = yield select(state => state.dataset.name);
  const [initialUserSettings, initialDatasetSettings] = yield [
    call(Request.receiveJSON, "/api/user/userConfiguration"),
    call(Request.receiveJSON, `/api/dataSetConfigurations/${datasetName}`),
  ];
  const action = initializeSettingsAction(initialUserSettings, initialDatasetSettings);
  yield put(action);
}

function* pushUserSettingsAsync() {
  const activeUser = yield select(state => state.activeUser);
  if (activeUser == null) return;

  const payload = yield select(state => state.userConfiguration);
  yield call(Request.sendJSONReceiveJSON, "/api/user/userConfiguration", { data: payload });
}

function* pushDatasetSettingsAsync() {
  const activeUser = yield select(state => state.activeUser);
  if (activeUser == null) return;

  const datasetName = yield select(state => state.dataset.name);
  const payload = yield select(state => state.datasetConfiguration);
  yield call(Request.sendJSONReceiveJSON, `/api/dataSetConfigurations/${datasetName}`, {
    data: payload,
  });
}

export function* watchPushSettingsAsync(): Generator<*, *, *> {
  yield take("INITIALIZE_SETTINGS");
  yield [
    throttle(500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    throttle(500, "UPDATE_DATASET_SETTING", pushDatasetSettingsAsync),
    throttle(500, "UPDATE_LAYER_SETTING", pushDatasetSettingsAsync),
  ];
}
