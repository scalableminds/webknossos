import { Store as ReduxStore } from "redux";
import { ApiInterface } from "./api/api_latest";
import { type OxalisModel } from "./model";
import { type OxalisState } from "./store";

export let Store: ReduxStore<OxalisState>;
export let Model: OxalisModel;
export let api: ApiInterface;

export const setStore = (_store: ReduxStore<OxalisState>) => {
  Store = _store;
};

export const setModel = (_model: OxalisModel) => {
  Model = _model;
};

export const setApi = (_api: ApiInterface) => {
  api = _api;
};
