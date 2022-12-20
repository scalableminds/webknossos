import { Store as ReduxStore } from "redux";
import { type OxalisModel } from "./model";
import { type OxalisState } from "./store";

export let Store: ReduxStore<OxalisState>;

export const setStore = (_store: ReduxStore<OxalisState>) => {
  Store = _store;
};

export let Model: OxalisModel;

export const setModel = (_model: OxalisModel) => {
  Model = _model;
};
