/**
 * skeletontracing_plane_controller.js
 * @flow
 */

import * as THREE from "three";
import _ from "lodash";

import {
  type OrthoView,
  type OrthoViewMap,
  OrthoViews,
  type Point2,
  type Vector3,
} from "oxalis/constants";
import { V3 } from "libs/mjs";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { enforce } from "libs/utils";
import {
  enforceSkeletonTracing,
  getActiveNode,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import {
  getPosition,
  getRotationOrtho,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import {
  setActiveNodeAction,
  deleteActiveNodeAsUserAction,
  deleteEdgeAction,
  createTreeAction,
  createNodeAction,
  createBranchPointAction,
  requestDeleteBranchPointAction,
  mergeTreesAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setDirectionAction } from "oxalis/model/actions/flycam_actions";
import type PlaneView from "oxalis/view/plane_view";
import Store from "oxalis/store";
import api from "oxalis/api/internal_api";
import getSceneController from "oxalis/controller/scene_controller_provider";

const OrthoViewToNumber: OrthoViewMap<number> = {
  [OrthoViews.PLANE_XY]: 0,
  [OrthoViews.PLANE_YZ]: 1,
  [OrthoViews.PLANE_XZ]: 2,
  [OrthoViews.TDView]: 3,
};

// eslint-disable-next-line no-unused-vars
function simulateTracing(nodesPerTree: number = -1, nodesAlreadySet: number = 0): void {
  // For debugging purposes.
  if (nodesPerTree === nodesAlreadySet) {
    Store.dispatch(createTreeAction());
    nodesAlreadySet = 0;
  }

  const [x, y, z] = getPosition(Store.getState().flycam);
  setWaypoint([x + 1, y + 1, z], false);
  _.defer(() => simulateTracing(nodesPerTree, nodesAlreadySet + 1));
}

export function getPlaneMouseControls(planeView: PlaneView) {
  return {
    leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
      onClick(planeView, pos, event.shiftKey, event.altKey, event.ctrlKey, plane, isTouch),
    rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent) =>
      setWaypoint(calculateGlobalPos(pos), event.ctrlKey),
  };
}

export function getTDViewMouseControls(planeView: PlaneView): Object {
  return {
    leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
      onClick(
        planeView,
        pos,
        event.shiftKey,
        event.altKey,
        event.ctrlKey,
        OrthoViews.TDView,
        isTouch,
      ),
  };
}

function moveAlongDirection(reverse: boolean = false): void {
  const directionInverter = reverse ? -1 : 1;
  const flycam = Store.getState().flycam;
  const newPosition = V3.add(getPosition(flycam), V3.scale(flycam.direction, directionInverter));
  api.tracing.centerPositionAnimated(newPosition, false);
}

export function getKeyboardControls() {
  return {
    "1": () => Store.dispatch(toggleAllTreesAction()),
    "2": () => Store.dispatch(toggleInactiveTreesAction()),

    // Delete active node
    delete: () => Store.dispatch(deleteActiveNodeAsUserAction(Store.getState())),
    c: () => Store.dispatch(createTreeAction()),

    e: () => moveAlongDirection(),
    r: () => moveAlongDirection(true),

    // Branches
    b: () => Store.dispatch(createBranchPointAction()),
    j: () => Store.dispatch(requestDeleteBranchPointAction()),

    s: () => {
      api.tracing.centerNode();
      api.tracing.centerTDView();
    },
  };
}

function onClick(
  planeView: PlaneView,
  position: Point2,
  shiftPressed: boolean,
  altPressed: boolean,
  ctrlPressed: boolean,
  plane: OrthoView,
  isTouch: boolean,
): void {
  if (!shiftPressed && !isTouch) {
    // do nothing
    return;
  }
  const SceneController = getSceneController();

  // render the clicked viewport with picking enabled
  // we need a dedicated pickingScene, since we only want to render all nodes and no planes / bounding box / edges etc.
  const pickingNode = SceneController.skeleton.startPicking(isTouch);
  const pickingScene = new THREE.Scene();
  pickingScene.add(pickingNode);

  let { width, height } = getInputCatcherRect(plane);
  width = Math.round(width);
  height = Math.round(height);

  const buffer = planeView.renderOrthoViewToTexture(plane, pickingScene);
  // Beware of the fact that new browsers yield float numbers for the mouse position
  const [x, y] = [Math.round(position.x), Math.round(position.y)];
  // compute the index of the pixel under the cursor,
  // while inverting along the y-axis, because OpenGL has its origin bottom-left :/
  const index = (x + (width - y) * height) * 4;
  // the nodeId can be reconstructed by interpreting the RGB values of the pixel as a base-255 number
  const nodeId = buffer.subarray(index, index + 3).reduce((a, b) => a * 255 + b, 0);
  SceneController.skeleton.stopPicking();

  // prevent flickering sometimes caused by picking
  planeView.renderFunction(true);

  const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
  // otherwise we have hit the background and do nothing
  if (nodeId > 0) {
    if (altPressed) {
      getActiveNode(skeletonTracing).map(activeNode =>
        Store.dispatch(mergeTreesAction(activeNode.id, nodeId)),
      );
    } else if (ctrlPressed) {
      getActiveNode(skeletonTracing).map(activeNode =>
        Store.dispatch(deleteEdgeAction(activeNode.id, nodeId)),
      );
    } else {
      Store.dispatch(setActiveNodeAction(nodeId));
    }
  }
}

function setWaypoint(position: Vector3, ctrlPressed: boolean): void {
  const { activeViewport } = Store.getState().viewModeData.plane;
  if (activeViewport === OrthoViews.TDView) {
    return;
  }
  const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
  const activeNodeMaybe = getActiveNode(skeletonTracing);

  // set the new trace direction
  activeNodeMaybe.map(activeNode =>
    Store.dispatch(
      setDirectionAction([
        position[0] - activeNode.position[0],
        position[1] - activeNode.position[1],
        position[2] - activeNode.position[2],
      ]),
    ),
  );

  const rotation = getRotationOrtho(activeViewport);
  addNode(position, rotation, !ctrlPressed);

  // Strg + Rightclick to set new not active branchpoint
  const { newNodeNewTree } = Store.getState().userConfiguration;
  if (ctrlPressed && !newNodeNewTree) {
    Store.dispatch(createBranchPointAction());
    activeNodeMaybe.map(activeNode => Store.dispatch(setActiveNodeAction(activeNode.id)));
  }
}

function addNode(position: Vector3, rotation: Vector3, centered: boolean): void {
  const state = Store.getState();
  const { newNodeNewTree } = state.userConfiguration;
  const activeNodeMaybe = enforce(getActiveNode)(state.tracing.skeleton);

  if (state.tracing.restrictions.somaClickingAllowed && newNodeNewTree) {
    Store.dispatch(createTreeAction());
  }

  if (activeNodeMaybe.isNothing) {
    // when placing very first node of a tracing
    centered = true;
  }

  Store.dispatch(
    createNodeAction(
      position,
      rotation,
      OrthoViewToNumber[Store.getState().viewModeData.plane.activeViewport],
      getRequestLogZoomStep(state),
    ),
  );

  if (centered) {
    // we created a new node, so get a new reference from the current store state
    const newState = Store.getState();
    enforce(getActiveNode)(newState.tracing.skeleton).map(newActiveNode =>
      // Center the position of the active node without modifying the "third" dimension (see centerPositionAnimated)
      // This is important because otherwise the user cannot continue to trace until the animation is over
      api.tracing.centerPositionAnimated(newActiveNode.position, true),
    );
  }
}
