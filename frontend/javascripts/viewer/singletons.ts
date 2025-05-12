import type { Store as ReduxStore } from "redux";
import type { ApiInterface } from "./api/api_latest";
import type { WebKnossosModel } from "./model";
import type { WebknossosState } from "./store";

export let Store: ReduxStore<WebknossosState>;
export let Model: WebKnossosModel;
export let api: ApiInterface;

export const setStore = (_store: ReduxStore<WebknossosState>) => {
  Store = _store;
};

export const setModel = (_model: WebKnossosModel) => {
  Model = _model;
};

export const setApi = (_api: ApiInterface) => {
  api = _api;
};
