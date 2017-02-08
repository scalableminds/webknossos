import { takeEvery, call, select, put } from "redux-saga/effects";
import Request from "libs/request";
import { initializeUserSettingsAction, initializeDatasetSettingsAction } from "oxalis/model/actions/settings_actions";

export function* initializeUserSettingsAsync() {
  const initialUserSettings = yield call(Request.receiveJSON.bind(Request), "/api/user/userConfiguration");
  const action = initializeUserSettingsAction(initialUserSettings);
  yield put(action);
}

export function* initializeDatasetSettingsAsync() {
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
  const payload = yield select(state => state.datasetConfiguration);
  yield call(Request.sendJSONReceiveJSON.bind(Request), "/api/user/dataSetConfigurations", { data: payload });
}

export function* watchPushSettingsAsync() {
  yield [
    takeEvery("UPDATE_USER_SETTING", pushUserSettingsAsync),
    takeEvery("UPDATE_DATASET_SETTING", pushDatasetSettingsAsync),
    takeEvery("UPDATE_LAYER_SETTING", pushDatasetSettingsAsync),
  ];
}

