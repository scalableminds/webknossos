import { initializeSettingsAsync } from "oxalis/model/sagas/settings_saga";
import { initializeSettingsAction } from "oxalis/model/actions/settings_actions";
import { take, put } from "redux-saga/effects";
// import Request from "libs/request";

function expectValue(block) {
  expect(block.done).toBe(false);
  return expect(block.value);
}

describe("settings_sagas", () => {
  it("Should load initial settings into the store", () => {
    const datasetName = "foo";
    const initialUserSettings = { userSettings: true };
    const initialDatasetSettings = { datasetSettings: true };

    const saga = initializeSettingsAsync();
    expectValue(saga.next()).toEqual(take("SET_DATASET"));
    saga.next();
    const requestCalls = saga.next(datasetName).value;
    expect(requestCalls.length).toBe(2);
    expect(requestCalls[0].CALL.args).toEqual(["/api/user/userConfiguration"]);
    // expect(requestCalls[0].CALL.fn).toEqual(Request.receiveJSON);
    expect(requestCalls[1].CALL.args).toEqual([`/api/dataSetConfigurations/${datasetName}`]);
    // expect(requestCalls[1].CALL.fn).toEqual(Request.receiveJSON);
    expectValue(saga.next([initialUserSettings, initialDatasetSettings]))
      .toEqual(put(initializeSettingsAction(initialUserSettings, initialDatasetSettings)));
    expect(saga.next().done);
  });
});
