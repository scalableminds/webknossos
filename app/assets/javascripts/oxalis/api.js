/*
 * api.js
 * @flow weak
 */

// only relative imports are followed by documentationjs
import _ from "lodash";
import app from "app";
import Input from "libs/input";
import OxalisModel from "oxalis/model";
import Binary from "oxalis/model/binary";
import TracePoint from "oxalis/model/skeletontracing/tracepoint";
import TraceTree from "oxalis/model/skeletontracing/tracetree";

import type { Vector3 } from "oxalis/constants";

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
  *
  * @example
  * const activeNodeId = api.tracing.getActiveNodeId();
  * api.tracing.setCommentForNode("This is a branch point", activeNodeId);
  */
  // TODO discuss interface, supplying the node provides performance boost
  setCommentForNode(commentText: string, node: TracePoint | number): void {
    // Convert nodeId to node
    if (_.isNumber(node)) { node = this.model.skeletonTracing.getNode(node); }
    this.model.skeletonTracing.setCommentForNode(commentText, node);
  }

 /**
  * Returns the comment for a given node and tree (optional).
  * @param tree - Supplying the tree will provide a performance boost for looking up a comment.
  *
  * @example
  * const comment = api.tracing.getCommentForNode(23);
  *
  * @example // Provide a tree for lookup speed boost
  * const comment = api.tracing.getCommentForNode(23, api.getActiveTreeid());
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
  *
  * @example
  * const position = [123, 123, 123];
  * const segmentId = await api.data.getDataValue("segmentation", position);
  * const treeId = api.tracing.getActiveTreeId();
  * const mapping = {[segmentId]: treeId}
  *
  * api.setMapping("segmentation", mapping);
  */
  setMapping(layerName: string, mapping: {number: number}) {
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
  *
  * @example // Return the greyscale value for a bucket
  * const position = [123, 123, 123];
  * api.data.getDataValue("binary", position).then((greyscaleColor) => ...);
  *
  * @example // Using the await keyword instead of the promise syntax
  * const greyscaleColor = await api.data.getDataValue("binary", position);
  *
  * @example // Get the segmentation id for a segementation layer
  * const segmentId = await api.data.getDataValue("segmentation", position);
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
  * @param key - One of the following keys:
    - moveValue
    - moveValue3d
    - rotateValue
    - crosshairSize
    - scaleValue
    - mouseRotateValue
    - clippingDistance
    - clippingDistanceArbitrary
    - dynamicSpaceDirection
    - displayCrosshair
    - zoom
    - scale
    - tdViewDisplayPlanes
    - isosurfaceDisplay
    - isosurfaceBBsize
    - isosurfaceResolution
    - newNodeNewTree
    - inverseX
    - inverseY
    - keyboardDelay
    - mouseActive
    - keyboardActive
    - gamepadActive
    - motionsensorActive
    - firstVisToggle
    - particleSize
    - overrideNodeRadius
    - sortTreesByName
    - sortCommentsAsc
    - segmentationOpacity
    - sphericalCapRadius
    - renderComments
  *
  * @example
  * const segmentationOpacity = api.user.getConfiguration("segmentationOpacity");
  */
  getConfiguration(key: string) {
    return this.model.user.get(key);
  }

 /**
  * Set the user's setting for the tracing view.
  * @param key - Same keys as for getConfiguration()
  *
  * @example
  * api.user.setConfiguration("moveValue", 20);
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
  * Wait for some milliseconds before continuing the control flow.
  */
  sleep(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

 /**
  * Overwrite existing wK methods.
  * @param {string}  funcName - The method name you wish to override. Must be a skeletonTracing method.
  * @param {function} newFunc - Your new implementation for the method in question. Receives the original function as first argument.
  *
  * @example
  * api.registerOverwrite("mergeTree", (oldMergeTreeFunc) => {
  *   // ... do stuff before the original function...
  *   oldMergeTreeFunc(sourceTree, targetTree, lastNodeId, activeNodeId);
  *   // ... do something after the original function ...
  * });
  */
  // TEST: b = function overwrite(oldFunc, args) {console.log(...args); oldFunc(...args)}
  // webknossos.registerOverwrite("addNode", b)
  // TODO: this should only work for specific methods, that also could not reside in skeletontracing.js
  registerOverwrite<T>(funcName: string, newFunc: (oldFunc: (...T[]) => void, args: T) => void): void {
    const oldFunc = this.model.skeletonTracing[funcName].bind(this.model.skeletonTracing);
    this.model.skeletonTracing[funcName] = (...args) => newFunc(oldFunc, args);
  }
 /**
  * Sets a custom handler function for a keyboard shortcut.
  */
  registerKeyHandler(key: string, handler: () => void): Handler {
    // TODO: this way you cannot overwrite existing key handlers, just register new ones
    const keyboard = new Input.KeyboardNoLoop({ [key]: handler });
    return { unregister: keyboard.destroy.bind(keyboard) };
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
 * window.webknossos.apiReady(1).then((api) => {
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

 /**
  * API initializer. Will be called as soon as the webKnossos API is ready.
  * @name apiReady
  * @memberof Api
  * @instance
  * @param {number} version
  *
  * @example
  * window.webknossos.apiReady(1).then((api) => {
  *   // Your cool user script / wK plugin
  *   const nodes = api.tracing.getAllNodes();
  *   ...
  * });
  */
  apiReady(version: number = 1): Promise<ApiInterface> {
    // TODO: version check
    console.log("Requested api version:", version);
    return this.readyPromise.then(() => this.apiInterface);
  }
}

export default Api;
