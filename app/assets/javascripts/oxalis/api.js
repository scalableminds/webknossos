/**
 * api.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import OxalisModel from "oxalis/model";
import type { Vector3 } from "oxalis/constants";


class TracingApi {

  model: OxalisModel;

  constructor(model: OxalisModel) {
    this.model = model;
  }

  getActiveNodeId(): ?number {
    return this.model.skeletonTracing.getActiveNodeId();
  }

  getActiveTreeId(): ?number {
    return this.model.skeletonTracing.getActiveTreeId();
  }

  setActiveNode(id: number) {
    this.model.skeletonTracing.setActiveNode(id);
  }

}


class DataApi {

  model: OxalisModel;

  constructor(model: OxalisModel) {
    this.model = model;
  }

  getLayerNames(): [string] {
    return _.map(this.model.binary, "name");
  }

  setMapping(layerName: string, mapping: [number]) {
    const layer = this.model.getBinaryByName(layerName);
    if (layer === undefined) throw Error(`Layer with name ${layerName} was not found.`);

    layer.cube.setMapping(mapping);
  }

  getBoundingBox(layerName: string): [Vector3, Vector3] {
    const layer = this.model.getBinaryByName(layerName);
    if (layer === undefined) throw Error(`Layer with name ${layerName} was not found.`);

    return [layer.lowerBoundary, layer.upperBoundary];
  }
}


class UserApi {

  model: OxalisModel;

  constructor(oxalisModel: OxalisModel) {
    this.model = oxalisModel;
  }

  getConfiguration(key: string) {
    return this.model.user.get(key);
  }

  setConfiguration(key: string, value) {
    this.model.user.set(key, value);
  }
}


type Handler = {
    unregister(): void,
};

class UtilsApi {

  model: OxalisModel;

  constructor(oxalisModel: OxalisModel) {
    this.model = oxalisModel;
  }

  registerKeyHandler(key: string, handler: () => void): Handler {
    // TODO
    console.log("Attach handler", handler, "to key", key);
    return { unregister: () => {} };
  }
}


type ApiInterface = {
  tracing: TracingApi,
  data: DataApi,
  user: UserApi,
  utils: UtilsApi,
};

class Api {

  readyPromise: Promise<void>;
  apiInterface: ApiInterface;
  model: OxalisModel;

  constructor(oxalisModel: OxalisModel) {
    this.readyPromise = new Promise((resolve) => {
      app.vent.listenTo(app.vent, "webknossos:ready", resolve);
    });

    this.apiInterface = {
      tracing: new TracingApi(oxalisModel),
      data: new DataApi(oxalisModel),
      user: new UserApi(oxalisModel),
      utils: new UtilsApi(oxalisModel),
    };

    this.model = oxalisModel;
  }

  apiReady(version: number, callback: (ApiInterface) => void) {
    // TODO: version check
    this.readyPromise.then(() => {
      callback(this.apiInterface);
    });
  }

  registerOverwrite<T>(funcName: string, newFunc: (oldFunc: (...T) => void, args: T) => void): void {
    const oldFunc = this.model.skeletonTracing[funcName];
    this.model.skeletonTracing[funcName] = (...args) => newFunc(oldFunc, ...args);
  }

}

export default Api;
