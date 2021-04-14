// @flow
import * as THREE from "three";
import _ from "lodash";

import {
  OUTER_CSS_BORDER,
  type OrthoView,
  type OrthoViewMap,
  OrthoViews,
  type Point2,
  type Vector3,
  AnnotationToolEnum,
} from "oxalis/constants";
import { V3 } from "libs/mjs";
import { movePlane, calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { enforce } from "libs/utils";
import {
  enforceSkeletonTracing,
  getSkeletonTracing,
  getActiveNode,
  getNodeAndTree,
  getNodeAndTreeOrNull,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import {
  getPosition,
  getRotationOrtho,
  getRequestLogZoomStep,
  isMagRestrictionViolated,
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
  setNodePositionAction,
  updateNavigationListAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setDirectionAction } from "oxalis/model/actions/flycam_actions";
import type PlaneView from "oxalis/view/plane_view";
import Store from "oxalis/store";
import type { Edge, Tree, Node } from "oxalis/store";
import api from "oxalis/api/internal_api";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { renderToTexture } from "oxalis/view/rendering_utils";
import { agglomerateSkeletonMiddleClick } from "oxalis/controller/combinations/segmentation_plane_controller";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";

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
  setWaypoint([x + 1, y + 1, z], OrthoViews.PLANE_XY, false);
  _.defer(() => simulateTracing(nodesPerTree, nodesAlreadySet + 1));
}

export function getPlaneMouseControls(
  planeView: PlaneView,
  showNodeContextMenuAt: (number, number, ?number, Vector3, OrthoView) => void,
) {
  return {
    leftDownMove: (delta: Point2, pos: Point2, _id: ?string, event: MouseEvent) => {
      const { tracing } = Store.getState();
      if (tracing.skeleton != null && event.ctrlKey) {
        moveNode(delta.x, delta.y);
      } else {
        movePlane([-delta.x, -delta.y, 0]);
      }
    },
    leftClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
      onClick(planeView, pos, event.shiftKey, event.altKey, event.ctrlKey, plane, isTouch, event),
    rightClick: (pos: Point2, plane: OrthoView, event: MouseEvent, isTouch: boolean) =>
      onRightClick(
        planeView,
        pos,
        event.shiftKey,
        event.altKey,
        event.ctrlKey,
        plane,
        isTouch,
        event,
        showNodeContextMenuAt,
      ),
    middleClick: (pos: Point2, plane: OrthoView, event: MouseEvent) => {
      if (event.shiftKey) {
        agglomerateSkeletonMiddleClick(pos);
      }
    },
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
  const { flycam } = Store.getState();
  const newPosition = V3.add(getPosition(flycam), V3.scale(flycam.direction, directionInverter));
  api.tracing.centerPositionAnimated(newPosition, false);
}

export function moveNode(dx: number, dy: number) {
  // dx and dy are measured in pixel.
  getSkeletonTracing(Store.getState().tracing).map(skeletonTracing =>
    getNodeAndTree(skeletonTracing).map(([activeTree, activeNode]) => {
      const state = Store.getState();
      const { activeViewport } = state.viewModeData.plane;
      const vector = Dimensions.transDim([dx, dy, 0], activeViewport);
      const zoomFactor = state.flycam.zoomStep;
      const scaleFactor = getBaseVoxelFactors(state.dataset.dataSource.scale);
      const delta = [
        vector[0] * zoomFactor * scaleFactor[0],
        vector[1] * zoomFactor * scaleFactor[1],
        vector[2] * zoomFactor * scaleFactor[2],
      ];
      const [x, y, z] = activeNode.position;
      Store.dispatch(
        setNodePositionAction(
          [x + delta[0], y + delta[1], z + delta[2]],
          activeNode.id,
          activeTree.treeId,
        ),
      );
    }),
  );
}

function otherNodeOfEdge(edge: Edge, nodeId: number): number {
  return edge.source === nodeId ? edge.target : edge.source;
}
function getSubsequentNodeFromTree(tree: Tree, node: Node, excludedId: ?number): number {
  const nodes = tree.edges
    .getEdgesForNode(node.id)
    .map(edge => otherNodeOfEdge(edge, node.id))
    .filter(id => id !== excludedId);
  const next = nodes.length ? Math.max(...nodes) : node.id;
  return next;
}
function getPrecedingNodeFromTree(tree: Tree, node: Node, excludedId: ?number): number {
  const nodes = tree.edges
    .getEdgesForNode(node.id)
    .map(edge => otherNodeOfEdge(edge, node.id))
    .filter(id => id !== excludedId);
  const prev = nodes.length ? Math.min(...nodes) : node.id;
  return prev;
}

function toSubsequentNode(): void {
  const tracing = enforceSkeletonTracing(Store.getState().tracing);
  const { navigationList, activeNodeId, activeTreeId } = tracing;
  if (activeNodeId == null) return;

  const isValidList =
    activeNodeId === navigationList.list[navigationList.activeIndex] && navigationList.list.length;

  if (
    navigationList.list.length > 1 &&
    navigationList.activeIndex < navigationList.list.length - 1 &&
    isValidList
  ) {
    // navigate to subsequent node in list
    Store.dispatch(setActiveNodeAction(navigationList.list[navigationList.activeIndex + 1]));
    Store.dispatch(updateNavigationListAction(navigationList.list, navigationList.activeIndex + 1));
  } else {
    // search for subsequent node in tree
    const { tree, node } = getNodeAndTreeOrNull(tracing, activeNodeId, activeTreeId);
    if (!tree || !node) return;
    const nextNodeId = getSubsequentNodeFromTree(
      tree,
      node,
      navigationList.list[navigationList.activeIndex - 1],
    );

    const newList = isValidList ? [...navigationList.list] : [activeNodeId];
    if (nextNodeId !== activeNodeId) {
      newList.push(nextNodeId);
      Store.dispatch(setActiveNodeAction(nextNodeId));
    }

    Store.dispatch(updateNavigationListAction(newList, newList.length - 1));
  }
}

function toPrecedingNode(): void {
  const tracing = enforceSkeletonTracing(Store.getState().tracing);
  const { navigationList, activeNodeId, activeTreeId } = tracing;

  if (activeNodeId == null) return;

  const isValidList =
    activeNodeId === navigationList.list[navigationList.activeIndex] && navigationList.list.length;

  if (navigationList.activeIndex > 0 && isValidList) {
    // navigate to preceding node in list
    Store.dispatch(setActiveNodeAction(navigationList.list[navigationList.activeIndex - 1]));
    Store.dispatch(updateNavigationListAction(navigationList.list, navigationList.activeIndex - 1));
  } else {
    // search for preceding node in tree
    const { tree, node } = getNodeAndTreeOrNull(tracing, activeNodeId, activeTreeId);
    if (!tree || !node) return;
    const nextNodeId = getPrecedingNodeFromTree(
      tree,
      node,
      navigationList.list[navigationList.activeIndex + 1],
    );

    const newList = isValidList ? [...navigationList.list] : [activeNodeId];
    if (nextNodeId !== activeNodeId) {
      newList.unshift(nextNodeId);
      Store.dispatch(setActiveNodeAction(nextNodeId));
    }
    Store.dispatch(updateNavigationListAction(newList, 0));
  }
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

    // navigate nodes
    "ctrl + ,": () => toPrecedingNode(),
    "ctrl + .": () => toSubsequentNode(),
  };
}
export function getLoopedKeyboardControls() {
  return {
    "ctrl + left": () => moveNode(-1, 0),
    "ctrl + right": () => moveNode(1, 0),
    "ctrl + up": () => moveNode(0, -1),
    "ctrl + down": () => moveNode(0, 1),
  };
}

function maybeGetNodeIdFromPosition(
  planeView: PlaneView,
  position: Point2,
  plane: OrthoView,
  isTouch: boolean,
): ?number {
  const SceneController = getSceneController();

  // render the clicked viewport with picking enabled
  // we need a dedicated pickingScene, since we only want to render all nodes and no planes / bounding box / edges etc.
  const pickingNode = SceneController.skeleton.startPicking(isTouch);
  const pickingScene = new THREE.Scene();
  pickingScene.add(pickingNode);
  const camera = planeView.getCameras()[plane];

  let { width, height } = getInputCatcherRect(Store.getState(), plane);
  width = Math.round(width);
  height = Math.round(height);

  const buffer = renderToTexture(plane, pickingScene, camera);
  // Beware of the fact that new browsers yield float numbers for the mouse position
  // Subtract the CSS border as the renderer viewport is smaller than the inputcatcher
  const borderWidth = OUTER_CSS_BORDER;
  const [x, y] = [Math.round(position.x) - borderWidth, Math.round(position.y) - borderWidth];
  // compute the index of the pixel under the cursor,
  // while inverting along the y-axis, because WebGL has its origin bottom-left :/
  const index = (x + (height - y) * width) * 4;
  // the nodeId can be reconstructed by interpreting the RGB values of the pixel as a base-255 number
  const nodeId = buffer.subarray(index, index + 3).reduce((a, b) => a * 255 + b, 0);
  SceneController.skeleton.stopPicking();

  // prevent flickering sometimes caused by picking
  planeView.renderFunction(true);
  return nodeId > 0 ? nodeId : null;
}

function onClick(
  planeView: PlaneView,
  position: Point2,
  shiftPressed: boolean,
  altPressed: boolean,
  ctrlPressed: boolean,
  plane: OrthoView,
  isTouch: boolean,
  event?: MouseEvent,
): void {
  if (!shiftPressed && !isTouch && !(ctrlPressed && event != null)) {
    // do nothing
    return;
  }
  const nodeId = maybeGetNodeIdFromPosition(planeView, position, plane, isTouch);

  const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
  // otherwise we have hit the background and do nothing
  if (nodeId != null && nodeId > 0) {
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

function onRightClick(
  planeView: PlaneView,
  position: Point2,
  shiftPressed: boolean,
  altPressed: boolean,
  ctrlPressed: boolean,
  plane: OrthoView,
  isTouch: boolean,
  event: MouseEvent,
  showNodeContextMenuAt: (number, number, ?number, Vector3, OrthoView) => void,
) {
  const state = Store.getState();
  if (isMagRestrictionViolated(state)) {
    // The current zoom value violates the specified magnification-restriction in the
    // task type. Therefore, we abort the action here.
    // Actually, one would need to handle more skeleton actions (e.g., deleting a node),
    // but not all (e.g., deleting a tree from the tree tab should be allowed). Therefore,
    // this solution is a bit of a shortcut. However, it should cover 90% of the use case
    // for restricting the rendered magnification.
    // See https://github.com/scalableminds/webknossos/pull/4891 for context and
    // https://github.com/scalableminds/webknossos/issues/4838 for the follow-up issue.
    return;
  }
  const { activeViewport } = Store.getState().viewModeData.plane;
  if (activeViewport === OrthoViews.TDView) {
    return;
  }

  const { activeTool } = state.tracing;
  if (activeTool === AnnotationToolEnum.SKELETON) {
    // We avoid creating nodes when in brushing mode.
    const nodeId = event.shiftKey
      ? maybeGetNodeIdFromPosition(planeView, position, plane, isTouch)
      : null;
    const globalPosition = calculateGlobalPos(position);
    if (event.shiftKey) {
      showNodeContextMenuAt(event.pageX, event.pageY, nodeId, globalPosition, activeViewport);
    } else {
      setWaypoint(globalPosition, activeViewport, ctrlPressed);
    }
  }
}

export function setWaypoint(
  position: Vector3,
  activeViewport: OrthoView,
  ctrlIsPressed: boolean,
): void {
  const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
  const activeNodeMaybe = getActiveNode(skeletonTracing);
  const rotation = getRotationOrtho(activeViewport);

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

  const state = Store.getState();

  // Create a new tree automatically if the corresponding setting is true and allowed
  const createNewTree =
    state.tracing.restrictions.somaClickingAllowed && state.userConfiguration.newNodeNewTree;
  // Center node if the corresponding setting is true. Only pressing CTRL can override this.
  const center = state.userConfiguration.centerNewNode && !ctrlIsPressed;
  // Only create a branchpoint if CTRL is pressed. Unless newNodeNewTree is activated (branchpoints make no sense then)
  const branchpoint = ctrlIsPressed && !state.userConfiguration.newNodeNewTree;
  // Always activate the new node unless CTRL is pressed. If there is no current node,
  // the new one is still activated regardless of CTRL (otherwise, using CTRL+click in an empty tree multiple times would
  // not create any edges; see https://github.com/scalableminds/webknossos/issues/5303).
  const activate = !ctrlIsPressed || activeNodeMaybe.isNothing;

  addNode(position, rotation, createNewTree, center, branchpoint, activate);
}

function addNode(
  position: Vector3,
  rotation: Vector3,
  createNewTree: boolean,
  center: boolean,
  branchpoint: boolean,
  activate: boolean,
): void {
  if (createNewTree) {
    Store.dispatch(createTreeAction());
  }

  Store.dispatch(
    createNodeAction(
      position,
      rotation,
      OrthoViewToNumber[Store.getState().viewModeData.plane.activeViewport],
      getRequestLogZoomStep(Store.getState()),
      null,
      !activate,
    ),
  );

  if (center) {
    // we created a new node, so get a new reference from the current store state
    const newState = Store.getState();
    enforce(getActiveNode)(newState.tracing.skeleton).map(newActiveNode =>
      // Center the position of the active node without modifying the "third" dimension (see centerPositionAnimated)
      // This is important because otherwise the user cannot continue to trace until the animation is over
      api.tracing.centerPositionAnimated(newActiveNode.position, true),
    );
  }

  if (branchpoint) {
    Store.dispatch(createBranchPointAction());
  }
}
