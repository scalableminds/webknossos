import { takeEvery, apply, call, select, put } from "redux-saga/effects";
import Request from "libs/request";
import { initializeSettingsAction } from "oxalis/model/actions/settings_actions";

export function* initializeSettingsAsync() {
  const initialUserSettings = yield call(Request.receiveJSON.bind(Request), "/api/user/userConfiguration");
  debugger
  const action = initializeSettingsAction(initialUserSettings);
  yield put(action);
}

function* pushSettingsAsync() {
  const payload = yield select(state => state);
  yield call(Request.sendJSONReceiveJSON.bind(Request), "/api/user/userConfiguration", { data: payload });
}

export function* watchPushSettingsAsync() {
  yield takeEvery("UPDATE_SETTING", pushSettingsAsync);
}
