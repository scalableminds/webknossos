/**
 * store.js
 * @flow
 */
import { createStore, combineReducers } from "redux";
import SettingsReducer from "oxalis/model/reducers/settings_reducer";

export type OxalisState = {
  radius: number,
  overrideNodeRadius: boolean,
  particleSize: number,
  activeNodeId: number,
  somaClickingAllowed: boolean,
  boundingBox: Array<number>,
}

const defaults: OxalisState = {
  radius: 1,
  overrideNodeRadius: true,
  particleSize: 1,
  activeNodeId: 0,
  somaClickingAllowed: false,
  boundingBox: [],
};

const reducers = combineReducers({ SettingsReducer });

const store = createStore(reducers, defaults);

export default store;
