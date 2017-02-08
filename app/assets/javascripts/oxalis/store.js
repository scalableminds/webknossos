/**
 * store.js
 * @flow
 */
import { createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import reduceReducers from "reduce-reducers";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";
import rootSaga from "oxalis/model/sagas/root_saga";

export type OxalisState = {
  datasetConfiguration: {},
  userConfiguration: {},
}

const defaultState: OxalisState = {
  datasetConfiguration: {},
  userConfiguration: {},
  datasetName: "100527_k0563",
};

const sagaMiddleware = createSagaMiddleware();
const store = createStore(SettingsReducer, defaultState, applyMiddleware(sagaMiddleware));
sagaMiddleware.run(rootSaga);

export default store;
