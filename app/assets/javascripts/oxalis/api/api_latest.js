/*
 * api_latest.js
 * @flow strict
 */

import _ from "lodash";
import { InputKeyboardNoLoop } from "libs/input";
import Model from "oxalis/model";
import type { OxalisModel } from "oxalis/model";
import Store from "oxalis/store";
import Binary from "oxalis/model/binary";
import {
  updateUserSettingAction,
  updateDatasetSettingAction,
} from "oxalis/model/actions/settings_actions";
import {
  setActiveNodeAction,
  createCommentAction,
  deleteNodeAction,
  setNodeRadiusAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  findTreeByNodeId,
  getNodeAndTree,
  getActiveNode,
  getActiveTree,
  getSkeletonTracing,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { setActiveCellAction, setModeAction } from "oxalis/model/actions/volumetracing_actions";
import {
  getActiveCellId,
  getVolumeTraceOrMoveMode,
} from "oxalis/model/accessors/volumetracing_accessor";
import type { Vector3, VolumeTraceOrMoveModeType, ControlModeType } from "oxalis/constants";
import type { MappingArray } from "oxalis/model/binary/mappings";
import type {
  NodeType,
  UserConfigurationType,
  DatasetConfigurationType,
  TreeMapType,
  TracingType,
  SkeletonTracingTypeTracingType,
} from "oxalis/store";
import { overwriteAction } from "oxalis/model/helpers/overwrite_action_middleware";
import Toast from "libs/toast";
import Request from "libs/request";
import app from "app";
import Utils from "libs/utils";
import { ControlModeEnum, OrthoViews } from "oxalis/constants";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import dimensions from "oxalis/model/dimensions";
import TWEEN from "tween.js";
import { wkReadyAction, restartSagaAction } from "oxalis/model/actions/actions";
import UrlManager from "oxalis/controller/url_manager";
import { centerTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { rotate3DViewTo } from "oxalis/controller/camera_controller";

function assertExists(value: any, message: string) {
  if (value == null) {
    throw Error(message);
  }
}

function assertSkeleton(tracing: TracingType) {
  if (tracing.type !== "skeleton") {
    throw Error("This api function should only be called in a skeleton tracing.");
  }
}

function assertVolume(tracing: TracingType) {
  if (tracing.type !== "volume") {
    throw Error("This api function should only be called in a volume tracing.");
  }
}
/**
 * All tracing related API methods. This is the newest version of the API (version 2).
 * @version 2
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

  //  SKELETONTRACING API

  /**
  * Returns the id of the current active node.
  */
  getActiveNodeId(): ?number {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    return getActiveNode(tracing).map(node => node.id).getOrElse(null);
  }

  /**
  * Returns the id of the current active tree.
  */
  getActiveTreeId(): ?number {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    return getActiveTree(tracing).map(tree => tree.treeId).getOrElse(null);
  }

  /**
  * Sets the active node given a node id.
  */
  setActiveNode(id: number) {
    assertSkeleton(Store.getState().tracing);
    assertExists(id, "Node id is missing.");
    Store.dispatch(setActiveNodeAction(id));
  }

  /**
  * Returns all nodes belonging to a tracing.
  */
  getAllNodes(): Array<NodeType> {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    return getSkeletonTracing(tracing)
      .map(skeletonTracing => {
        const { trees } = skeletonTracing;
        return _.flatMap(trees, tree => _.values(tree.nodes));
      })
      .getOrElse([]);
  }

  /**
  * Returns all trees belonging to a tracing.
  */
  getAllTrees(): TreeMapType {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    return getSkeletonTracing(tracing).map(skeletonTracing => skeletonTracing.trees).getOrElse({});
  }

  /**
   * Deletes the node with nodeId in the tree with treeId
   */
  deleteNode(nodeId: number, treeId: number) {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(deleteNodeAction(nodeId, treeId));
  }

  /**
  * Sets the comment for a node.
  *
  * @example
  * const activeNodeId = api.tracing.getActiveNodeId();
  * api.tracing.setCommentForNode("This is a branch point", activeNodeId);
  */
  setCommentForNode(commentText: string, nodeId: number, treeId?: number): void {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    assertExists(commentText, "Comment text is missing.");
    getSkeletonTracing(tracing).map(skeletonTracing => {
      // Convert nodeId to node
      if (_.isNumber(nodeId)) {
        const tree =
          treeId != null
            ? skeletonTracing.trees[treeId]
            : findTreeByNodeId(skeletonTracing.trees, nodeId).get();
        assertExists(tree, `Couldn't find node ${nodeId}.`);
        Store.dispatch(createCommentAction(commentText, nodeId, tree.treeId));
      } else {
        throw Error("Node id is missing.");
      }
    });
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
  getCommentForNode(nodeId: number, treeId?: number): ?string {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    assertExists(nodeId, "Node id is missing.");
    return getSkeletonTracing(tracing)
      .map(skeletonTracing => {
        // Convert treeId to tree
        let tree = null;
        if (treeId != null) {
          tree = skeletonTracing.trees[treeId];
          assertExists(tree, `Couldn't find tree ${treeId}.`);
          assertExists(tree.nodes[nodeId], `Couldn't find node ${nodeId} in tree ${treeId}.`);
        } else {
          tree = _.values(skeletonTracing.trees).find(__ => __.nodes[nodeId] != null);
          assertExists(tree, `Couldn't find node ${nodeId}.`);
        }
        // $FlowFixMe TODO remove once https://github.com/facebook/flow/issues/34 is closed
        const comment = tree.comments.find(__ => __.node === nodeId);
        return comment != null ? comment.content : null;
      })
      .getOrElse(null);
  }

  /**
   * Saves the tracing and returns a promise (which you can call `then` on or use await with).
   *
   * @example
   * api.tracing.save().then(() => ... );
   *
   * @example
   * await api.tracing.save();
   */
  async save() {
    await Model.save();
  }

  /**
   * Finishes the task and gets the next one. It returns a promise (which you can call `then` on or use await with).
   * Don't assume that code after the finishAndGetNextTask call will be executed.
   * It can happen that there is no further task, in which case the user will be redirected to the dashboard.
   * Or the the page can be reloaded (e.g., if the dataset changed), which also means that no further JS code will
   * be executed in this site context.
   *
   * @example
   * api.tracing.finishAndGetNextTask().then(() => ... );
   *
   * @example
   * await api.tracing.finishAndGetNextTask();
   */
  async finishAndGetNextTask() {
    const state = Store.getState();
    const { tracingType, annotationId } = state.tracing;
    const task = state.task;
    const finishUrl = `/annotations/${tracingType}/${annotationId}/finish`;
    const requestTaskUrl = "/user/tasks/request";

    await Model.save();
    await Request.triggerRequest(finishUrl);
    try {
      const annotation = await Request.receiveJSON(requestTaskUrl);

      const isDifferentDataset = state.dataset.name !== annotation.dataSetName;
      const isDifferentTaskType = annotation.task.type.id !== Utils.__guard__(task, x => x.type.id);

      const currentScript = task != null && task.script != null ? task.script.gist : null;
      const nextScript = annotation.task.script != null ? annotation.task.script.gist : null;
      const isDifferentScript = currentScript !== nextScript;

      const differentTaskTypeParam = isDifferentTaskType ? "?differentTaskType" : "";
      const newTaskUrl = `/annotations/${annotation.typ}/${annotation.id}${differentTaskTypeParam}`;

      // In some cases the page needs to be reloaded, in others the tracing can be hot-swapped
      if (isDifferentDataset || isDifferentTaskType || isDifferentScript) {
        app.router.loadURL(newTaskUrl);
      } else {
        await this.restart(annotation.typ, annotation.id, ControlModeEnum.TRACE);
      }
    } catch (err) {
      console.error(err);
      await Utils.sleep(2000);
      app.router.loadURL("/dashboard");
    }
  }

  /**
   * Restart webKnossos without refreshing the page. Please prefer finishAndGetNextTask for user scripts
   * since it does extra validation of the requested change and makes sure everything is saved etc.
   *
   * @example
   * api.tracing.restart("Explorational", "5909b5aa3e0000d4009d4d15", "TRACE")
   *
   */
  async restart(
    newTracingType: SkeletonTracingTypeTracingType,
    newAnnotationId: string,
    newControlMode: ControlModeType,
  ) {
    Store.dispatch(restartSagaAction());
    UrlManager.reset();
    await Model.fetch(newTracingType, newAnnotationId, newControlMode, false);
    Store.dispatch(wkReadyAction());
    UrlManager.updateUnthrottled(true);
  }

  //  SKELETONTRACING API

  /**
   * Increases the node radius of the given node by multiplying it with 1.05^delta.
   * If no nodeId and/or treeId are provided, it defaults to the current tree and current node.
   *
   * @example
   * api.tracing.setNodeRadius(1)
   */
  setNodeRadius(delta: number, nodeId?: number, treeId?: number): void {
    getNodeAndTree(Store.getState().tracing, nodeId, treeId).map(([, node]) =>
      Store.dispatch(setNodeRadiusAction(node.radius * Math.pow(1.05, delta), nodeId, treeId)),
    );
  }

  /**
   * Centers the given node. If no node is provided, the active node is centered.
   *
   * @example
   * api.tracing.centerNode()
   */
  centerNode = (nodeId?: number): void => {
    getNodeAndTree(Store.getState().tracing, nodeId).map(([, node]) =>
      Store.dispatch(setPositionAction(node.position)),
    );
  };

  /**
   * Centers the 3D view.
   *
   * @example
   * api.tracing.centerTDView()
   */
  centerTDView = (): void => {
    Store.dispatch(centerTDViewAction());
  };

  rotate3DViewToXY = (): void => rotate3DViewTo(OrthoViews.PLANE_XY);
  rotate3DViewToYZ = (): void => rotate3DViewTo(OrthoViews.PLANE_YZ);
  rotate3DViewToXZ = (): void => rotate3DViewTo(OrthoViews.PLANE_XZ);

  rotate3DViewToDiagonal = (animate: boolean = true): void => {
    rotate3DViewTo(OrthoViews.TDView, animate);
  };

  /**
   * Starts an animation to center the given position.
   *
   * @param position - Vector3
   * @param skipDimensions - Boolean which decides whether the third dimension shall also be animated (defaults to true)
   * @example
   * api.tracing.centerPositionAnimated([0, 0, 0])
   */
  centerPositionAnimated(position: Vector3, skipDimensions: boolean = true): void {
    // Let the user still manipulate the "third dimension" during animation
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    const dimensionToSkip =
      skipDimensions && activeViewport !== OrthoViews.TDView
        ? dimensions.thirdDimensionForPlane(activeViewport)
        : null;

    const curGlobalPos = getPosition(Store.getState().flycam);

    const tween = new TWEEN.Tween({
      globalPosX: curGlobalPos[0],
      globalPosY: curGlobalPos[1],
      globalPosZ: curGlobalPos[2],
    });
    tween
      .to(
        {
          globalPosX: position[0],
          globalPosY: position[1],
          globalPosZ: position[2],
        },
        200,
      )
      .onUpdate(function() {
        // needs to be a normal (non-bound) function
        const curPos = [this.globalPosX, this.globalPosY, this.globalPosZ];
        if (dimensionToSkip != null) {
          Store.dispatch(setPositionAction(curPos, dimensionToSkip));
        } else {
          Store.dispatch(setPositionAction(curPos));
        }
      })
      .start();
  }

  /**
   * Returns the current camera position.
   *
   * @example
   * const currentPosition = api.tracing.getPosition()
   */
  getCameraPosition(): Vector3 {
    return getPosition(Store.getState().flycam);
  }

  //  VOLUMETRACING API

  /**
  * Returns the id of the current active cell.
  * _Volume tracing only!_
  */
  getActiveCellId(): ?number {
    const tracing = Store.getState().tracing;
    assertVolume(tracing);
    return Utils.toNullable(getActiveCellId(tracing));
  }

  /**
  * Sets the active cell given a cell id.
  * If a cell with the given id doesn't exist, it is created.
  * _Volume tracing only!_
  */
  setActiveCell(id: number) {
    assertVolume(Store.getState().tracing);
    assertExists(id, "Cell id is missing.");
    Store.dispatch(setActiveCellAction(id));
  }

  /**
  * Returns the current volume mode which is either
  * 0 for "Move" or
  * 1 for "Trace".
  * _Volume tracing only!_
  */
  getVolumeMode(): ?VolumeTraceOrMoveModeType {
    const tracing = Store.getState().tracing;
    assertVolume(tracing);
    return Utils.toNullable(getVolumeTraceOrMoveMode(tracing));
  }

  /**
  * Sets the current volume mode which is either
  * 0 for "Move" or
  * 1 for "Trace".
  * _Volume tracing only!_
  */
  setVolumeMode(mode: VolumeTraceOrMoveModeType) {
    assertVolume(Store.getState().tracing);
    assertExists(mode, "Volume mode is missing.");
    // TODO: Use an Enum for VolumeTraceOrMoveModeType and replace this ugly check - postponed to avoid merge conflicts
    if (mode !== 0 && mode !== 1) {
      throw Error("Volume mode has to be either 0 or 1.");
    }
    Store.dispatch(setModeAction(mode));
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
  getLayerNames(): Array<string> {
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
  setMapping(layerName: string, mapping: MappingArray) {
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
  async getDataValue(layerName: string, position: Vector3, zoomStep: number = 0): Promise<number> {
    const layer = this.__getLayer(layerName);
    const bucketAddress = layer.cube.positionToZoomedAddress(position, zoomStep);
    const bucket = layer.cube.getOrCreateBucket(bucketAddress);

    if (bucket.type === "null") return 0;

    let needsToAwaitBucket = false;
    if (bucket.isRequested()) {
      needsToAwaitBucket = true;
    } else if (bucket.needsRequest()) {
      layer.pullQueue.add({ bucket: bucketAddress, priority: -1 });
      layer.pullQueue.pull();
      needsToAwaitBucket = true;
    }
    if (needsToAwaitBucket) {
      await new Promise(resolve => {
        bucket.on("bucketLoaded", resolve);
      });
    }
    // Bucket has been loaded by now or was loaded already
    return layer.cube.getDataValue(position);
  }

  /**
  * Label voxels with the supplied value.
  * _Volume tracing only!_
  *
  * @example // Set the segmentation id for some voxels to 1337
  * api.data.labelVoxels([[1,1,1], [1,2,1], [2,1,1], [2,2,1]], 1337);
  */
  labelVoxels(voxels: Array<Vector3>, label: number): void {
    assertVolume(Store.getState().tracing);
    const layer = this.model.getSegmentationBinary();
    assertExists(layer, "Segmentation layer not found!");

    for (const voxel of voxels) {
      layer.cube.labelVoxel(voxel, label);
    }

    layer.cube.pushQueue.push();
    layer.cube.trigger("volumeLabeled");
  }

  /**
   * Returns the dataset's setting for the tracing view.
   * @param key - One of the following keys:
     - segmentationOpacity
     - datasetName
     - fourBit
     - interpolation
     - keyboardDelay
     - layers
     - quality
   *
   * @example
   * const segmentationOpacity = api.data.getConfiguration("segmentationOpacity");
   */
  getConfiguration(key: $Keys<DatasetConfigurationType>) {
    return Store.getState().datasetConfiguration[key];
  }

  /**
   * Set the dataset's setting for the tracing view.
   * @param key - Same keys as for getConfiguration()
   *
   * @example
   * api.user.setConfiguration("segmentationOpacity", 20);
   */
  setConfiguration(key: $Keys<DatasetConfigurationType>, value) {
    Store.dispatch(updateDatasetSettingAction(key, value));
  }
}

/**
 * All user configuration related API methods.
 */
class UserApi {
  model: OxalisModel;

  constructor(model: OxalisModel) {
    this.model = model;
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
    - scale
    - tdViewDisplayPlanes
    - isosurfaceDisplay
    - isosurfaceBBsize
    - isosurfaceResolution
    - newNodeNewTree
    - inverseX
    - inverseY
    - keyboardDelay
    - particleSize
    - overrideNodeRadius
    - sortTreesByName
    - sortCommentsAsc
    - sphericalCapRadius
  *
  * @example
  * const keyboardDelay = api.user.getConfiguration("keyboardDelay");
  */
  getConfiguration(key: $Keys<UserConfigurationType>) {
    return Store.getState().userConfiguration[key];
  }

  /**
  * Set the user's setting for the tracing view.
  * @param key - Same keys as for getConfiguration()
  *
  * @example
  * api.data.setConfiguration("keyboardDelay", 20);
  */
  setConfiguration(key: $Keys<UserConfigurationType>, value) {
    Store.dispatch(updateUserSettingAction(key, value));
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

  constructor(model: OxalisModel) {
    this.model = model;
  }

  /**
  * Wait for some milliseconds before continuing the control flow.
  *
  * @example // Wait for 5 seconds
  * await api.utils.sleep(5000);
  */
  sleep(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  /**
   * Show a toast to the user. Returns a function which can be used to remove the toast again.
   *
   * @param {string} type - Can be one of the following: "info", "warning", "success" or "danger"
   * @param {string} message - The message string you want to show
   * @param {number} timeout - Time period in milliseconds after which the toast will be hidden. Time is measured as soon as the user moves the mouse. A value of 0 means that the toast will only hide by clicking on it's X button.
   * @example // Show a toast for 5 seconds
   * const removeToast = api.utils.showToast("info", "You just got toasted", false, 5000);
   * // ... optionally:
   * // removeToast();
   */
  showToast(type: string, message: string, timeout: number): ?Function {
    const noop = () => {};
    return Toast.message(type, message, timeout === 0, timeout).remove || noop;
  }

  /**
  * Overwrite existing wK actions. wK uses [Redux](http://redux.js.org/) actions to trigger any changes to the application state.
  * @param {function(store, next, originalAction)} overwriteFunction - Your new implementation for the method in question. Receives the central wK store, a callback to fire the next/original action and the original action.
  * @param {string} actionName - The name of the action you wish to override:
  *   - CREATE_NODE
  *   - DELETE_NODE
  *   - SET_ACTIVE_NODE
  *   - SET_NODE_RADIUS
  *   - CREATE_BRANCHPOINT
  *   - DELETE_BRANCHPOINT
  *   - CREATE_TREE
  *   - DELETE_TREE
  *   - SET_ACTIVE_TREE
  *   - SET_TREE_NAME
  *   - MERGE_TREES
  *   - SELECT_NEXT_TREE
  *   - SHUFFLE_TREE_COLOR
  *   - CREATE_COMMENT
  *   - DELETE_COMMENT
  *
  *
  * @example
  * api.utils.registerOverwrite("MERGE_TREES", (store, next, originalAction) => {
  *   // ... do stuff before the original function...
  *   next(originalAction);
  *   // ... do something after the original function ...
  * });
  */
  registerOverwrite<S, A>(
    actionName: string,
    overwriteFunction: (store: S, next: (action: A) => void, originalAction: A) => void,
  ) {
    overwriteAction(actionName, overwriteFunction);
  }

  /**
  * Sets a custom handler function for a keyboard shortcut.
  */
  registerKeyHandler(key: string, handler: () => void): Handler {
    const keyboard = new InputKeyboardNoLoop({ [key]: handler });
    return { unregister: keyboard.destroy.bind(keyboard) };
  }
}

type ApiInterface = {
  tracing: TracingApi,
  data: DataApi,
  user: UserApi,
  utils: UtilsApi,
};

export default function createApiInterface(model: OxalisModel): ApiInterface {
  return {
    tracing: new TracingApi(model),
    data: new DataApi(model),
    user: new UserApi(model),
    utils: new UtilsApi(model),
  };
}
