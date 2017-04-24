/**
 * skeletontracing_plane_controller.js
 * @flow
 */
/* globals JQueryInputEventObject:false */

import $ from "jquery";
import * as THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";
import Store from "oxalis/store";
import SkeletonTracingController from "oxalis/controller/annotations/skeletontracing_controller";
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import constants, { OrthoViews } from "oxalis/constants";
import dimensions from "oxalis/model/dimensions";
import { setActiveNodeAction, deleteNodeAction, createTreeAction, createNodeAction, createBranchPointAction, deleteBranchPointAction, mergeTreesAction } from "oxalis/model/actions/skeletontracing_actions";
import { getRequestLogZoomStep, getRayThreshold, getRotationOrtho, getPosition, PIXEL_RAY_THRESHOLD } from "oxalis/model/accessors/flycam_accessor";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import { toggleTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import type Model from "oxalis/model";
import type View from "oxalis/view";
import type SceneController from "oxalis/controller/scene_controller";
import type { Point2, Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { ModifierKeys } from "libs/input";
import { getBranchPoints } from "oxalis/model/accessors/skeletontracing_accessor";
import Toast from "libs/toast";
import messages from "messages";

const OrthoViewToNumber: OrthoViewMapType<number> = {
  [OrthoViews.PLANE_XY]: 0,
  [OrthoViews.PLANE_YZ]: 1,
  [OrthoViews.PLANE_XZ]: 2,
  [OrthoViews.TDView]: 3,
};

class SkeletonTracingPlaneController extends PlaneController {

  // See comment in Controller class on general controller architecture.
  //
  // Skeleton Tracing Plane Controller:
  // Extends Plane controller to add controls that are specific to Skeleton
  // Tracing.

  skeletonTracingController: SkeletonTracingController;

  constructor(
    model: Model,
    view: View,
    sceneController: SceneController,
    skeletonTracingController: SkeletonTracingController,
  ) {
    super(model, view, sceneController);
    this.skeletonTracingController = skeletonTracingController;
  }


  simulateTracing(nodesPerTree: number = -1, nodesAlreadySet: number = 0): void {
    // For debugging purposes.
    if (nodesPerTree === nodesAlreadySet) {
      Store.dispatch(createTreeAction());
      nodesAlreadySet = 0;
    }

    const [x, y, z] = getPosition(Store.getState().flycam);
    this.setWaypoint([x + 1, y + 1, z], false);
    _.defer(() => this.simulateTracing(nodesPerTree, nodesAlreadySet + 1));
  }


  start(): void {
    super.start();
    $(".skeleton-plane-controls").show();
  }


  stop(): void {
    super.stop();
    $(".skeleton-plane-controls").hide();
  }


  getPlaneMouseControls(planeId: OrthoViewType): Object {
    return _.extend(super.getPlaneMouseControls(planeId), {
      leftClick: (pos: Point2, plane: OrthoViewType, event: JQueryInputEventObject) =>
        this.onClick(pos, event.shiftKey, event.altKey, plane),
      rightClick: (pos: Point2, plane: OrthoViewType, event: JQueryInputEventObject) =>
        this.setWaypoint(this.calculateGlobalPos(pos), event.ctrlKey),
    });
  }


  getTDViewMouseControls(): Object {
    return _.extend(super.getTDViewMouseControls(), {
      leftClick: (pos: Point2, plane: OrthoViewType, event: JQueryInputEventObject) =>
        this.onClick(pos, event.shiftKey, event.altKey, OrthoViews.TDView),
    });
  }


  getKeyboardControls(): Object {
    return _.extend(super.getKeyboardControls(), {

      "1": () => Store.dispatch(toggleTemporarySettingAction("shouldHideAllSkeletons")),
      "2": () => Store.dispatch(toggleTemporarySettingAction("shouldHideInactiveTrees")),

      // Delete active node
      delete: () => Store.dispatch(deleteNodeAction()),
      c: () => Store.dispatch(createTreeAction()),

      // Branches
      b: () => Store.dispatch(createBranchPointAction()),
      j: () => this.deleteBranchPoint(),

      s: () => {
        this.skeletonTracingController.centerActiveNode();
        return this.cameraController.centerTDView();
      },
    });
  }

  scrollPlanes(delta: number, type: ?ModifierKeys): void {
    super.scrollPlanes(delta, type);

    if (type === "shift") {
      this.skeletonTracingController.setRadius(delta);
    }
  }


  onClick = (position: Point2, shiftPressed: boolean, altPressed: boolean, plane: OrthoViewType): void => {
    if (!shiftPressed) { // do nothing
      return;
    }

    const { scaleFactor } = this.planeView;
    const camera = this.planeView.getCameras()[plane];
    // vector with direction from camera position to click position
    const normalizedMousePos = new THREE.Vector2(
        ((position.x / (constants.VIEWPORT_WIDTH * scaleFactor)) * 2) - 1,
        (-(position.y / (constants.VIEWPORT_WIDTH * scaleFactor)) * 2) + 1);

    // create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    const state = Store.getState();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(normalizedMousePos, camera);
    if (plane === OrthoViews.TDView) {
      raycaster.params.Points.threshold = PIXEL_RAY_THRESHOLD * (camera.right - camera.left) / constants.VIEWPORT_WIDTH / getBaseVoxel(state.dataset.scale);
    } else {
      raycaster.params.Points.threshold = getRayThreshold(Store.getState().flycam);
    }

    // identify clicked object
    let intersects = raycaster.intersectObjects(this.sceneController.skeleton.getAllNodes());

    // Also look backwards: We want to detect object even when they are behind
    // the camera. Later, we filter out invisible objects.
    raycaster.ray.direction.multiplyScalar(-1);
    intersects = intersects.concat(raycaster.intersectObjects(this.sceneController.skeleton.getAllNodes()));

    intersects = _.sortBy(intersects, intersect => intersect.distanceToRay);

    for (const intersect of intersects) {
      const { index } = intersect;
      const { geometry } = intersect.object;

      // Raycaster also intersects with vertices that have an
      // index larger than numItems
      if (geometry.attributes.nodeId.count <= index) {
        continue;
      }

      const nodeId = geometry.attributes.nodeId.array[index];

      const posArray = geometry.attributes.position.array;
      const intersectsCoord = [posArray[3 * index], posArray[(3 * index) + 1], posArray[(3 * index) + 2]];
      const globalPos = getPosition(Store.getState().flycam);

      // make sure you can't click nodes, that are clipped away (one can't see)
      const ind = dimensions.getIndices(plane);
      if (intersect.object.visible &&
        (plane === OrthoViews.TDView ||
        (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < this.cameraController.getClippingDistance(ind[2]) + 1))) {
        // merge two trees
        if (shiftPressed && altPressed) {
          getActiveNode(Store.getState().skeletonTracing)
            .map(activeNode => Store.dispatch(mergeTreesAction(activeNode.id, nodeId)));
        }

        // set the active Node to the one that has the ID stored in the vertex
        Store.dispatch(setActiveNodeAction(nodeId));
        break;
      }
    }
  };


  setWaypoint(position: Vector3, ctrlPressed: boolean): void {
    const { activeViewport } = this;
    if (activeViewport === OrthoViews.TDView) {
      return;
    }
    const activeNodeMaybe = getActiveNode(Store.getState().skeletonTracing);

    // set the new trace direction
    activeNodeMaybe.map(activeNode => Store.dispatch(setRotationAction([
      position[0] - activeNode.position[0],
      position[1] - activeNode.position[1],
      position[2] - activeNode.position[2],
    ])));

    const rotation = getRotationOrtho(activeViewport);
    this.addNode(position, rotation, !ctrlPressed);

    // Strg + Rightclick to set new not active branchpoint
    const newNodeNewTree = Store.getState().userConfiguration.newNodeNewTree;
    if (ctrlPressed && !newNodeNewTree) {
      Store.dispatch(createBranchPointAction());
      activeNodeMaybe.map(activeNode => Store.dispatch(setActiveNodeAction(activeNode.id)));
    }
  }


  addNode = (position: Vector3, rotation: Vector3, centered: boolean): void => {
    const { newNodeNewTree } = Store.getState().userConfiguration;
    const activeNodeMaybe = getActiveNode(Store.getState().skeletonTracing);

    if (this.model.settings.somaClickingAllowed && newNodeNewTree) {
      Store.dispatch(createTreeAction());
    }

    if (activeNodeMaybe.isNothing) {
      // when placing very first node of a tracing
      centered = true;
    }

    Store.dispatch(createNodeAction(
      position,
      rotation,
      OrthoViewToNumber[this.activeViewport],
      getRequestLogZoomStep(Store.getState()),
    ));

    if (centered) {
      // we created a new node, so use it's reference
      getActiveNode(Store.getState().skeletonTracing)
        .map(newActiveNode => this.centerPositionAnimated(newActiveNode.position));
    }
  };


  centerPositionAnimated(position: Vector3, skipDimensions: boolean = true): void {
    // Let the user still manipulate the "third dimension" during animation
    const dimensionToSkip = skipDimensions && this.activeViewport !== OrthoViews.TDView ?
      dimensions.thirdDimensionForPlane(this.activeViewport) :
      null;

    const curGlobalPos = getPosition(Store.getState().flycam);

    const tween = new TWEEN.Tween({
      globalPosX: curGlobalPos[0],
      globalPosY: curGlobalPos[1],
      globalPosZ: curGlobalPos[2],
    });
    tween.to({
      globalPosX: position[0],
      globalPosY: position[1],
      globalPosZ: position[2],
    }, 200)
    .onUpdate(function () { // needs to be a normal (non-bound) function
      const curPos = [this.globalPosX, this.globalPosY, this.globalPosZ];
      if (dimensionToSkip != null) {
        Store.dispatch(setPositionAction(curPos, dimensionToSkip));
      } else {
        Store.dispatch(setPositionAction(curPos));
      }
    })
    .start();
  }

  deleteBranchPoint(): void {
    if (getBranchPoints(Store.getState().skeletonTracing).length === 0) {
      Toast.error(messages["tracing.no_more_branchpoints"]);
    } else {
      Store.dispatch(deleteBranchPointAction());
    }
  }
}

export default SkeletonTracingPlaneController;
