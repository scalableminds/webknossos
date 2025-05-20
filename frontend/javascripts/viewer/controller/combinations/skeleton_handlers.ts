import { V3 } from "libs/mjs";
import { values } from "libs/utils";
import _ from "lodash";
import * as THREE from "three";
import type { AdditionalCoordinate } from "types/api_types";
import type { OrthoView, OrthoViewMap, Point2, Vector3, Viewport } from "viewer/constants";
import { OrthoViews } from "viewer/constants";
import { getClosestHoveredBoundingBox } from "viewer/controller/combinations/bounding_box_handlers";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getEnabledColorLayers } from "viewer/model/accessors/dataset_accessor";
import {
  getActiveMagIndicesForLayers,
  getPosition,
  getRotationInRadian,
  getRotationOrthoInRadian,
  isMagRestrictionViolated,
} from "viewer/model/accessors/flycam_accessor";
import {
  enforceSkeletonTracing,
  getActiveNode,
  getNodePosition,
  getSkeletonTracing,
  getTreeAndNode,
  getTreeAndNodeOrNull,
  untransformNodePosition,
} from "viewer/model/accessors/skeletontracing_accessor";
import {
  calculateGlobalPos,
  calculateMaybeGlobalPos,
  getInputCatcherRect,
  type GlobalPosition,
} from "viewer/model/accessors/view_mode_accessor";
import { setDirectionAction } from "viewer/model/actions/flycam_actions";
import {
  createBranchPointAction,
  createNodeAction,
  createTreeAction,
  deleteEdgeAction,
  mergeTreesAction,
  setActiveNodeAction,
  setNodePositionAction,
  updateNavigationListAction,
} from "viewer/model/actions/skeletontracing_actions";
import { showContextMenuAction } from "viewer/model/actions/ui_actions";
import Dimensions from "viewer/model/dimensions";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import { api } from "viewer/singletons";
import Store from "viewer/store";
import type { Edge, Node, Tree } from "viewer/store";
import type ArbitraryView from "viewer/view/arbitrary_view";
import type PlaneView from "viewer/view/plane_view";
import { renderToTexture } from "viewer/view/rendering_utils";
const OrthoViewToNumber: OrthoViewMap<number> = {
  [OrthoViews.PLANE_XY]: 0,
  [OrthoViews.PLANE_YZ]: 1,
  [OrthoViews.PLANE_XZ]: 2,
  [OrthoViews.TDView]: 3,
};
export function handleMergeTrees(
  view: PlaneView | ArbitraryView,
  position: Point2,
  plane: Viewport,
  isTouch: boolean,
) {
  const nodeId = maybeGetNodeIdFromPosition(view, position, plane, isTouch);
  const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);

  // otherwise we have hit the background and do nothing
  if (nodeId != null && nodeId > 0) {
    const activeNode = getActiveNode(skeletonTracing);
    if (activeNode) {
      Store.dispatch(mergeTreesAction(activeNode.id, nodeId));
    }
  }
}
export function handleDeleteEdge(
  view: PlaneView | ArbitraryView,
  position: Point2,
  plane: Viewport,
  isTouch: boolean,
) {
  const nodeId = maybeGetNodeIdFromPosition(view, position, plane, isTouch);
  const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);

  // otherwise we have hit the background and do nothing
  if (nodeId != null && nodeId > 0) {
    const activeNode = getActiveNode(skeletonTracing);
    if (activeNode) {
      Store.dispatch(deleteEdgeAction(activeNode.id, nodeId));
    }
  }
}
export function handleSelectNode(
  view: PlaneView | ArbitraryView,
  position: Point2,
  plane: Viewport,
  isTouch: boolean,
): boolean {
  const nodeId = maybeGetNodeIdFromPosition(view, position, plane, isTouch);

  // otherwise we have hit the background and do nothing
  if (nodeId != null && nodeId > 0) {
    const suppressRotation = "isOrthoPlaneView" in view && view.isOrthoPlaneView;
    Store.dispatch(setActiveNodeAction(nodeId, false, false, suppressRotation));
    return true;
  }

  return false;
}
export function handleCreateNodeFromEvent(position: Point2, ctrlPressed: boolean) {
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
  handleCreateNodeFromGlobalPosition(globalPosition, activeViewport, ctrlPressed);
}
export function handleOpenContextMenu(
  planeView: PlaneView,
  position: Point2,
  plane: OrthoView,
  isTouch: boolean,
  event: MouseEvent,
  meshId?: number | null | undefined,
  meshIntersectionPosition?: Vector3 | null | undefined,
  unmappedSegmentId?: number | null | undefined,
) {
  const { activeViewport } = Store.getState().viewModeData.plane;

  const nodeId = maybeGetNodeIdFromPosition(planeView, position, plane, isTouch);
  const state = Store.getState();
  // Use calculateMaybeGlobalPos instead of calculateGlobalPos, since calculateGlobalPos
  // only works for the data viewports, but this function is also called for the 3d viewport.
  const globalPositions = calculateMaybeGlobalPos(state, position);
  const hoveredEdgesInfo = getClosestHoveredBoundingBox(position, plane);
  const clickedBoundingBoxId = hoveredEdgesInfo != null ? hoveredEdgesInfo[0].boxId : null;

  // On Windows the right click to open the context menu is also triggered for the overlay
  // of the context menu. This causes the context menu to instantly close after opening.
  // Therefore delay the state update to delay that the context menu is rendered.
  // Thus the context overlay does not get the right click as an event and therefore does not close.
  setTimeout(
    () =>
      Store.dispatch(
        showContextMenuAction(
          event.pageX,
          event.pageY,
          nodeId,
          clickedBoundingBoxId,
          globalPositions?.rounded,
          activeViewport,
          meshId,
          meshIntersectionPosition,
          unmappedSegmentId,
        ),
      ),
    0,
  );
}
export function moveNode(
  dx: number,
  dy: number,
  nodeId?: number | null | undefined,
  // If useFloat is false, the node will be moved by integer deltas.
  // If useFloat is true, the caller should ensure that the node position
  // is changed to integers afterwards (e.g., when dragging a node where
  // the floats are used temporary for a smooth UX).
  useFloat: boolean = false,
) {
  // dx and dy are measured in pixel.
  const state = Store.getState();
  const skeletonTracing = getSkeletonTracing(state.annotation);
  if (!skeletonTracing) return;

  const treeAndNode = getTreeAndNode(skeletonTracing, nodeId);
  if (!treeAndNode) return;

  const [activeTree, activeNode] = treeAndNode;

  const { activeViewport } = state.viewModeData.plane;
  const vector = Dimensions.transDim([dx, dy, 0], activeViewport);
  const flycamRotation = getRotationInRadian(state.flycam);
  const isRotated = !_.isEqual(flycamRotation, [0, 0, 0]);

  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(...flycamRotation),
  );
  const vectorRotated = new THREE.Vector3(...vector).applyMatrix4(rotationMatrix);

  const zoomFactor = state.flycam.zoomStep;
  const scaleFactor = getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale);

  const op = (val: number) => {
    if (useFloat || isRotated) {
      return val;
    }
    // Zero diffs should stay zero.
    // Other values should be rounded, but should at least
    // have an absolute value of 1 (otherwise, the node
    // wouldn't move).
    const sign = Math.sign(val);
    if (sign === 0) {
      return 0;
    }
    const positiveVal = sign * val;
    return sign * Math.max(1, Math.round(positiveVal));
  };

  const delta = [
    op(vectorRotated.x * zoomFactor * scaleFactor[0]),
    op(vectorRotated.y * zoomFactor * scaleFactor[1]),
    op(vectorRotated.z * zoomFactor * scaleFactor[2]),
  ];
  const [x, y, z] = getNodePosition(activeNode, state);

  Store.dispatch(
    setNodePositionAction(
      untransformNodePosition([x + delta[0], y + delta[1], z + delta[2]], state),
      activeNode.id,
      activeTree.treeId,
    ),
  );
}

