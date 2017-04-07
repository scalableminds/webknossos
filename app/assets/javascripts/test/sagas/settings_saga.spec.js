import test from 'ava';

import { initializeSettingsAsync } from "oxalis/model/sagas/settings_saga";
import { initializeSettingsAction } from "oxalis/model/actions/settings_actions";
import { take, put } from "redux-saga/effects";
import { expectValueDeepEqual } from "../helpers/sagaHelpers";
// import Request from "libs/request";

test("settings_sagas should load initial settings into the store", t => {
  const datasetName = "foo";
  const initialUserSettings = { userSettings: true };
  const initialDatasetSettings = { datasetSettings: true };

  const saga = initializeSettingsAsync();
  expectValueDeepEqual(t, saga.next(), take("SET_DATASET"));
  saga.next();
  const requestCalls = saga.next(datasetName).value;
  t.is(requestCalls.length, 2);
  t.deepEqual(requestCalls[0].CALL.args, ["/api/user/userConfiguration"]);
  // t.deepEqual(requestCalls[0].CALL.fn, Request.receiveJSON);
  t.deepEqual(requestCalls[1].CALL.args, [`/api/dataSetConfigurations/${datasetName}`]);
  // t.deepEqual(requestCalls[1].CALL.fn, Request.receiveJSON);
  expectValueDeepEqual(t, saga.next([initialUserSettings, initialDatasetSettings]),
    put(initializeSettingsAction(initialUserSettings, initialDatasetSettings))
  );
  t.true(saga.next().done);
});
