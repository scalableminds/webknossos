/**
 * skeletontracing_plane_controller.js
 * @flow
 */
/* globals JQueryInputEventObject:false */

import $ from "jquery";
import * as THREE from "three";
import _ from "lodash";
import Store from "oxalis/store";
import {
  PlaneControllerClass,
  mapStateToProps,
} from "oxalis/controller/viewmodes/plane_controller";
import SceneController from "oxalis/controller/scene_controller";
import { OrthoViews } from "oxalis/constants";
import {
  setActiveNodeAction,
  deleteNodeAction,
  createTreeAction,
  createNodeAction,
  createBranchPointAction,
  requestDeleteBranchPointAction,
  mergeTreesAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setRotationAction } from "oxalis/model/actions/flycam_actions";
import {
  getPosition,
  getRotationOrtho,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import { getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import type { Point2, Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { ModifierKeys } from "libs/input";
import api from "oxalis/api/internal_api";
import { connect } from "react-redux";

const OrthoViewToNumber: OrthoViewMapType<number> = {
  [OrthoViews.PLANE_XY]: 0,
  [OrthoViews.PLANE_YZ]: 1,
  [OrthoViews.PLANE_XZ]: 2,
  [OrthoViews.TDView]: 3,
};

class SkeletonTracingPlaneController extends PlaneControllerClass {
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
      "1": () => Store.dispatch(toggleAllTreesAction()),
      "2": () => Store.dispatch(toggleInactiveTreesAction()),

      // Delete active node
      delete: () => Store.dispatch(deleteNodeAction()),
      c: () => Store.dispatch(createTreeAction()),

      // Branches
      b: () => Store.dispatch(createBranchPointAction()),
      j: () => Store.dispatch(requestDeleteBranchPointAction()),

      s: () => {
        api.tracing.centerNode();
        api.tracing.centerTDView();
      },
    });
  }

  scrollPlanes(delta: number, type: ?ModifierKeys): void {
    super.scrollPlanes(delta, type);

    if (type === "shift") {
      // Different browsers send different deltas, this way the behavior is comparable
      api.tracing.setNodeRadius(delta > 0 ? 5 : -5);
    }
  }

  onClick = (
    position: Point2,
    shiftPressed: boolean,
    altPressed: boolean,
    plane: OrthoViewType,
  ): void => {
    if (!shiftPressed) {
      // do nothing
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
        getActiveNode(Store.getState().tracing).map(activeNode =>
          Store.dispatch(mergeTreesAction(activeNode.id, nodeId)),
        );
      } else {
        Store.dispatch(setActiveNodeAction(nodeId));
      }
    }
  };

  setWaypoint(position: Vector3, ctrlPressed: boolean): void {
    const activeViewport = Store.getState().viewModeData.plane.activeViewport;
    if (activeViewport === OrthoViews.TDView) {
      return;
    }
    const activeNodeMaybe = getActiveNode(Store.getState().tracing);

    // set the new trace direction
    activeNodeMaybe.map(activeNode =>
      Store.dispatch(
        setRotationAction([
          position[0] - activeNode.position[0],
          position[1] - activeNode.position[1],
          position[2] - activeNode.position[2],
        ]),
      ),
    );

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

    Store.dispatch(
      createNodeAction(
        position,
        rotation,
        OrthoViewToNumber[Store.getState().viewModeData.plane.activeViewport],
        getRequestLogZoomStep(state),
      ),
    );

    if (centered) {
      // we created a new node, so get a new reference
      getActiveNode(Store.getState().tracing).map(newActiveNode =>
        // Center the position of the active node without modifying the "third" dimension (see centerPositionAnimated)
        // This is important because otherwise the user cannot continue to trace until the animation is over
        api.tracing.centerPositionAnimated(newActiveNode.position, true),
      );
    }
  };
}

export default connect(mapStateToProps)(SkeletonTracingPlaneController);