export function finishNodeMovement(nodeId: number) {
  const skeletonTracing = getSkeletonTracing(Store.getState().annotation);
  if (!skeletonTracing) return;

  const treeAndNode = getTreeAndNode(skeletonTracing, nodeId);
  if (!treeAndNode) return;

  const [activeTree, node] = treeAndNode;

  Store.dispatch(
    setNodePositionAction(
      V3.round(node.untransformedPosition, [0, 0, 0]),
      node.id,
      activeTree.treeId,
    ),
  );
}

export function handleCreateNodeFromGlobalPosition(
  nodePosition: GlobalPosition,
  activeViewport: OrthoView,
  ctrlIsPressed: boolean,
): void {
  const state = Store.getState();
  // Create a new tree automatically if the corresponding setting is true and allowed
  const createNewTree =
    state.annotation.restrictions.somaClickingAllowed && state.userConfiguration.newNodeNewTree;
  if (createNewTree) {
    Store.dispatch(createTreeAction());
  }

  const {
    additionalCoordinates,
    rotation,
    center,
    branchpoint,
    activate,
    skipCenteringAnimationInThirdDimension,
  } = getOptionsForCreateSkeletonNode(activeViewport, ctrlIsPressed);
  createSkeletonNode(
    nodePosition,
    additionalCoordinates,
    rotation,
    center,
    branchpoint,
    activate,
    skipCenteringAnimationInThirdDimension,
  );
}

