/**
 * store.js
 * @flow
 */
import { createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import rootSaga from "oxalis/model/sagas/root_saga";

export type OxalisState = {
  datasetConfiguration: {},
  userConfiguration: {},
}

const defaultState: OxalisState = {
  datasetConfiguration: {},
  userConfiguration: {},
  datasetName: "2012-09-28_ex145_07x2",
};

const sagaMiddleware = createSagaMiddleware();
const store = createStore(SettingsReducer, defaultState, applyMiddleware(sagaMiddleware));
sagaMiddleware.run(rootSaga);

export default store;
