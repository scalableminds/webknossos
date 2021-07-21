// @flow
import * as THREE from "three";

import {
  OUTER_CSS_BORDER,
  type OrthoView,
  type OrthoViewMap,
  OrthoViews,
  type Point2,
  type Vector3,
  type ShowContextMenuFunction,
} from "oxalis/constants";
import { V3 } from "libs/mjs";

import { enforce } from "libs/utils";
import {
  enforceSkeletonTracing,
  getSkeletonTracing,
  getActiveNode,
  getNodeAndTree,
  getNodeAndTreeOrNull,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getInputCatcherRect, calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import {
  getPosition,
  getRotationOrtho,
  getRequestLogZoomStep,
  isMagRestrictionViolated,
} from "oxalis/model/accessors/flycam_accessor";
import {
  setActiveNodeAction,
  deleteEdgeAction,
  createTreeAction,
  createNodeAction,
  createBranchPointAction,
  mergeTreesAction,
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
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";

const OrthoViewToNumber: OrthoViewMap<number> = {
  [OrthoViews.PLANE_XY]: 0,
  [OrthoViews.PLANE_YZ]: 1,
  [OrthoViews.PLANE_XZ]: 2,
  [OrthoViews.TDView]: 3,
};

export function handleMergeTrees(
  planeView: PlaneView,
  position: Point2,
  plane: OrthoView,
  isTouch: boolean,
) {
  const nodeId = maybeGetNodeIdFromPosition(planeView, position, plane, isTouch);

  const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
  // otherwise we have hit the background and do nothing
  if (nodeId != null && nodeId > 0) {
    getActiveNode(skeletonTracing).map(activeNode =>
      Store.dispatch(mergeTreesAction(activeNode.id, nodeId)),
    );
  }
}
export function handleDeleteEdge(
  planeView: PlaneView,
  position: Point2,
  plane: OrthoView,
  isTouch: boolean,
) {
  const nodeId = maybeGetNodeIdFromPosition(planeView, position, plane, isTouch);

  const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
  // otherwise we have hit the background and do nothing
  if (nodeId != null && nodeId > 0) {
    getActiveNode(skeletonTracing).map(activeNode =>
      Store.dispatch(deleteEdgeAction(activeNode.id, nodeId)),
    );
  }
}
export function handleSelectNode(
  planeView: PlaneView,
  position: Point2,
  plane: OrthoView,
  isTouch: boolean,
): boolean {
  const nodeId = maybeGetNodeIdFromPosition(planeView, position, plane, isTouch);

  // otherwise we have hit the background and do nothing
  if (nodeId != null && nodeId > 0) {
    Store.dispatch(setActiveNodeAction(nodeId));
    return true;
  }
  return false;
}

export function handleCreateNode(planeView: PlaneView, position: Point2, ctrlPressed: boolean) {
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

  const globalPosition = calculateGlobalPos(state, position);
  setWaypoint(globalPosition, activeViewport, ctrlPressed);
}

export function handleOpenContextMenu(
  planeView: PlaneView,
  position: Point2,
  plane: OrthoView,
  isTouch: boolean,
  event: MouseEvent,
  showNodeContextMenuAt: ShowContextMenuFunction,
) {
  const { activeViewport } = Store.getState().viewModeData.plane;
  if (activeViewport === OrthoViews.TDView) {
    return;
  }
  const nodeId = maybeGetNodeIdFromPosition(planeView, position, plane, isTouch);
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, position);
  showNodeContextMenuAt(event.pageX, event.pageY, nodeId, globalPosition, activeViewport);
}

export function moveNode(dx: number, dy: number, nodeId: ?number) {
  // dx and dy are measured in pixel.
  getSkeletonTracing(Store.getState().tracing).map(skeletonTracing =>
    getNodeAndTree(skeletonTracing, nodeId).map(([activeTree, activeNode]) => {
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

export function openContextMenu(
  planeView: PlaneView,
  position: Point2,
  plane: OrthoView,
  isTouch: boolean,
  event: MouseEvent,
  showNodeContextMenuAt: ShowContextMenuFunction,
) {
  const state = Store.getState();
  const { activeViewport } = state.viewModeData.plane;
  if (activeViewport === OrthoViews.TDView) {
    return;
  }

  const nodeId = maybeGetNodeIdFromPosition(planeView, position, plane, isTouch);
  const globalPosition = calculateGlobalPos(state, position);
  showNodeContextMenuAt(event.pageX, event.pageY, nodeId, globalPosition, activeViewport);
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

export function moveAlongDirection(reverse: boolean = false): void {
  const directionInverter = reverse ? -1 : 1;
  const { flycam } = Store.getState();
  const newPosition = V3.add(getPosition(flycam), V3.scale(flycam.direction, directionInverter));
  api.tracing.centerPositionAnimated(newPosition, false);
}

export function maybeGetNodeIdFromPosition(
  planeView: PlaneView,
  position: Point2,
  plane: OrthoView,
  isTouch: boolean,
): ?number {
  const SceneController = getSceneController();
  const { skeleton } = SceneController;
  if (!skeleton) {
    return null;
  }

  // render the clicked viewport with picking enabled
  // we need a dedicated pickingScene, since we only want to render all nodes and no planes / bounding box / edges etc.
  const pickingNode = skeleton.startPicking(isTouch);
  const pickingScene = new THREE.Scene();
  pickingScene.add(pickingNode);
  const camera = planeView.getCameras()[plane];

  let { width, height } = getInputCatcherRect(Store.getState(), plane);
  width = Math.round(width);
  height = Math.round(height);
  const buffer = renderToTexture(plane, pickingScene, camera, true);
  // Beware of the fact that new browsers yield float numbers for the mouse position
  // Subtract the CSS border as the renderer viewport is smaller than the inputcatcher
  const borderWidth = OUTER_CSS_BORDER;
  const [x, y] = [Math.round(position.x) - borderWidth, Math.round(position.y) - borderWidth];
  // compute the index of the pixel under the cursor,
  // while inverting along the y-axis, because WebGL has its origin bottom-left :/
  const index = (x + (height - y) * width) * 4;
  // the nodeId can be reconstructed by interpreting the RGB values of the pixel as a base-255 number
  const nodeId = buffer.subarray(index, index + 3).reduce((a, b) => a * 255 + b, 0);
  skeleton.stopPicking();

  // prevent flickering sometimes caused by picking
  planeView.renderFunction(true);
  return nodeId > 0 ? nodeId : null;
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

export function toSubsequentNode(): void {
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

export function toPrecedingNode(): void {
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