export function getOptionsForCreateSkeletonNode(
  activeViewport: OrthoView | null = null,
  ctrlIsPressed: boolean = false,
) {
  const state = Store.getState();
  const additionalCoordinates = state.flycam.additionalCoordinates;
  const skeletonTracing = enforceSkeletonTracing(state.annotation);
  const activeNode = getActiveNode(skeletonTracing);
  const initialViewportRotation = getRotationOrthoInRadian(
    activeViewport || state.viewModeData.plane.activeViewport,
  );
  const flycamRotation = getRotationInRadian(state.flycam);
  const totalRotationQuaternion = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(...initialViewportRotation))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...flycamRotation)));
  const rotationEuler = new THREE.Euler().setFromQuaternion(totalRotationQuaternion);
  const rotationInDegree = [rotationEuler.x, rotationEuler.y, rotationEuler.z].map(
    (a) => (a * 180) / Math.PI,
  ) as Vector3;

  // Center node if the corresponding setting is true. Only pressing CTRL can override this.
  const center = state.userConfiguration.centerNewNode && !ctrlIsPressed;

  // Only create a branchpoint if CTRL is pressed. Unless newNodeNewTree is activated (branchpoints make no sense then)
  const branchpoint = ctrlIsPressed && !state.userConfiguration.newNodeNewTree;

  // Always activate the new node unless CTRL is pressed. If there is no current node,
  // the new one is still activated regardless of CTRL (otherwise, using CTRL+click in an empty tree multiple times would
  // not create any edges; see https://github.com/scalableminds/webknossos/issues/5303).
  const activate = !ctrlIsPressed || activeNode == null;

  const skipCenteringAnimationInThirdDimension = true;
  return {
    additionalCoordinates,
    rotation: rotationInDegree,
    center,
    branchpoint,
    activate,
    skipCenteringAnimationInThirdDimension,
  };
}

