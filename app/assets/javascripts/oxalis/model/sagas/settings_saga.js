import { throttle, call, select, put, take } from "redux-saga/effects";
import Request from "libs/request";
import { initializeUserSettingsAction, initializeDatasetSettingsAction } from "oxalis/model/actions/settings_actions";

export function* initializeUserSettingsAsync() {
  const initialUserSettings = yield call(Request.receiveJSON.bind(Request), "/api/user/userConfiguration");
  const action = initializeUserSettingsAction(initialUserSettings);
  yield put(action);
}

export function* initializeDatasetSettingsAsync() {
  yield take("SET_DATASET_NAME");
  const datasetName = yield select(state => state.datasetName);
  const initialDatasetSettings = yield call(Request.receiveJSON.bind(Request), `/api/dataSetConfigurations/${datasetName}`);
  const action = initializeDatasetSettingsAction(initialDatasetSettings);
  yield put(action);
}

function* pushUserSettingsAsync() {
  const payload = yield select(state => state.userConfiguration);
  yield call(Request.sendJSONReceiveJSON.bind(Request), "/api/user/userConfiguration", { data: payload });
}

function* pushDatasetSettingsAsync() {
  const datasetName = yield select(state => state.datasetName);
  const payload = yield select(state => state.datasetConfiguration);
  yield call(Request.sendJSONReceiveJSON.bind(Request), `/api/dataSetConfigurations/${datasetName}`, { data: payload });
}

export function* watchPushSettingsAsync() {
  yield [
    throttle(500, "UPDATE_USER_SETTING", pushUserSettingsAsync),
    throttle(500, "UPDATE_DATASET_SETTING", pushDatasetSettingsAsync),
    throttle(500, "UPDATE_LAYER_SETTING", pushDatasetSettingsAsync),
  ];
}

