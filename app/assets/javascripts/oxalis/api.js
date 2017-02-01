/*
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

/**
 * All tracing related API methods.
 * @class
 */
class TracingApi {

  model: OxalisModel;

 /**
  * @private
  */
  constructor(model: OxalisModel) {
    this.model = model;
  }

 /**
  * Returns the id of the current active node.
  */
  getActiveNodeId(): ?number {
    return this.model.skeletonTracing.getActiveNodeId();
  }

 /**
  * Returns the id of the current active tree.
  */
  getActiveTreeId(): ?number {
    return this.model.skeletonTracing.getActiveTreeId();
  }

 /**
  * Sets the active node given a node id.
  */
  setActiveNode(id: number) {
    this.model.skeletonTracing.setActiveNode(id);
  }

 /**
  * Returns all nodes belonging to a tracing.
  */
  getAllNodes(): [TracePoint] {
    return this.model.skeletonTracing.getNodeListOfAllTrees();
  }

 /**
  * Sets the comment for a node.
  */
  // TODO discuss interface, supplying the node provides performance boost
  setCommentForNode(commentText: string, node: TracePoint | number): void {
    // Convert nodeId to node
    if (_.isNumber(node)) { node = this.model.skeletonTracing.getNode(node); }
    this.model.skeletonTracing.setCommentForNode(commentText, node);
  }

 /**
  * Returns the comment for a given node and tree.
  */
  // TODO discuss interface, supplying the tree provides performance boost
  getCommentForNode(nodeId: number, tree: ?(TraceTree | number)): ?string {
    // Convert treeId to tree
    if (_.isNumber(tree)) { tree = this.model.skeletonTracing.getTree(tree); }
    const comment = this.model.skeletonTracing.getCommentForNode(nodeId, tree);
    return comment ? comment.content : null;
  }

}

/**
 * All binary data / layer related API methods.
 */
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

 /**
  * Returns the names of all available layers of the current tracing.
  */
  getLayerNames(): [string] {
    return _.map(this.model.binary, "name");
  }

 /**
  * Sets a mapping for a given layer.
  */
  setMapping(layerName: string, mapping: [number]) {
    const layer = this.__getLayer(layerName);

    layer.cube.setMapping(mapping);
  }

 /**
  * Returns the bounding box for a given layer name.
  */
  getBoundingBox(layerName: string): [Vector3, Vector3] {
    const layer = this.__getLayer(layerName);

    return [layer.lowerBoundary, layer.upperBoundary];
  }

 /**
  * Returns raw binary data for a given layer, position and zoom level.
  */
  getDataValue(layerName: string, position: Vector3, zoomStep: number = 0): Promise<number> {
    const layer = this.__getLayer(layerName);
    const bucket = layer.cube.positionToZoomedAddress(position, zoomStep);

    layer.pullQueue.add({ bucket, priority: -1 });
    return Promise.all(layer.pullQueue.pull()).then(() => layer.cube.getDataValue(position));
  }
}

/**
 * All user configuration related API methods.
 */
class UserApi {

  model: OxalisModel;

  constructor(oxalisModel: OxalisModel) {
    this.model = oxalisModel;
  }

 /**
  * Returns the user's setting for the tracing view.
  */
  getConfiguration(key: string) {
    return this.model.user.get(key);
  }

 /**
  * Set the user's setting for the tracing view.
  */
  setConfiguration(key: string, value) {
    this.model.user.set(key, value);
  }
}


type Handler = {
    unregister(): void,
};

/**
 * Utility API methods to control wK.
 */
class UtilsApi {

  model: OxalisModel;

  constructor(oxalisModel: OxalisModel) {
    this.model = oxalisModel;
  }

 /**
  * Sets a custom handler function for a keyboard shortcut.
  */
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

/**
 * webKnossos Public Frontend API.
 * @author scalabe minds
 * @version 1
 * @module Api
 *
 *
 * @property {TracingApi} tracing - All methods related to getting tracings.
 * @property {DataApi} data - All methods related to getting binary data / layers.
 * @property {UserApi} user - All methods related to getting / setting the user's personal tracing configuration.
 * @property {UtilsApi} utils - Utitility methods for controlling wK.
 *
 * @example
 * import api from "api.js"
 *
 * api.apiReady(1, (api) => {
 *     const nodes = api.tracing.getAllNodes();
 *     const dataLayerNames = api.data.getLayerNames();
 *     const userConfiguration = api.user.getConfiguration();
 *     const keyHandler = api.utils.registerKeyHandler("enter", () => console.log("Welcome"));
 *  });
 */
class Api {

  readyPromise: Promise<void>;
  apiInterface: ApiInterface;
  model: OxalisModel;

 /**
  * @private
  */
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

 // TODO This breaks documentationjs. Try back later
 // /**
 //  * API initializer. Will be called as soon as the webKnossos API is ready.
 //  * @method apiReady
 //  * param {number} version
 //  * param {number} ApiInterface
 //  * return {void}
 //  */
  apiReady(version: number, callback: (ApiInterface) => void) {
    // TODO: version check
    this.readyPromise.then(() => {
      callback(this.apiInterface);
    });
  }

  // TEST: b = function overwrite(oldFunc, args) {console.log(...args); oldFunc(...args)}
  // webknossos.registerOverwrite("addNode", b)
  // TODO: this should only work for specific methods, that also could not reside in skeletontracing.js
  // TODO: where should this method be accessible from, probably api.utils
 /**
  * Overwrite existing wK methods.
  */
  registerOverwrite<T>(funcName: string, newFunc: (oldFunc: (...T) => void, args: T) => void): void {
    const oldFunc = this.model.skeletonTracing[funcName].bind(this.model.skeletonTracing);
    this.model.skeletonTracing[funcName] = (...args) => newFunc(oldFunc, args);
  }

}

export default Api;