export function createSkeletonNode(
  position: GlobalPosition,
  additionalCoordinates: AdditionalCoordinate[] | null,
  rotation: Vector3,
  center: boolean,
  branchpoint: boolean,
  activate: boolean,
  skipCenteringAnimationInThirdDimension: boolean,
): void {
  updateTraceDirection(position.rounded);

  let state = Store.getState();
  const enabledColorLayers = getEnabledColorLayers(state.dataset, state.datasetConfiguration);
  const activeMagIndices = getActiveMagIndicesForLayers(state);
  const activeMagIndicesOfEnabledColorLayers = _.pick(
    activeMagIndices,
    enabledColorLayers.map((l) => l.name),
  );
  const finestMagIdx =
    _.min(values(activeMagIndicesOfEnabledColorLayers)) || _.min(values(activeMagIndices)) || 0;

  Store.dispatch(
    createNodeAction(
      untransformNodePosition(position.floating, state),
      additionalCoordinates,
      rotation,
      OrthoViewToNumber[Store.getState().viewModeData.plane.activeViewport],
      // This is the magnification index at which the node was created. Since
      // different layers can be rendered at different mags, it's not really clear
      // which mag should be used, but the above heuristic defaults to the best
      // magnification (of visible color layers or as a fallback of all layers).
      finestMagIdx,
      null,
      !activate,
    ),
  );

  // We need a reference to the new store state, so that the new node exists in it.
  state = Store.getState();

  if (center) {
    const newSkeleton = enforceSkeletonTracing(state.annotation);
    // Note that the new node isn't necessarily active
    const newNodeId = newSkeleton.cachedMaxNodeId;

    const treeAndNode = getTreeAndNode(newSkeleton, newNodeId, newSkeleton.activeTreeId);
    if (!treeAndNode) return;

    api.tracing.centerPositionAnimated(position.floating, skipCenteringAnimationInThirdDimension);
  }

  if (branchpoint) {
    Store.dispatch(createBranchPointAction());
  }
}

function updateTraceDirection(position: Vector3) {
  const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
  const activeNode = getActiveNode(skeletonTracing);
  if (activeNode != null) {
    const activeNodePosition = getNodePosition(activeNode, Store.getState());
    return Store.dispatch(
      setDirectionAction([
        position[0] - activeNodePosition[0],
        position[1] - activeNodePosition[1],
        position[2] - activeNodePosition[2],
      ]),
    );
  }
}

export function moveAlongDirection(reverse: boolean = false): void {
  const directionInverter = reverse ? -1 : 1;
  const { flycam } = Store.getState();
  const newPosition = V3.add(getPosition(flycam), V3.scale(flycam.direction, directionInverter));
  api.tracing.centerPositionAnimated(newPosition, false);
}
export function maybeGetNodeIdFromPosition(
  planeView: PlaneView | ArbitraryView,
  position: Point2,
  plane: Viewport,
  isTouch: boolean,
): number | null | undefined {
  const SceneController = getSceneController();
  const { skeletons } = SceneController;

  // Unfortunately, we cannot import the Skeleton class here to set the correct type, due to cyclic dependencies
  const skeletonsWhichSupportPicking = _.values(skeletons).filter(
    (skeleton) => skeleton.supportsPicking,
  );

  if (skeletonsWhichSupportPicking.length === 0) {
    return null;
  } else if (skeletonsWhichSupportPicking.length > 1) {
    throw Error("Only one skeleton with supportPicking === true is supported for now.");
  }

  const skeleton = skeletonsWhichSupportPicking[0];
  // render the clicked viewport with picking enabled
  // we need a dedicated pickingScene, since we only want to render all nodes and no planes / bounding box / edges etc.
  const pickingNode = skeleton.startPicking(isTouch);
  const pickingScene = new THREE.Scene();
  pickingScene.add(pickingNode);
  const camera = planeView.getCameraForPlane(plane);

  let { width, height } = getInputCatcherRect(Store.getState(), plane);
  width = Math.round(width);
  height = Math.round(height);
  const buffer = renderToTexture(plane, pickingScene, camera, true);
  // Beware of the fact that new browsers yield float numbers for the mouse position
  const [x, y] = [Math.round(position.x), Math.round(position.y)];
  // compute the index of the pixel under the cursor,
  // while inverting along the y-axis, because WebGL has its origin bottom-left :/
  const index = (x + (height - y) * width) * 4;
  // the nodeId can be reconstructed by interpreting the RGB values of the pixel as a base-256 number
  const nodeId = buffer.subarray(index, index + 3).reduce((a, b) => a * 256 + b, 0);
  skeleton.stopPicking();
  // prevent flickering sometimes caused by picking
  planeView.renderFunction(true);
  return nodeId > 0 ? nodeId : null;
}

