/**
 * api.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import OxalisModel from "oxalis/model";
import type { Vector3 } from "oxalis/constants";
import TracePoint from "oxalis/model/skeletontracing/tracepoint";
import TraceTree from "oxalis/model/skeletontracing/tracetree";
import Binary from "oxalis/model/binary";


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


  getAllNodes(): [TracePoint] {
    return this.model.skeletonTracing.getNodeListOfAllTrees();
  }


  // TODO discuss interface, supplying the node provides performance boost
  setCommentForNode(commentText: string, node: TracePoint | number): void {
    // Convert nodeId to node
    if (_.isNumber(node)) { node = this.model.skeletonTracing.getNode(node); }
    this.model.skeletonTracing.setCommentForNode(commentText, node);
  }


  // TODO discuss interface, supplying the tree provides performance boost
  getCommentForNode(nodeId: number, tree: ?(TraceTree | number)): ?string {
    // Convert treeId to tree
    if (_.isNumber(tree)) { tree = this.model.skeletonTracing.getTree(tree); }
    const comment = this.model.skeletonTracing.getCommentForNode(nodeId, tree);
    return comment ? comment.content : null;
  }

}


class DataApi {

  model: OxalisModel;

  constructor(model: OxalisModel) {
    this.model = model;
  }


  __getLayer(layerName: string): Binary {
    const layer = this.model.getBinaryByName(layerName);
    if (layer === undefined) throw Error(`Layer with name ${layerName} was not found.`);
    return layer;
  }


  getLayerNames(): [string] {
    return _.map(this.model.binary, "name");
  }


  setMapping(layerName: string, mapping: {number: number}) {
    const layer = this.__getLayer(layerName);

    layer.cube.setMapping(mapping);
  }


  getBoundingBox(layerName: string): [Vector3, Vector3] {
    const layer = this.__getLayer(layerName);

    return [layer.lowerBoundary, layer.upperBoundary];
  }


  getDataValue(layerName: string, position: Vector3, zoomStep: number = 0): Promise<number> {
    const layer = this.__getLayer(layerName);
    const bucket = layer.cube.positionToZoomedAddress(position, zoomStep);

    layer.pullQueue.add({ bucket, priority: -1 });
    return Promise.all(layer.pullQueue.pull()).then(() => layer.cube.getDataValue(position));
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


  sleep(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }


  // TEST: b = function overwrite(oldFunc, args) {console.log(...args); oldFunc(...args)}
  // webknossos.registerOverwrite("addNode", b)
  // TODO: this should only work for specific methods, that also could not reside in skeletontracing.js
  registerOverwrite<T>(funcName: string, newFunc: (oldFunc: (...T) => void, args: T) => void): void {
    const oldFunc = this.model.skeletonTracing[funcName].bind(this.model.skeletonTracing);
    this.model.skeletonTracing[funcName] = (...args) => newFunc(oldFunc, args);
  }


  registerKeyHandler(key: string, handler: () => void): Handler {
    // TODO implement
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

}

export default Api;
