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
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import SceneController from "oxalis/controller/scene_controller";
import { OrthoViews } from "oxalis/constants";
import dimensions from "oxalis/model/dimensions";
import { setActiveNodeAction, deleteNodeAction, createTreeAction, createNodeAction, createBranchPointAction, requestDeleteBranchPointAction, mergeTreesAction } from "oxalis/model/actions/skeletontracing_actions";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { getPosition, getRotationOrtho, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import { toggleTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import type { Point2, Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { ModifierKeys } from "libs/input";
import api from "oxalis/api/internal_api";

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
      j: () => Store.dispatch(requestDeleteBranchPointAction()),

      s: () => {
        api.tracing.centerActiveNode();
        this.cameraController.centerTDView();
      },
    });
  }

  scrollPlanes(delta: number, type: ?ModifierKeys): void {
    super.scrollPlanes(delta, type);

    if (type === "shift") {
      api.tracing.setRadius(delta);
    }
  }


  onClick = (position: Point2, shiftPressed: boolean, altPressed: boolean, plane: OrthoViewType): void => {
    if (!shiftPressed) { // do nothing
      return;
    }

    // render the clicked viewport with picking enabled
    // we need a dedicated pickingScene, since we only want to render all nodes and no planes / bounding box / edges etc.
    const pickingNode = SceneController.skeleton.startPicking();
    const pickingScene = new THREE.Scene();
    pickingScene.add(pickingNode);

    const buffer = this.planeView.renderOrthoViewToTexture(plane, pickingScene);
    // Beware of the fact that new browsers yield float numbers for the mouse position
    const [x, y] = [Math.round(position.x), Math.round(position.y)];
    // compute the index of the pixel under the cursor,
    // while inverting along the y-axis, because OpenGL has its origin bottom-left :/
    const index = (x + (this.planeView.curWidth - y) * this.planeView.curWidth) * 4;
    // the nodeId can be reconstructed by interpreting the RGB values of the pixel as a base-255 number
    const nodeId = buffer.subarray(index, index + 3).reduce((a, b) => a * 255 + b, 0);
    SceneController.skeleton.stopPicking();

    // prevent flickering sometimes caused by picking
    this.planeView.renderFunction();

    // otherwise we have hit the background and do nothing
    if (nodeId > 0) {
      if (altPressed) {
        getActiveNode(Store.getState().tracing)
          .map(activeNode => Store.dispatch(mergeTreesAction(activeNode.id, nodeId)));
      }

      Store.dispatch(setActiveNodeAction(nodeId));
    }
  };


  setWaypoint(position: Vector3, ctrlPressed: boolean): void {
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    if (activeViewport === OrthoViews.TDView) {
      return;
    }
    const activeNodeMaybe = getActiveNode(Store.getState().tracing);

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
    const state = Store.getState();
    const { newNodeNewTree } = state.userConfiguration;
    const activeNodeMaybe = getActiveNode(state.tracing);

    if (state.tracing.restrictions.somaClickingAllowed && newNodeNewTree) {
      Store.dispatch(createTreeAction());
    }

    if (activeNodeMaybe.isNothing) {
      // when placing very first node of a tracing
      centered = true;
    }

    Store.dispatch(createNodeAction(
      position,
      rotation,
      OrthoViewToNumber[Store.getState().viewModeData.plane.activeViewport],
      getRequestLogZoomStep(state),
    ));

    if (centered) {
      // we created a new node, so get a new reference
      getActiveNode(Store.getState().tracing)
        .map(newActiveNode => this.centerPositionAnimated(newActiveNode.position));
    }
  };


  centerPositionAnimated(position: Vector3, skipDimensions: boolean = true): void {
    // Let the user still manipulate the "third dimension" during animation
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    const dimensionToSkip = skipDimensions && activeViewport !== OrthoViews.TDView ?
      dimensions.thirdDimensionForPlane(activeViewport) :
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
}

export default SkeletonTracingPlaneController;