function otherNodeOfEdge(edge: Edge, nodeId: number): number {
  return edge.source === nodeId ? edge.target : edge.source;
}

function getSubsequentNodeFromTree(
  tree: Tree,
  node: Node,
  excludedId: number | null | undefined,
): number {
  const nodes = tree.edges
    .getEdgesForNode(node.id)
    .map((edge) => otherNodeOfEdge(edge, node.id))
    .filter((id) => id !== excludedId);
  const next = nodes.length ? Math.max(...nodes) : node.id;
  return next;
}

function getPrecedingNodeFromTree(
  tree: Tree,
  node: Node,
  excludedId: number | null | undefined,
): number {
  const nodes = tree.edges
    .getEdgesForNode(node.id)
    .map((edge) => otherNodeOfEdge(edge, node.id))
    .filter((id) => id !== excludedId);
  const prev = nodes.length ? Math.min(...nodes) : node.id;
  return prev;
}

export function toSubsequentNode(): void {
  const { annotation, temporaryConfiguration } = Store.getState();
  const suppressRotation = temporaryConfiguration.viewMode === "orthogonal";
  const tracing = enforceSkeletonTracing(annotation);
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
    Store.dispatch(
      setActiveNodeAction(
        navigationList.list[navigationList.activeIndex + 1],
        false,
        false,
        suppressRotation,
      ),
    );
    Store.dispatch(updateNavigationListAction(navigationList.list, navigationList.activeIndex + 1));
  } else {
    // search for subsequent node in tree
    const { tree, node } = getTreeAndNodeOrNull(tracing, activeNodeId, activeTreeId);
    if (!tree || !node) return;
    const nextNodeId = getSubsequentNodeFromTree(
      tree,
      node,
      navigationList.list[navigationList.activeIndex - 1],
    );
    const newList = isValidList ? [...navigationList.list] : [activeNodeId];

    if (nextNodeId !== activeNodeId) {
      newList.push(nextNodeId);
      Store.dispatch(setActiveNodeAction(nextNodeId, false, false, suppressRotation));
    }

    Store.dispatch(updateNavigationListAction(newList, newList.length - 1));
  }
}
export function toPrecedingNode(): void {
  const { annotation, temporaryConfiguration } = Store.getState();
  const suppressRotation = temporaryConfiguration.viewMode === "orthogonal";
  const tracing = enforceSkeletonTracing(annotation);
  const { navigationList, activeNodeId, activeTreeId } = tracing;
  if (activeNodeId == null) return;
  const isValidList =
    activeNodeId === navigationList.list[navigationList.activeIndex] && navigationList.list.length;

  if (navigationList.activeIndex > 0 && isValidList) {
    // navigate to preceding node in list
    Store.dispatch(
      setActiveNodeAction(
        navigationList.list[navigationList.activeIndex - 1],
        false,
        false,
        suppressRotation,
      ),
    );
    Store.dispatch(updateNavigationListAction(navigationList.list, navigationList.activeIndex - 1));
  } else {
    // search for preceding node in tree
    const { tree, node } = getTreeAndNodeOrNull(tracing, activeNodeId, activeTreeId);
    if (!tree || !node) return;
    const nextNodeId = getPrecedingNodeFromTree(
      tree,
      node,
      navigationList.list[navigationList.activeIndex + 1],
    );
    const newList = isValidList ? [...navigationList.list] : [activeNodeId];

    if (nextNodeId !== activeNodeId) {
      newList.unshift(nextNodeId);
      Store.dispatch(setActiveNodeAction(nextNodeId, false, false, suppressRotation));
    }

    Store.dispatch(updateNavigationListAction(newList, 0));
  }
}
