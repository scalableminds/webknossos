/*
 * api_latest.js
 * @flow
 */

import TWEEN from "tween.js";
import _ from "lodash";
import { V3 } from "libs/mjs";

import Constants, {
  type BoundingBoxType,
  type ControlMode,
  ControlModeEnum,
  OrthoViews,
  type Vector3,
  type Vector4,
  type AnnotationTool,
  AnnotationToolEnum,
  TDViewDisplayModeEnum,
} from "oxalis/constants";
import { InputKeyboardNoLoop } from "libs/input";
import {
  type Bucket,
  getConstructorForElementClass,
} from "oxalis/model/bucket_data_handling/bucket";
import type { Versions } from "oxalis/view/version_view";
import { callDeep } from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import { centerTDViewAction } from "oxalis/model/actions/view_mode_actions";
import { discardSaveQueuesAction } from "oxalis/model/actions/save_actions";
import {
  doWithToken,
  finishAnnotation,
  getMappingsForDatasetLayer,
  requestTask,
  downsampleSegmentation,
} from "admin/admin_rest_api";
import {
  findTreeByNodeId,
  getNodeAndTree,
  getNodeAndTreeOrNull,
  getActiveNode,
  getActiveTree,
  getActiveGroup,
  getTree,
  getFlatTreeGroups,
  getTreeGroupsMap,
} from "oxalis/model/accessors/skeletontracing_accessor";
import {
  getActiveCellId,
  getRequestedOrVisibleSegmentationLayer,
  getRequestedOrVisibleSegmentationLayerEnforced,
  getNameOfRequestedOrVisibleSegmentationLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getLayerBoundaries,
  getLayerByName,
  getResolutionInfo,
  getVisibleSegmentationLayer,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import { parseNml } from "oxalis/model/helpers/nml_helpers";
import { overwriteAction } from "oxalis/model/helpers/overwrite_action_middleware";
import {
  bucketPositionToGlobalAddress,
  globalPositionToBaseBucket, globalPositionToBucketPosition,
} from "oxalis/model/helpers/position_converter";
import { rotate3DViewTo } from "oxalis/controller/camera_controller";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import {
  addTreesAndGroupsAction,
  setActiveNodeAction,
  createCommentAction,
  deleteNodeAction,
  centerActiveNodeAction,
  deleteTreeAction,
  resetSkeletonTracingAction,
  setNodeRadiusAction,
  setTreeNameAction,
  setActiveTreeAction,
  setActiveGroupAction,
  setActiveTreeByNameAction,
  setTreeColorIndexAction,
  setTreeVisibilityAction,
  setTreeGroupAction,
  setTreeGroupsAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import {
  updateCurrentMeshFileAction,
  refreshIsosurfacesAction,
  updateIsosurfaceVisibilityAction,
  removeIsosurfaceAction,
} from "oxalis/model/actions/annotation_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import {
  updateUserSettingAction,
  updateDatasetSettingAction,
  updateLayerSettingAction,
  setMappingAction,
  setMappingEnabledAction,
} from "oxalis/model/actions/settings_actions";
import { wkReadyAction, restartSagaAction } from "oxalis/model/actions/actions";
import Model, { type OxalisModel } from "oxalis/model";
import Store, {
  type AnnotationType,
  type MappingType,
  type DatasetConfiguration,
  type Mapping,
  type Node,
  type SkeletonTracing,
  type Tracing,
  type TreeGroupTypeFlat,
  type TreeMap,
  type UserConfiguration,
  type VolumeTracing,
} from "oxalis/store";
import Toast, { type ToastStyle } from "libs/toast";
import PriorityQueue from "js-priority-queue";
import UrlManager from "oxalis/controller/url_manager";
import Request from "libs/request";
import * as Utils from "libs/utils";
import dimensions from "oxalis/model/dimensions";
import messages from "messages";
import window, { location } from "libs/window";
import { type ElementClass } from "types/api_flow_types";
import UserLocalStorage from "libs/user_local_storage";
import {
  loadMeshFromFile,
  maybeFetchMeshFiles,
} from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import BoundingBox from "../model/bucket_data_handling/bounding_box";

type OutdatedDatasetConfigurationKeys = "segmentationOpacity" | "isSegmentationDisabled";

function assertExists(value: any, message: string) {
  if (value == null) {
    throw new Error(message);
  }
}

function assertSkeleton(tracing: Tracing): SkeletonTracing {
  if (tracing.skeleton == null) {
    throw new Error("This api function should only be called in a skeleton annotation.");
  }
  return tracing.skeleton;
}

function assertVolume(tracing: Tracing): VolumeTracing {
  if (tracing.volume == null) {
    throw new Error("This api function should only be called in a volume annotation.");
  }
  return tracing.volume;
}

/**
 * All tracing related API methods. This is the newest version of the API (version 3).
 * @version 3
 * @class
 * @example
 * window.webknossos.apiReady(3).then(api => {
 *   api.tracing.getActiveNodeId();
 *   api.tracing.getActiveTreeId();
 *   ...
 * }
 */
class TracingApi {
  model: OxalisModel;
  /**
   * @private
   */
  isFinishing: boolean = false;

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
    const tracing = assertSkeleton(Store.getState().tracing);
    return getActiveNode(tracing)
      .map(node => node.id)
      .getOrElse(null);
  }

  /**
   * Returns the id of the current active tree.
   */
  getActiveTreeId(): ?number {
    const tracing = assertSkeleton(Store.getState().tracing);
    return getActiveTree(tracing)
      .map(tree => tree.treeId)
      .getOrElse(null);
  }

  /**
   * Returns the id of the current active group.
   */
  getActiveGroupId(): ?number {
    const tracing = assertSkeleton(Store.getState().tracing);
    return getActiveGroup(tracing)
      .map(group => group.groupId)
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
  getAllNodes(): Array<Node> {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    return _.flatMap(skeletonTracing.trees, tree => Array.from(tree.nodes.values()));
  }

  /**
   * Returns all trees belonging to a tracing.
   */
  getAllTrees(): TreeMap {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    return skeletonTracing.trees;
  }

  /**
   * Deletes the node with nodeId in the tree with treeId
   */
  deleteNode(nodeId: number, treeId: number) {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(deleteNodeAction(nodeId, treeId));
  }

  /**
   * Centers the active node.
   */
  centerActiveNode() {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(centerActiveNodeAction());
  }

  /**
   * Deletes the tree with the given treeId.
   */
  deleteTree(treeId: number) {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(deleteTreeAction(treeId));
  }

  /**
   * Completely resets the skeleton tracing.
   */
  resetSkeletonTracing() {
    assertSkeleton(Store.getState().tracing);
    Store.dispatch(resetSkeletonTracingAction());
  }

  /**
   * Sets the comment for a node.
   *
   * @example
   * const activeNodeId = api.tracing.getActiveNodeId();
   * api.tracing.setCommentForNode("This is a branch point", activeNodeId);
   */
  setCommentForNode(commentText: string, nodeId: number, treeId?: number): void {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    assertExists(commentText, "Comment text is missing.");

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
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    assertExists(nodeId, "Node id is missing.");

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
    // $FlowIssue[incompatible-use] remove once https://github.com/facebook/flow/issues/34 is closed
    const comment = tree.comments.find(__ => __.nodeId === nodeId);
    return comment != null ? comment.content : null;
  }

  /**
   * Sets the name for a tree. If no tree id is given, the active tree is used.
   *
   * @example
   * api.tracing.setTreeName("Special tree", 1);
   */
  setTreeName(name: string, treeId: ?number) {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);

    if (treeId == null) {
      treeId = skeletonTracing.activeTreeId;
    }
    Store.dispatch(setTreeNameAction(name, treeId));
  }

  /**
   * Makes the specified tree active. Within the tree, the node with the highest ID will be activated.
   *
   * @example
   * api.tracing.setActiveTree(3);
   */
  setActiveTree(treeId: number) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setActiveTreeAction(treeId));
  }

  /**
   * Makes the tree specified by name active. Within the tree, the node with the highest ID will be activated.
   *
   * @example
   * api.tracing.setActiveTree("tree_1");
   */
  setActiveTreeByName(treeName: string) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setActiveTreeByNameAction(treeName));
  }

  /**
   * Makes the specified group active. Nodes cannot be added through the UI when a group is active.
   *
   * @example
   * api.tracing.setActiveGroup(3);
   */
  setActiveGroup(groupId: number) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setActiveGroupAction(groupId));
  }

  /**
   * Changes the color of the referenced tree. Internally, a pre-defined array of colors is used which is
   * why this function uses a colorIndex (between 0 and 500) instead of a proper color.
   *
   * @example
   * api.tracing.setTreeColorIndex(3, 10);
   */
  setTreeColorIndex(treeId: ?number, colorIndex: number) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setTreeColorIndexAction(treeId, colorIndex));
  }

  /**
   * Changes the visibility of the referenced tree.
   *
   * @example
   * api.tracing.setTreeVisibility(3, false);
   */
  setTreeVisibility(treeId: ?number, isVisible: boolean) {
    const { tracing } = Store.getState();
    assertSkeleton(tracing);
    Store.dispatch(setTreeVisibilityAction(treeId, isVisible));
  }

  /**
   * Gets a list of tree groups
   *
   * @example
   * api.tracing.getTreeGroups();
   */
  getTreeGroups(): Array<TreeGroupTypeFlat> {
    const { tracing } = Store.getState();
    return getFlatTreeGroups(assertSkeleton(tracing));
  }

  /**
   * Sets the parent group of the referenced tree.
   *
   * @example
   * api.tracing.setTreeGroup(
   *   3,
   *   api.tracing.getTreeGroups.find(({ name }) => name === "My Tree Group").id,
   * );
   */
  setTreeGroup(treeId?: number, groupId?: number) {
    const { tracing } = Store.getState();
    const skeletonTracing = assertSkeleton(tracing);
    const treeGroupMap = getTreeGroupsMap(skeletonTracing);
    if (groupId != null && treeGroupMap[groupId] == null) {
      throw new Error("Provided group ID does not exist");
    }

    Store.dispatch(setTreeGroupAction(groupId, treeId));
  }

  async importNmlAsString(nmlString: string) {
    const { treeGroups, trees } = await parseNml(nmlString);
    Store.dispatch(addTreesAndGroupsAction(trees, treeGroups));
  }

  /**
   * Renames the group referenced by the provided id.
   *
   * @example
   * api.tracing.renameGroup(
   *   3,
   *   "New group name",
   * );
   */
  renameGroup(groupId: number, newName: string) {
    const { tracing } = Store.getState();
    const skeletonTracing = assertSkeleton(tracing);
    const newTreeGroups = _.cloneDeep(skeletonTracing.treeGroups);
    callDeep(newTreeGroups, groupId, item => {
      item.name = newName;
    });
    Store.dispatch(setTreeGroupsAction(newTreeGroups));
  }

  /**
   * Returns the name for a given tree id. If none is given, the name of the active tree is returned.
   *
   * @example
   * api.tracing.getTreeName();
   */
  getTreeName(treeId?: number) {
    const tracing = assertSkeleton(Store.getState().tracing);
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
    await Model.ensureSavedState();
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
    if (this.isFinishing) return;

    this.isFinishing = true;
    const state = Store.getState();
    const { annotationType, annotationId } = state.tracing;
    const { task } = state;
    if (task == null) {
      // Satisfy flow
      throw new Error("Cannot find task to finish.");
    }

    await Model.ensureSavedState();
    await finishAnnotation(annotationId, annotationType);
    UserLocalStorage.setItem(
      "lastFinishedTask",
      JSON.stringify({ annotationId, finishedTime: Date.now() }),
    );
    try {
      const annotation = await requestTask();

      const isDifferentDataset = state.dataset.name !== annotation.dataSetName;
      const isDifferentTaskType = annotation.task.type.id !== task.type.id;
      const involvesVolumeTask = state.tracing.volume != null || annotation.tracing.volume != null;

      const currentScript = task.script != null ? task.script.gist : null;
      const nextScript = annotation.task.script != null ? annotation.task.script.gist : null;
      // A hot-swap of the task is not possible, currently, when a script is involved.
      const needsReloadDueToScript = currentScript != null || nextScript != null;

      const newTaskUrl = `/annotations/${annotation.typ}/${annotation.id}`;

      // In some cases the page needs to be reloaded, in others the tracing can be hot-swapped
      if (
        isDifferentDataset ||
        isDifferentTaskType ||
        needsReloadDueToScript ||
        involvesVolumeTask
      ) {
        location.href = newTaskUrl;
      } else {
        await this.restart(annotation.typ, annotation.id, ControlModeEnum.TRACE);
      }
    } catch (err) {
      console.error(err);
      await Utils.sleep(2000);
      location.href = "/dashboard";
    } finally {
      this.isFinishing = false;
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
    newAnnotationType: AnnotationType,
    newAnnotationId: string,
    newControlMode: ControlMode,
    versions?: Versions,
    keepUrlState?: boolean = false,
  ) {
    if (newControlMode === ControlModeEnum.VIEW)
      throw new Error("Restarting with view option is not supported");

    Store.dispatch(restartSagaAction());
    UrlManager.reset(keepUrlState);
    await Model.fetch(
      newAnnotationType,
      { annotationId: newAnnotationId, type: newControlMode },
      false,
      versions,
    );
    Store.dispatch(discardSaveQueuesAction());
    Store.dispatch(wkReadyAction());
    UrlManager.updateUnthrottled();
  }

  /**
   * Reload tracing by reloading the entire page.
   *
   * @example
   * api.tracing.hardReload()
   */
  async hardReload() {
    await Model.ensureSavedState();
    location.reload();
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
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    getNodeAndTree(skeletonTracing, nodeId, treeId).map(([, node]) =>
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
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    getNodeAndTree(skeletonTracing, nodeId).map(([, node]) =>
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
   * Measures the length of the given tree and returns the length in nanometer and in voxels.
   */
  measureTreeLength(treeId: number): [number, number] {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    const tree = skeletonTracing.trees[treeId];
    if (!tree) {
      throw new Error(`Tree with id ${treeId} not found.`);
    }

    const datasetScale = Store.getState().dataset.dataSource.scale;

    // Pre-allocate vectors

    let lengthNmAcc = 0;
    let lengthVxAcc = 0;
    for (const edge of tree.edges.all()) {
      const sourceNode = tree.nodes.get(edge.source);
      const targetNode = tree.nodes.get(edge.target);
      lengthNmAcc += V3.scaledDist(sourceNode.position, targetNode.position, datasetScale);
      lengthVxAcc += V3.length(V3.sub(sourceNode.position, targetNode.position));
    }

    return [lengthNmAcc, lengthVxAcc];
  }

  /**
   * Measures the length of all trees and returns the length in nanometer and in voxels.
   */
  measureAllTrees(): [number, number] {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);

    let totalLengthNm = 0;
    let totalLengthVx = 0;
    _.values(skeletonTracing.trees).forEach(currentTree => {
      const [lengthNm, lengthVx] = this.measureTreeLength(currentTree.treeId);
      totalLengthNm += lengthNm;
      totalLengthVx += lengthVx;
    });

    return [totalLengthNm, totalLengthVx];
  }

  /**
   * Returns the length of the shortest path between two nodes in nanometer and in voxels.
   */
  measurePathLengthBetweenNodes(sourceNodeId: number, targetNodeId: number): [number, number] {
    const skeletonTracing = assertSkeleton(Store.getState().tracing);
    const { node: sourceNode, tree: sourceTree } = getNodeAndTreeOrNull(
      skeletonTracing,
      sourceNodeId,
    );
    const { node: targetNode, tree: targetTree } = getNodeAndTreeOrNull(
      skeletonTracing,
      targetNodeId,
    );
    if (sourceNode == null || targetNode == null) {
      throw new Error(`The node with id ${sourceNodeId} or ${targetNodeId} does not exist.`);
    }
    if (sourceTree == null || sourceTree !== targetTree) {
      throw new Error("The nodes are not within the same tree.");
    }
    const datasetScale = Store.getState().dataset.dataSource.scale;
    // We use the Dijkstra algorithm to get the shortest path between the nodes.
    const distanceMap = {};
    // The distance map is also maintained in voxel space. This information is only
    // used when returning the final distance. The actual path finding is only done in
    // the physical space (nm-based).
    const distanceMapVx = {};
    const getDistance = nodeId =>
      distanceMap[nodeId] != null ? distanceMap[nodeId] : Number.POSITIVE_INFINITY;
    distanceMap[sourceNode.id] = 0;
    distanceMapVx[sourceNode.id] = 0;
    // The priority queue saves node id and distance tuples.
    const priorityQueue = new PriorityQueue<[number, number]>({
      comparator: ([_first, firstDistance], [_second, secondDistance]) =>
        firstDistance <= secondDistance ? -1 : 1,
    });
    priorityQueue.queue([sourceNodeId, 0]);
    while (priorityQueue.length > 0) {
      const [nextNodeId, distance] = priorityQueue.dequeue();
      const nextNodePosition = sourceTree.nodes.get(nextNodeId).position;
      // Calculate the distance to all neighbours and update the distances.
      for (const { source, target } of sourceTree.edges.getEdgesForNode(nextNodeId)) {
        const neighbourNodeId = source === nextNodeId ? target : source;
        const neighbourPosition = sourceTree.nodes.get(neighbourNodeId).position;
        const neighbourDistance =
          distance + V3.scaledDist(nextNodePosition, neighbourPosition, datasetScale);
        if (neighbourDistance < getDistance(neighbourNodeId)) {
          distanceMap[neighbourNodeId] = neighbourDistance;
          const neighbourDistanceVx = V3.length(V3.sub(nextNodePosition, neighbourPosition));
          distanceMapVx[neighbourNodeId] = neighbourDistanceVx;
          priorityQueue.queue([neighbourNodeId, neighbourDistance]);
        }
      }
    }
    return [distanceMap[targetNodeId], distanceMapVx[targetNodeId]];
  }

  /**
   * Starts an animation to center the given position. See setCameraPosition for a non-animated version of this function.
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
    const { activeViewport } = Store.getState().viewModeData.plane;
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

  /**
   * Sets the current camera position. See centerPositionAnimated for an animated version of this function.
   *
   * @example
   * api.tracing.setCameraPosition([100, 100, 100])
   */
  setCameraPosition(position: Vector3) {
    Store.dispatch(setPositionAction(position));
  }

  //  VOLUMETRACING API

  /**
   * Returns the id of the current active segment.
   * _Volume tracing only!_
   */
  getActiveCellId(): ?number {
    const tracing = assertVolume(Store.getState().tracing);
    return getActiveCellId(tracing);
  }

  /**
   * Sets the active segment given a segment id.
   * If a segment with the given id doesn't exist, it is created.
   * _Volume tracing only!_
   */
  setActiveCell(id: number) {
    assertVolume(Store.getState().tracing);
    assertExists(id, "Segment id is missing.");
    Store.dispatch(setActiveCellAction(id));
  }

  /**
   * Returns the active tool which is either
   * "MOVE", "SKELETON", "TRACE", "BRUSH", "FILL_CELL" or "PICK_CELL"
   */
  getAnnotationTool(): AnnotationTool {
    return Store.getState().uiInformation.activeTool;
  }

  /**
   * Sets the active tool which should be either
   * "MOVE", "SKELETON", "TRACE", "BRUSH", "FILL_CELL" or "PICK_CELL"
   * _Volume tracing only!_
   */
  setAnnotationTool(tool: AnnotationTool) {
    if (AnnotationToolEnum[tool] == null) {
      throw new Error(
        `Annotation tool has to be one of: "${Object.keys(AnnotationToolEnum).join('", "')}".`,
      );
    }
    Store.dispatch(setToolAction(tool));
  }

  /**
   * Deprecated! Use getAnnotationTool instead.
   */
  getVolumeTool(): AnnotationTool {
    return this.getAnnotationTool();
  }

  /**
   * Deprecated! Use setAnnotationTool instead.
   */
  setVolumeTool(tool: AnnotationTool) {
    this.setAnnotationTool(tool);
  }

  /**
   * Use this method to create a complete resolution pyramid by downsampling the lowest present mag (e.g., mag 1).
     This method will save the current changes and then reload the page after the downsampling
     has finished.
     This function can only be used for non-tasks.

     Note that this invoking this method will not block the UI. Thus, user actions can be performed during the
     downsampling. The caller should prohibit this (e.g., by showing a not-closable modal during the process).
   */
  async downsampleSegmentation() {
    const state = Store.getState();
    const { annotationId, annotationType, volume } = state.tracing;
    if (state.task != null) {
      throw new Error("Cannot downsample segmentation for a task.");
    }
    if (volume == null) {
      throw new Error("Cannot downsample segmentation for annotation without volume data.");
    }

    await this.save();
    await downsampleSegmentation(annotationId, annotationType);
    await this.hardReload();
  }
}

/**
 * All binary data / layer related API methods.
 * @example
 * window.webknossos.apiReady(3).then(api => {
 *   api.data.getLayerNames();
 *   api.data.reloadBuckets(...);
 *   ...
 * }
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
   * Returns the name of the volume tracing layer (only exists for a volume annotation) or the visible
   * segmentation layer.
   * Use `getSegmentationLayerNames` if you want to get actual segmentation layers (independent of a tracing).
   */
  getVolumeTracingLayerName(): string {
    const segmentationLayer = this.model.getSegmentationTracingLayer();
    if (segmentationLayer != null) {
      return segmentationLayer.name;
    }
    const visibleLayer = getVisibleSegmentationLayer(Store.getState());
    if (visibleLayer != null) {
      console.warn(
        "getVolumeTracingLayerName was called, but there is no volume tracing. Falling back to the visible segmentation layer. Please use getSegmentationLayerNames instead.",
      );
      return visibleLayer.name;
    }
    throw new Error(
      "getVolumeTracingLayerName was called, but there is no volume tracing and also no visible segmentation layer.",
    );
  }

  /**
   * Return a list of segmentation layer names.
   */
  getSegmentationLayerNames(): Array<string> {
    return this.model.getSegmentationLayers().map(layer => layer.name);
  }

  /**
   * Invalidates all downloaded buckets of the given layer so that they are reloaded.
   */
  async reloadBuckets(layerName: string): Promise<void> {
    await Promise.all(
      Object.keys(this.model.dataLayers).map(async currentLayerName => {
        const dataLayer = this.model.dataLayers[currentLayerName];
        if (dataLayer.cube.isSegmentation) {
          await Model.ensureSavedState();
        }

        if (dataLayer.name === layerName) {
          dataLayer.cube.collectAllBuckets();
          dataLayer.layerRenderingManager.refresh();
        }
      }),
    );
  }

  /**
   * Invalidates all downloaded buckets so that they are reloaded.
   */
  async reloadAllBuckets(): Promise<void> {
    if (this.model.getSegmentationTracingLayer() != null) {
      await Model.ensureSavedState();
    }
    _.forEach(this.model.dataLayers, dataLayer => {
      dataLayer.cube.collectAllBuckets();
      dataLayer.layerRenderingManager.refresh();
    });
  }

  /**
   * Sets a mapping for a given layer.
   *
   * @example
   * const position = [123, 123, 123];
   * const segmentationLayerName = "segmentation";
   * const segmentId = await api.data.getDataValue(segmentationLayerName, position);
   * const treeId = api.tracing.getActiveTreeId();
   * const mapping = {[segmentId]: treeId}
   *
   * api.data.setMapping(segmentationLayerName, mapping);
   */
  setMapping(
    layerName: string,
    mapping: Mapping,
    options?: {
      colors?: Array<number>,
      hideUnmappedIds?: boolean,
      showLoadingIndicator?: boolean,
    } = {},
  ) {
    if (!Model.isMappingSupported) {
      throw new Error(messages["mapping.too_few_textures"]);
    }
    const layer = this.model.getLayerByName(layerName);
    if (!layer.isSegmentation) {
      throw new Error(messages["mapping.unsupported_layer"]);
    }
    const { colors: mappingColors, hideUnmappedIds, showLoadingIndicator } = options;
    const mappingProperties = {
      mapping: _.clone(mapping),
      // Object.keys is sorted for numerical keys according to the spec:
      // http://www.ecma-international.org/ecma-262/6.0/#sec-ordinary-object-internal-methods-and-internal-slots-ownpropertykeys
      mappingKeys: Object.keys(mapping).map(x => parseInt(x, 10)),
      mappingColors,
      hideUnmappedIds,
      showLoadingIndicator,
    };
    Store.dispatch(setMappingAction(layerName, "<custom mapping>", "JSON", mappingProperties));
  }

  /**
   * Enables/Disables the active mapping. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   */
  setMappingEnabled(isEnabled: boolean, layerName?: string) {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;
    Store.dispatch(setMappingEnabledAction(effectiveLayerName, isEnabled));
  }

  /**
   * Gets all available mapping names for a given layer. If the layerName
   * is not passed, the currently visible segmentation layer will be used.
   *
   */
  async getMappingNames(layerName?: string): Promise<Array<string>> {
    const { dataset } = Store.getState();
    const segmentationLayer = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    );
    return getMappingsForDatasetLayer(dataset.dataStore.url, dataset, segmentationLayer.name);
  }

  /**
   * Gets the active mapping for a given layer. If layerName is not
   * passed, the currently visible segmentation layer will be used.
   *
   */
  getActiveMapping(layerName?: string): ?string {
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(
      Store.getState(),
      layerName,
    );
    if (!effectiveLayerName) {
      return null;
    }
    return getMappingInfo(
      Store.getState().temporaryConfiguration.activeMappingByLayer,
      effectiveLayerName,
    ).mappingName;
  }

  /**
   * Sets the active mapping for a given layer. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   */
  activateMapping(
    mappingName?: string,
    mappingType: MappingType = "JSON",
    layerName?: string,
  ): void {
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(
      Store.getState(),
      layerName,
    );
    if (!effectiveLayerName) {
      throw new Error(messages["mapping.unsupported_layer"]);
    }
    Store.dispatch(setMappingAction(effectiveLayerName, mappingName, mappingType));
  }

  /**
   * Returns whether a mapping is currently enabled. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   */
  isMappingEnabled(layerName?: string): boolean {
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(
      Store.getState(),
      layerName,
    );
    if (!effectiveLayerName) {
      return false;
    }
    return getMappingInfo(
      Store.getState().temporaryConfiguration.activeMappingByLayer,
      effectiveLayerName,
    ).isMappingEnabled;
  }

  refreshIsosurfaces() {
    Store.dispatch(refreshIsosurfacesAction());
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
   * Returns raw binary data for a given layer, position and zoom level. If the zoom
   * level is not provided, the first resolution will be used. If this
   * resolution does not exist, the next existing resolution will be used.
   * If the zoom level is provided and points to a not existent resolution,
   * 0 will be returned.
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
  async getDataValue(
    layerName: string,
    position: Vector3,
    _zoomStep: ?number = null,
  ): Promise<number> {
    let zoomStep;
    if (_zoomStep != null) {
      zoomStep = _zoomStep;
    } else {
      const layer = getLayerByName(Store.getState().dataset, layerName);
      const resolutionInfo = getResolutionInfo(layer.resolutions);
      zoomStep = resolutionInfo.getClosestExistingIndex(0);
    }

    const cube = this.model.getCubeByLayerName(layerName);
    const bucketAddress = cube.positionToZoomedAddress(position, zoomStep);
    await this.getLoadedBucket(layerName, bucketAddress);
    // Bucket has been loaded by now or was loaded already
    const dataValue = cube.getDataValue(position, null, zoomStep);
    return dataValue;
  }

  getRenderedZoomStepAtPosition(layerName: string, position: ?Vector3): number {
    return this.model.getRenderedZoomStepAtPosition(layerName, position);
  }

  async getLoadedBucket(layerName: string, bucketAddress: Vector4): Promise<Bucket> {
    const cube = this.model.getCubeByLayerName(layerName);
    const bucket = await cube.getLoadedBucket(bucketAddress);
    return bucket;
  }

  async getDataFor2DBoundingBox(layerName: string, bbox: BoundingBoxType, zoomStep: number) {
    const bucketAddresses = this.getBucketAddressesInCuboid(bbox, zoomStep);
    const buckets = await Promise.all(
      bucketAddresses.map(addr => this.getLoadedBucket(layerName, addr)),
    );
    for (const bucket of buckets) {
      if (bucket.visualize != null) {
        bucket.visualize();
      }

    }
    const { elementClass } = getLayerByName(Store.getState().dataset, layerName);
    return this.cutOutCuboid(buckets, bbox, elementClass, zoomStep);
  }

  getBucketAddressesInCuboid(bbox: BoundingBoxType, zoomStep: number): Array<Vector4> {
    // bbox min mag 1
    const buckets = [];
    const bottomRight = bbox.max;
    const visibleLayer = getVisibleSegmentationLayer(Store.getState());
    const resolutionInfo = getResolutionInfo(visibleLayer.resolutions);
    const denseResolutions = resolutionInfo.getDenseResolutions()
    const minBucket = globalPositionToBucketPosition(bbox.min, denseResolutions, zoomStep);
    const topLeft = bucketAddress => bucketPositionToGlobalAddress(bucketAddress, denseResolutions);
    const nextBucketInDim = (bucket, dim) => {
      const copy = bucket.slice();
      copy[dim]++;
      return ((copy: any): Vector4);
    };

    let bucket = minBucket;
    while (topLeft(bucket)[0] < bottomRight[0]) {
      const prevX = bucket.slice();
      while (topLeft(bucket)[1] < bottomRight[1]) {
        const prevY = bucket.slice();
        while (topLeft(bucket)[2] < bottomRight[2]) {
          buckets.push(bucket);
          bucket = nextBucketInDim(bucket, 2);
        }
        bucket = nextBucketInDim(prevY, 1);
      }

      bucket = nextBucketInDim(prevX, 0);
    }
    return buckets;
  }

  cutOutCuboid(
    buckets: Array<Bucket>,
    bbox: BoundingBoxType,
    elementClass: ElementClass,
    zoomStep: number,
  ): $TypedArray {
    const visibleLayer = getVisibleSegmentationLayer(Store.getState());
    const resolutionInfo = getResolutionInfo(visibleLayer.resolutions);
    const denseResolutions = resolutionInfo.getDenseResolutions();
    const resolution = denseResolutions[zoomStep];
    const boundingBoxInMag = new BoundingBox({min: V3.divide3(bbox.min, resolution), max: V3.divide3(bbox.max, resolution)})
    const extent = V3.sub(boundingBoxInMag.max, boundingBoxInMag.min);
    const [TypedArrayClass, channelCount] = getConstructorForElementClass(elementClass);
    const result = new TypedArrayClass(channelCount * extent[0] * extent[1] * extent[2]);
    const bucketWidth = Constants.BUCKET_WIDTH;
    buckets.reverse();

    for (const bucket of buckets) {
      if (bucket.type === "null") {
        continue;
      }
      const bucketTopLeft = V3.divide3(bucketPositionToGlobalAddress(bucket.zoomedAddress, denseResolutions), resolution);


      const x = Math.max(boundingBoxInMag.min[0], bucketTopLeft[0]);
      let y = Math.max(boundingBoxInMag.min[1], bucketTopLeft[1]);
      let z = Math.max(boundingBoxInMag.min[2], bucketTopLeft[2]);

      const xMax = Math.min(bucketTopLeft[0] + bucketWidth, boundingBoxInMag.max[0]);
      const yMax = Math.min(bucketTopLeft[1] + bucketWidth, boundingBoxInMag.max[1]);
      const zMax = Math.min(bucketTopLeft[2] + bucketWidth, boundingBoxInMag.max[2]);

      while (z < zMax) {
        y = Math.max(boundingBoxInMag.min[1], bucketTopLeft[1]);
        while (y < yMax) {
          const dataOffset =
            (x % bucketWidth) +
            (y % bucketWidth) * bucketWidth +
            (z % bucketWidth) * bucketWidth * bucketWidth;
          const rx = x - boundingBoxInMag.min[0];
          const ry = y - boundingBoxInMag.min[1];
          const rz = z - boundingBoxInMag.min[2];

          const resultOffset = rx + ry * extent[0] + rz * extent[0] * extent[1];
          const data =
            bucket.type !== "null" ? bucket.getData() : new TypedArrayClass(Constants.BUCKET_SIZE);
          const length = xMax - x;
          result.set(data.slice(dataOffset, dataOffset + length), resultOffset);
          y += 1;
        }
        z += 1;
      }
    }
    return result;
  }

  /**
   * Downloads a cuboid of raw data from a dataset (not tracing) layer. A new window is opened for the download -
   * if that is not the case, please check your pop-up blocker.
   *
   * @example // Download a cuboid (from (0, 0, 0) to (100, 200, 100)) of raw data from the "segmentation" layer.
   * api.data.downloadRawDataCuboid("segmentation", [0,0,0], [100,200,100]);
   */
  downloadRawDataCuboid(layerName: string, topLeft: Vector3, bottomRight: Vector3): Promise<void> {
    const { dataset } = Store.getState();

    return doWithToken(token => {
      const downloadUrl =
        `${dataset.dataStore.url}/data/datasets/${dataset.owningOrganization}/${
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

  getRawDataCuboid(layerName: string, topLeft: Vector3, bottomRight: Vector3): Promise<void> {
    const { dataset } = Store.getState();

    return doWithToken(token => {
      const downloadUrl =
        `${dataset.dataStore.url}/data/datasets/${dataset.owningOrganization}/${
          dataset.name
        }/layers/${layerName}/data?resolution=0&` +
        `token=${token}&` +
        `x=${topLeft[0]}&` +
        `y=${topLeft[1]}&` +
        `z=${topLeft[2]}&` +
        `width=${bottomRight[0] - topLeft[0]}&` +
        `height=${bottomRight[1] - topLeft[1]}&` +
        `depth=${bottomRight[2] - topLeft[2]}`;

      // Theoretically the window.open call could fail if the token is expired, but that would be hard to check

      return Request.receiveArraybuffer(downloadUrl);
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
    const segmentationLayer = this.model.getEnforcedSegmentationTracingLayer();

    for (const voxel of voxels) {
      segmentationLayer.cube.labelVoxelInAllResolutions(voxel, label);
    }

    segmentationLayer.cube.pushQueue.push();
  }

  /**
   * Returns the dataset's setting for the tracing view.
   * @param key - One of the following keys:
     - segmentationOpacity
     - fourBit
     - interpolation
     - layers
     - quality
     - segmentationPatternOpacity
     - renderMissingDataBlack
   *
   * @example
   * const segmentationOpacity = api.data.getConfiguration("segmentationOpacity");
   */
  getConfiguration(key: $Keys<DatasetConfiguration> | OutdatedDatasetConfigurationKeys) {
    const printDeprecationWarning = () =>
      console.warn(
        `The properties segmentationOpacity and isSegmentationDisabled are no longer directly part of the data configuration.
      Instead, they are part of the segmentation layer configuration and can be accessed as follows:
      "const layerSettings = api.data.getConfiguration('layers');
      const segmentationOpacity = layerSettings[<segmentationLayerName>].alpha;
      const isSegmentationDisabled = layerSettings[<segmentationLayerName>].isDisabled;"`,
      );
    switch (key) {
      case "segmentationOpacity": {
        printDeprecationWarning();
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        return segmentationLayer
          ? Store.getState().datasetConfiguration.layers[segmentationLayer.name].alpha
          : undefined;
      }
      case "isSegmentationDisabled": {
        printDeprecationWarning();
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        return segmentationLayer
          ? Store.getState().datasetConfiguration.layers[segmentationLayer.name].isDisabled
          : undefined;
      }
      default: {
        return Store.getState().datasetConfiguration[key];
      }
    }
  }

  /**
   * Set the dataset's setting for the tracing view.
   * @param key - Same keys as for getConfiguration()
   *
   * @example
   * api.data.setConfiguration("segmentationOpacity", 20);
   */
  setConfiguration(
    key: $Keys<DatasetConfiguration> | OutdatedDatasetConfigurationKeys,
    value: any,
  ) {
    const printDeprecationWarning = () =>
      console.warn(
        `The properties segmentationOpacity and isSegmentationDisabled are no longer directly part of the data configuration.
      Instead, they are part of the segmentation layer configuration and can be set as follows:
      "const layerSettings = api.data.getConfiguration('layers');
      const copyOfLayerSettings = _.cloneDeep(layerSettings);
      copyOfLayerSettings[<segmentationLayerName>].alpha = 40;
      copyOfLayerSettings[<segmentationLayerName>].isDisabled = false;
      api.data.setConfiguration('layers', copyOfLayerSettings);"`,
      );
    switch (key) {
      case "segmentationOpacity": {
        printDeprecationWarning();
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        const segmentationLayerName = segmentationLayer != null ? segmentationLayer.name : null;
        if (segmentationLayerName) {
          Store.dispatch(updateLayerSettingAction(segmentationLayerName, "alpha", value));
        }
        break;
      }
      case "isSegmentationDisabled": {
        printDeprecationWarning();
        const segmentationLayer = Model.getVisibleSegmentationLayer();
        const segmentationLayerName = segmentationLayer != null ? segmentationLayer.name : null;
        if (segmentationLayerName) {
          Store.dispatch(updateLayerSettingAction(segmentationLayerName, "isDisabled", value));
        }
        break;
      }
      default: {
        Store.dispatch(updateDatasetSettingAction(key, value));
      }
    }
  }

  /**
   * Retrieve a list of available precomputed mesh files. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * const availableMeshFileNames = api.data.getAvailableMeshFiles();
   */
  async getAvailableMeshFiles(layerName?: string): Promise<Array<string>> {
    const effectiveLayer = getRequestedOrVisibleSegmentationLayer(Store.getState(), layerName);
    if (!effectiveLayer) {
      return Promise.resolve([]);
    }
    const state = Store.getState();
    const { dataset } = state;

    return maybeFetchMeshFiles(effectiveLayer, dataset, true, false);
  }

  /**
   * Get currently active mesh file (might be null). If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * const activeMeshFile = api.data.getActiveMeshFile();
   */
  getActiveMeshFile(layerName?: string): ?string {
    const effectiveLayer = getRequestedOrVisibleSegmentationLayer(Store.getState(), layerName);

    if (!effectiveLayer) {
      return null;
    }
    return Store.getState().localSegmentationData[effectiveLayer.name].currentMeshFile;
  }

  /**
   * Set currently active mesh file (can be set to null). If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * const availableMeshFileNames = api.data.getAvailableMeshFiles();
   * if (availableMeshFileNames.length > 0) {
   *   api.data.setActiveMeshFile(availableMeshFileNames[0]);
   * }
   */
  setActiveMeshFile(meshFile: ?string, layerName?: string) {
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(
      Store.getState(),
      layerName,
    );
    if (!effectiveLayerName) {
      return;
    }

    if (meshFile == null) {
      Store.dispatch(updateCurrentMeshFileAction(effectiveLayerName, meshFile));
      return;
    }
    const state = Store.getState();
    if (
      state.localSegmentationData[effectiveLayerName].availableMeshFiles == null ||
      !state.localSegmentationData[effectiveLayerName].availableMeshFiles.includes(meshFile)
    ) {
      throw new Error(
        `The provided mesh file (${meshFile}) is not available for this dataset. Available mesh files are: ${(
          state.localSegmentationData[effectiveLayerName].availableMeshFiles || []
        ).join(", ")}`,
      );
    }

    Store.dispatch(updateCurrentMeshFileAction(effectiveLayerName, meshFile));
  }

  /**
   * If a mesh file is active, loadPrecomputedMesh can be used to load a mesh for a given segment at a given seed position for
   * a specified segmentation layer. If layerName is not passed, the currently visible segmentation layer will be used.
   * If there is no mesh file for the dataset's segmentation layer available, you can use api.data.computeMeshOnDemand instead.
   *
   * @example
   * const currentPosition = api.tracing.getCameraPosition();
   * const segmentId = await api.data.getDataValue("segmentation", currentPosition);
   * const availableMeshFiles = await api.data.getAvailableMeshFiles();
   * api.data.setActiveMeshFile(availableMeshFiles[0]);
   *
   * await api.data.loadPrecomputedMesh(segmentId, currentPosition);
   */
  async loadPrecomputedMesh(segmentId: number, seedPosition: Vector3, layerName: ?string) {
    const state = Store.getState();
    const effectiveLayerName = getNameOfRequestedOrVisibleSegmentationLayer(state, layerName);
    if (!effectiveLayerName) {
      return;
    }
    const { dataset } = state;
    const currentMeshFile = state.localSegmentationData[effectiveLayerName].currentMeshFile;
    if (currentMeshFile == null) {
      throw new Error(
        "No mesh file was activated. Please call `api.data.setActiveMeshFile` first (use `api.data.getAvailableMeshFiles` to retrieve candidates).",
      );
    }

    const segmentationLayer = getLayerByName(dataset, effectiveLayerName);
    if (!segmentationLayer) {
      throw new Error("No segmentation layer was found.");
    }
    await loadMeshFromFile(segmentId, seedPosition, currentMeshFile, segmentationLayer, dataset);
  }

  /**
   * Load a mesh for a given segment id and a seed position by computing it ad-hoc.
   *
   * @example
   * const currentPosition = api.tracing.getCameraPosition();
   * const segmentId = await api.data.getDataValue("segmentation", currentPosition);
   * api.data.computeMeshOnDemand(segmentId, currentPosition);
   */
  computeMeshOnDemand(segmentId: number, seedPosition: Vector3) {
    Store.dispatch(changeActiveIsosurfaceCellAction(segmentId, seedPosition, true));
  }

  /**
   * Set the visibility for a loaded mesh by providing the corresponding segment id.
   * If layerName is not passed, the currently visible segmentation layer will be used.
   *
   * @example
   * api.data.setMeshVisibility(segmentId, false);
   */
  setMeshVisibility(segmentId: number, isVisible: boolean, layerName?: string) {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;
    if (Store.getState().localSegmentationData[effectiveLayerName].isosurfaces[segmentId] != null) {
      Store.dispatch(updateIsosurfaceVisibilityAction(effectiveLayerName, segmentId, isVisible));
    }
  }

  /**
   * Remove the mesh for a given segment and segmentation layer. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * api.data.removeMesh(segmentId, layerName);
   */
  removeMesh(segmentId: number, layerName?: string): void {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;

    if (Store.getState().localSegmentationData[effectiveLayerName].isosurfaces[segmentId] != null) {
      Store.dispatch(removeIsosurfaceAction(effectiveLayerName, segmentId));
    }
  }

  /**
   * Removes all meshes from the scene for a given segmentation layer. If layerName is not passed,
   * the currently visible segmentation layer will be used.
   *
   * @example
   * api.data.resetMeshes();
   */
  resetMeshes(layerName?: string) {
    const effectiveLayerName = getRequestedOrVisibleSegmentationLayerEnforced(
      Store.getState(),
      layerName,
    ).name;
    const segmentIds = Object.keys(
      Store.getState().localSegmentationData[effectiveLayerName].isosurfaces,
    );
    for (const segmentId of segmentIds) {
      Store.dispatch(removeIsosurfaceAction(effectiveLayerName, Number(segmentId)));
    }
  }
}

/**
 * All user configuration related API methods.
 * @example
 * window.webknossos.apiReady(3).then(api => {
 *   api.user.getConfiguration(...);
 *   api.user.setConfiguration(...);
 *   ...
 * }
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
    - mouseRotateValue
    - clippingDistance
    - clippingDistanceArbitrary
    - dynamicSpaceDirection
    - displayCrosshair
    - displayScalebars
    - scale
    - tdViewDisplayPlanes
    - tdViewDisplayDatasetBorders
    - newNodeNewTree
    - centerNewNode
    - highlightCommentedNodes
    - keyboardDelay
    - particleSize
    - overrideNodeRadius
    - sortTreesByName
    - sortCommentsAsc
    - sphericalCapRadius
    - hideTreeRemovalWarning
  *
  * @example
  * const keyboardDelay = api.user.getConfiguration("keyboardDelay");
  */
  getConfiguration(key: $Keys<UserConfiguration>) {
    const value = Store.getState().userConfiguration[key];

    // Backwards compatibility
    if (key === "tdViewDisplayPlanes") {
      return value === TDViewDisplayModeEnum.DATA;
    }

    return value;
  }

  /**
   * Set the user's setting for the tracing view.
   * @param key - Same keys as for getConfiguration()
   *
   * @example
   * api.user.setConfiguration("keyboardDelay", 20);
   */
  setConfiguration(key: $Keys<UserConfiguration>, value: any) {
    // Backwards compatibility
    if (key === "tdViewDisplayPlanes") {
      value = value ? TDViewDisplayModeEnum.DATA : TDViewDisplayModeEnum.WIREFRAME;
    }

    Store.dispatch(updateUserSettingAction(key, value));
  }
}

type Handler = {
  unregister(): void,
};

/**
 * Utility API methods to control wK.
 * @example
 * window.webknossos.apiReady(3).then(api => {
 *   api.utils.sleep(...);
 *   api.utils.showToast(...);
 *   ...
 * }
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
  sleep(milliseconds: number): Promise<void> {
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
  showToast(type: ToastStyle, message: string, timeout?: number): ?Function {
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
   *   - SET_ACTIVE_GROUP
   *   - SET_TREE_NAME
   *   - MERGE_TREES
   *   - SELECT_NEXT_TREE
   *   - SHUFFLE_TREE_COLOR
   *   - SHUFFLE_ALL_TREE_COLORS
   *   - CREATE_COMMENT
   *   - DELETE_COMMENT
   * @returns {function()} - A function used to unregister the overwriteFunction
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
    overwriteFunction: (
      store: S,
      next: (action: A) => void,
      originalAction: A,
    ) => void | Promise<void>,
  ) {
    return overwriteAction(actionName, overwriteFunction);
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
