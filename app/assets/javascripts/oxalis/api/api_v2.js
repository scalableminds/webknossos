/*
 * api_latest.js
 * @flow
 */

import _ from "lodash";
import { InputKeyboardNoLoop } from "libs/input";
import Model from "oxalis/model";
import type { OxalisModel } from "oxalis/model";
import Store from "oxalis/store";
import {
  updateUserSettingAction,
  updateDatasetSettingAction,
  setMappingAction,
} from "oxalis/model/actions/settings_actions";
import {
  setActiveNodeAction,
  createCommentAction,
  deleteNodeAction,
  setNodeRadiusAction,
  setTreeNameAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  findTreeByNodeId,
  getNodeAndTree,
  getActiveNode,
  getActiveTree,
  getTree,
  getSkeletonTracing,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getLayerBoundaries } from "oxalis/model/accessors/dataset_accessor";
import { setActiveCellAction, setToolAction } from "oxalis/model/actions/volumetracing_actions";
import { getActiveCellId, getVolumeTool } from "oxalis/model/accessors/volumetracing_accessor";
import type { Vector3, VolumeToolType, ControlModeType } from "oxalis/constants";
import type {
  NodeType,
  UserConfigurationType,
  DatasetConfigurationType,
  TreeMapType,
  TracingType,
  TracingTypeTracingType,
  MappingType,
} from "oxalis/store";
import { overwriteAction } from "oxalis/model/helpers/overwrite_action_middleware";
import Toast from "libs/toast";
import window, { location } from "libs/window";
import Utils from "libs/utils";
import { ControlModeEnum, OrthoViews, VolumeToolEnum } from "oxalis/constants";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import TWEEN from "tween.js";
import { wkReadyAction, restartSagaAction } from "oxalis/model/actions/actions";
import UrlManager from "oxalis/controller/url_manager";
import { centerTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { rotate3DViewTo } from "oxalis/controller/camera_controller";
import dimensions from "oxalis/model/dimensions";
import { doWithToken, finishAnnotation, requestTask } from "admin/admin_rest_api";
import { discardSaveQueueAction } from "oxalis/model/actions/save_actions";
import messages from "messages";
import type { ToastStyleType } from "libs/toast";
import update from "immutability-helper";

function assertExists(value: any, message: string) {
  if (value == null) {
    throw new Error(message);
  }
}

function assertSkeleton(tracing: TracingType) {
  if (tracing.type !== "skeleton") {
    throw new Error("This api function should only be called in a skeleton tracing.");
  }
}

function assertVolume(tracing: TracingType) {
  if (tracing.type !== "volume") {
    throw new Error("This api function should only be called in a volume tracing.");
  }
}

function makeTreeBackwardsCompatible(tree: TreeMapType) {
  return update(tree, {
    nodes: { $apply: nodes => nodes.toObject() },
  });
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
    return getActiveNode(tracing)
      .map(node => node.id)
      .getOrElse(null);
  }

  /**
   * Returns the id of the current active tree.
   */
  getActiveTreeId(): ?number {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    return getActiveTree(tracing)
      .map(tree => tree.treeId)
      .getOrElse(null);
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
        return _.flatMap(trees, tree => Array.from(tree.nodes.values()));
      })
      .getOrElse([]);
  }

  /**
   * Returns all trees belonging to a tracing.
   */
  // Proper typing would be too tedious for a deprecated API.
  getAllTrees(): any {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    return getSkeletonTracing(tracing)
      .map(skeletonTracing => _.mapValues(skeletonTracing.trees, makeTreeBackwardsCompatible))
      .getOrElse({});
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
        throw new Error("Node id is missing.");
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
          assertExists(tree.nodes.get(nodeId), `Couldn't find node ${nodeId} in tree ${treeId}.`);
        } else {
          tree = _.values(skeletonTracing.trees).find(__ => __.nodes.has(nodeId));
          assertExists(tree, `Couldn't find node ${nodeId}.`);
        }
        // $FlowFixMe TODO remove once https://github.com/facebook/flow/issues/34 is closed
        const comment = tree.comments.find(__ => __.nodeId === nodeId);
        return comment != null ? comment.content : null;
      })
      .getOrElse(null);
  }

  /**
   * Sets the name for a tree. If no tree id is given, the active tree is used.
   *
   * @example
   * api.tracing.setTreeName("Special tree", 1);
   */
  setTreeName(name: string, treeId: ?number) {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    getSkeletonTracing(tracing).map(skeletonTracing => {
      if (treeId == null) {
        treeId = skeletonTracing.activeTreeId;
      }
      Store.dispatch(setTreeNameAction(name, treeId));
    });
  }

  /**
   * Returns the name for a given tree id. If none is given, the name of the active tree is returned.
   *
   * @example
   * api.tracing.getTreeName();
   */
  getTreeName(treeId?: number) {
    const tracing = Store.getState().tracing;
    assertSkeleton(tracing);
    return getTree(tracing, treeId)
      .map(activeTree => activeTree.name)
      .get();
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

    await Model.save();
    await finishAnnotation(annotationId, tracingType);
    try {
      const annotation = await requestTask();

      const isDifferentDataset = state.dataset.name !== annotation.dataSetName;
      const isDifferentTaskType = annotation.task.type.id !== Utils.__guard__(task, x => x.type.id);

      const currentScript = task != null && task.script != null ? task.script.gist : null;
      const nextScript = annotation.task.script != null ? annotation.task.script.gist : null;
      const isDifferentScript = currentScript !== nextScript;

      const differentTaskTypeParam = isDifferentTaskType ? "?differentTaskType" : "";
      const newTaskUrl = `/annotations/${annotation.typ}/${annotation.id}${differentTaskTypeParam}`;

      // In some cases the page needs to be reloaded, in others the tracing can be hot-swapped
      if (isDifferentDataset || isDifferentTaskType || isDifferentScript) {
        location.href = newTaskUrl;
      } else {
        await this.restart(annotation.typ, annotation.id, ControlModeEnum.TRACE);
      }
    } catch (err) {
      console.error(err);
      await Utils.sleep(2000);
      location.href = "/dashboard";
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
    newTracingType: TracingTypeTracingType,
    newAnnotationId: string,
    newControlMode: ControlModeType,
  ) {
    Store.dispatch(restartSagaAction());
    UrlManager.reset();
    await Model.fetch(newTracingType, newAnnotationId, newControlMode, false);
    Store.dispatch(discardSaveQueueAction());
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

  getShortestRotation(curRotation: Vector3, newRotation: Vector3): Vector3 {
    // TODO
    // interpolating Euler angles does not lead to the shortest rotation
    // interpolate the Quaternion representation instead
    // https://theory.org/software/qfa/writeup/node12.html

    const result = [newRotation[0], newRotation[1], newRotation[2]];
    for (let i = 0; i <= 2; i++) {
      // a rotation about more than 180° is shorter when rotating the other direction
      if (newRotation[i] - curRotation[i] > 180) {
        result[i] = newRotation[i] - 360;
      } else if (newRotation[i] - curRotation[i] < -180) {
        result[i] = newRotation[i] + 360;
      }
    }
    return result;
  }

  /**
   * Starts an animation to center the given position.
   *
   * @param position - Vector3
   * @param skipDimensions - Boolean which decides whether the third dimension shall also be animated (defaults to true)
   * @param rotation - Vector3 (optional) - Will only be noticeable in flight or oblique mode.
   * @example
   * api.tracing.centerPositionAnimated([0, 0, 0])
   */
  centerPositionAnimated(
    position: Vector3,
    skipDimensions: boolean = true,
    rotation?: Vector3,
  ): void {
    // Let the user still manipulate the "third dimension" during animation
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    const dimensionToSkip =
      skipDimensions && activeViewport !== OrthoViews.TDView
        ? dimensions.thirdDimensionForPlane(activeViewport)
        : null;

    const curPosition = getPosition(Store.getState().flycam);
    const curRotation = getRotation(Store.getState().flycam);

    if (!Array.isArray(rotation)) rotation = curRotation;
    rotation = this.getShortestRotation(curRotation, rotation);

    const tween = new TWEEN.Tween({
      positionX: curPosition[0],
      positionY: curPosition[1],
      positionZ: curPosition[2],
      rotationX: curRotation[0],
      rotationY: curRotation[1],
      rotationZ: curRotation[2],
    });
    tween
      .to(
        {
          positionX: position[0],
          positionY: position[1],
          positionZ: position[2],
          rotationX: rotation[0],
          rotationY: rotation[1],
          rotationZ: rotation[2],
        },
        200,
      )
      .onUpdate(function() {
        // needs to be a normal (non-bound) function
        Store.dispatch(
          setPositionAction([this.positionX, this.positionY, this.positionZ], dimensionToSkip),
        );
        Store.dispatch(setRotationAction([this.rotationX, this.rotationY, this.rotationZ]));
      })
      .start();
  }

  /**
   * Returns the current camera position.
   *
   * @example
   * const currentPosition = api.tracing.getCameraPosition()
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
   * Returns the active volume tool which is either
   * "MOVE", "TRACE" or "BRUSH".
   * _Volume tracing only!_
   */
  getVolumeTool(): ?VolumeToolType {
    const tracing = Store.getState().tracing;
    assertVolume(tracing);
    return Utils.toNullable(getVolumeTool(tracing));
  }

  /**
   * Sets the active volume tool which should be either
   * "MOVE", "TRACE" or "BRUSH".
   * _Volume tracing only!_
   */
  setVolumeTool(tool: VolumeToolType) {
    assertVolume(Store.getState().tracing);
    assertExists(tool, "Volume tool is missing.");
    if (VolumeToolEnum[tool] == null) {
      throw new Error(
        `Volume tool has to be one of: "${Object.keys(VolumeToolEnum).join('", "')}".`,
      );
    }
    Store.dispatch(setToolAction(tool));
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

  /**
   * Returns the names of all available layers of the current tracing.
   */
  getLayerNames(): Array<string> {
    return _.map(this.model.dataLayers, "name");
  }

  /**
   * Returns the name of the volume tracing layer.
   * _Volume tracing only!_
   */
  getVolumeTracingLayerName(): string {
    assertVolume(Store.getState().tracing);
    const segmentationLayer = this.model.getSegmentationLayer();
    assertExists(segmentationLayer, "Segmentation layer not found!");
    return segmentationLayer.name;
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
  setMapping(layerName: string, mapping: MappingType) {
    if (!Model.isMappingSupported) {
      throw new Error(messages["mapping.too_few_textures"]);
    }

    const segmentationLayerName = this.model.getSegmentationLayer().name;
    if (layerName !== segmentationLayerName) {
      throw new Error(messages["mapping.unsupported_layer"]);
    }
    Store.dispatch(setMappingAction(mapping));
  }

  /**
   * Returns the bounding box for a given layer name.
   */
  getBoundingBox(layerName: string): [Vector3, Vector3] {
    const { lowerBoundary, upperBoundary } = getLayerBoundaries(
      Store.getState().dataset,
      layerName,
    );

    return [lowerBoundary, upperBoundary];
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
   * @example // Get the segmentation id for a segmentation layer
   * const segmentId = await api.data.getDataValue("segmentation", position);
   */
  async getDataValue(layerName: string, position: Vector3, zoomStep: number = 0): Promise<number> {
    const cube = this.model.getCubeByLayerName(layerName);
    const pullQueue = this.model.getPullQueueByLayerName(layerName);
    const bucketAddress = cube.positionToZoomedAddress(position, zoomStep);
    const bucket = cube.getOrCreateBucket(bucketAddress);

    if (bucket.type === "null") return 0;

    let needsToAwaitBucket = false;
    if (bucket.isRequested()) {
      needsToAwaitBucket = true;
    } else if (bucket.needsRequest()) {
      pullQueue.add({ bucket: bucketAddress, priority: -1 });
      pullQueue.pull();
      needsToAwaitBucket = true;
    }
    if (needsToAwaitBucket) {
      await new Promise(resolve => {
        bucket.on("bucketLoaded", resolve);
      });
    }
    // Bucket has been loaded by now or was loaded already
    return cube.getDataValue(position, null, zoomStep);
  }

  /**
   * Downloads a cuboid of raw data from a data layer. A new window is opened for the download -
   * if that is not the case, please check your pop-up blocker.
   *
   * @example // Download a cuboid (from (0, 0, 0) to (100, 200, 100)) of raw data from the "segmentation" layer.
   * api.data.downloadRawDataCuboid("segmentation", [0,0,0], [100,200,100]);
   */
  downloadRawDataCuboid(layerName: string, topLeft: Vector3, bottomRight: Vector3): Promise<void> {
    const dataset = Store.getState().dataset;

    return doWithToken(token => {
      const downloadUrl =
        `${dataset.dataStore.url}/data/datasets/${
          dataset.name
        }/layers/${layerName}/data?resolution=0&` +
        `token=${token}&` +
        `x=${topLeft[0]}&` +
        `y=${topLeft[1]}&` +
        `z=${topLeft[2]}&` +
        `width=${bottomRight[0] - topLeft[0]}&` +
        `height=${bottomRight[1] - topLeft[1]}&` +
        `depth=${bottomRight[2] - topLeft[2]}`;

      window.open(downloadUrl);
      // Theoretically the window.open call could fail if the token is expired, but that would be hard to check
      return Promise.resolve();
    });
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
    const segmentationLayer = this.model.getSegmentationLayer();
    assertExists(segmentationLayer, "Segmentation layer not found!");

    for (const voxel of voxels) {
      segmentationLayer.cube.labelVoxel(voxel, label);
    }

    segmentationLayer.cube.pushQueue.push();
    segmentationLayer.cube.trigger("volumeLabeled");
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
    - newNodeNewTree
    - highlightCommentedNodes
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
   * @param {string} type - Can be one of the following: "info", "warning", "success" or "error"
   * @param {string} message - The message string you want to show
   * @param {number} timeout - Time period in milliseconds after which the toast will be hidden. Time is measured as soon as the user moves the mouse. A value of 0 means that the toast will only hide by clicking on it's X button.
   * @example // Show a toast for 5 seconds
   * const removeToast = api.utils.showToast("info", "You just got toasted", false, 5000);
   * // ... optionally:
   * // removeToast();
   */
  showToast(type: ToastStyleType, message: string, timeout: number): ?Function {
    Toast.message(type, message, { sticky: timeout === 0, timeout });
    return () => Toast.close(message);
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
   *   - SHUFFLE_ALL_TREE_COLORS
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
