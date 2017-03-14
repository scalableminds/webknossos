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
import type Model from "oxalis/model";
import type View from "oxalis/view";
import type SceneController from "oxalis/controller/scene_controller";
import type { Point2, Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { ModifierKeys } from "libs/input";
import { getIntegerZoomStep, getRayThreshold, getRotationOrtho } from "oxalis/model/accessors/flycam2d_accessor";
import { getPosition } from "oxalis/model/accessors/flycam3d_accessor";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam3d_actions";

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

    const [x, y, z] = getPosition(Store.getState().flycam3d);
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

      "1": () => this.skeletonTracingController.toggleSkeletonVisibility(),
      "2": () => this.sceneController.skeleton.toggleInactiveTreeVisibility(),

      // Delete active node
      delete: () => Store.dispatch(deleteNodeAction()),
      c: () => Store.dispatch(createTreeAction()),

      // Branches
      b: () => Store.dispatch(createBranchPointAction()),
      j: () => Store.dispatch(deleteBranchPointAction()),

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
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(normalizedMousePos, camera);
    raycaster.params.Points.threshold = getRayThreshold(Store.getState().flycam3d, plane);

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
      if (geometry.nodeIDs.getLength() <= index) {
        continue;
      }

      const nodeId = geometry.nodeIDs.getAllElements()[index];

      const posArray = geometry.attributes.position.array;
      const intersectsCoord = [posArray[3 * index], posArray[(3 * index) + 1], posArray[(3 * index) + 2]];
      const globalPos = getPosition(Store.getState().flycam3d);

      // make sure you can't click nodes, that are clipped away (one can't see)
      const ind = dimensions.getIndices(plane);
      if (intersect.object.visible &&
        (plane === OrthoViews.TDView ||
        (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < this.cameraController.getClippingDistance(ind[2]) + 1))) {
        // merge two trees
        if (shiftPressed && altPressed) {
          const sourceNodeId = Store.getState().skeletonTracing.activeNodeId;
          Store.dispatch(mergeTreesAction(sourceNodeId, nodeId));
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
    const { activeNodeId, activeTreeId, trees } = Store.getState().skeletonTracing;
    const activeNode = trees[activeTreeId].nodes[activeNodeId];

    // set the new trace direction
    if (activeNode) {
      Store.dispatch(setRotationAction([
        position[0] - activeNode.position[0],
        position[1] - activeNode.position[1],
        position[2] - activeNode.position[2],
      ]));
    }

    const rotation = getRotationOrtho(activeViewport);
    this.addNode(position, rotation, !ctrlPressed);

    // Strg + Rightclick to set new not active branchpoint
    const newNodeNewTree = Store.getState().userConfiguration.newNodeNewTree;
    if (ctrlPressed && !newNodeNewTree) {
      Store.dispatch(createBranchPointAction());
      Store.dispatch(setActiveNodeAction(activeNode.id));
    }
  }


  addNode = (position: Vector3, rotation: Vector3, centered: boolean): void => {
    const { newNodeNewTree } = Store.getState().userConfiguration;
    const { activeNodeId, activeTreeId, trees } = Store.getState().skeletonTracing;
    const activeNode = trees[activeTreeId].nodes[activeNodeId];

    if (this.model.settings.somaClickingAllowed && newNodeNewTree) {
      Store.dispatch(createTreeAction());
    }

    if (activeNode == null) {
      // when placing very first node of a tracing
      centered = true;
    }

    Store.dispatch(createNodeAction(
      position,
      rotation,
      OrthoViewToNumber[this.activeViewport],
      getIntegerZoomStep(Store.getState()),
    ));

    if (centered) {
      // we created a new node, so use it's reference
      const { activeNodeId: _activeNodeId, activeTreeId: _activeTreeId, trees: _trees } = Store.getState().skeletonTracing;
      const _activeNode = _trees[_activeTreeId].nodes[_activeNodeId];
      if (_activeNode) {
        this.centerPositionAnimated(_activeNode.position);
      }
    }
  };


  centerPositionAnimated(position: Vector3): void {
    // Let the user still manipulate the "third dimension" during animation
    const dimensionToSkip = dimensions.thirdDimensionForPlane(this.activeViewport);

    const curGlobalPos = getPosition(Store.getState().flycam3d);

    const tween = new TWEEN.Tween({
      globalPosX: curGlobalPos[0],
      globalPosY: curGlobalPos[1],
      globalPosZ: curGlobalPos[2],
      dimensionToSkip,
    });
    tween.to({
      globalPosX: position[0],
      globalPosY: position[1],
      globalPosZ: position[2],
    }, 200)
    .onUpdate(function () { // needs to be a normal (non-bound) function
      const curPos = [this.globalPosX, this.globalPosY, this.globalPosZ];
      curPos[this.dimensionToSkip] = null;
      Store.dispatch(setPositionAction(curPos));
    })
    .start();
  }
}


export default SkeletonTracingPlaneController;
