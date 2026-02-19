import type { ItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";
import { AltOrOptionKey, CtrlOrCmdKey } from "viewer/constants";
import { getTreeAndNodeOrNull } from "viewer/model/accessors/skeletontracing_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  cutAgglomerateFromNeighborsAction,
  minCutAgglomerateAction,
} from "viewer/model/actions/proofread_actions";
import {
  createBranchPointAction,
  deleteBranchpointByIdAction,
  deleteEdgeAction,
  expandParentGroupsOfTreeAction,
  focusTreeAction,
  mergeTreesAction,
  setActiveNodeAction,
  setTreeVisibilityAction,
} from "viewer/model/actions/skeletontracing_actions";
import Store from "viewer/store";
import { LayoutEvents, layoutEmitter } from "../layouting/layout_persistence";
import { Actions } from "./context_menu_actions";
import {
  extractShortestPathAsNewTree,
  measureAndShowFullTreeLength,
  measureAndShowLengthBetweenNodes,
  shortcutBuilder,
} from "./helpers";
import { getMeshItems } from "./mesh_items";
import { getMaybeMinCutItem } from "./min_cut_item";
import type { NodeContextMenuOptionsProps } from "./types";
import { hasEditableMapping } from "viewer/model/accessors/volumetracing_accessor";

export function getNodeContextMenuOptions({
  skeletonTracing,
  clickedNodeId,
  contextInfo,
  visibleSegmentationLayer,
  voxelSize,
  useLegacyBindings,
  volumeTracing,
  infoRows,
  allowUpdate,
  currentMeshFile,
  isRotated,
}: NodeContextMenuOptionsProps): ItemType[] {
  const state = Store.getState();
  const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
  const isVolumeModificationAllowed = !hasEditableMapping(state) && !isRotated;

  if (skeletonTracing == null) {
    throw new Error(
      "NodeContextMenuOptions should not have been called without existing skeleton tracing.",
    );
  }

  const { userBoundingBoxes } = skeletonTracing;
  const { activeTreeId, activeNodeId } = skeletonTracing;
  const { node: clickedNode, tree: clickedTree } = getTreeAndNodeOrNull(
    skeletonTracing,
    clickedNodeId,
  );

  if (clickedTree == null || clickedNode == null) {
    return [{ key: "disabled-error", disabled: true, label: "Error: Could not find clicked node" }];
  }

  const areInSameTree = activeTreeId === clickedTree.treeId;
  const isBranchpoint = clickedTree.branchPoints.find((bp) => bp.nodeId === clickedNodeId) != null;
  const isTheSameNode = activeNodeId === clickedNodeId;
  let areNodesConnected = false;

  if (areInSameTree && !isTheSameNode && activeNodeId != null) {
    const activeTreeEdges = clickedTree.edges.getEdgesForNode(activeNodeId);
    areNodesConnected = activeTreeEdges.some(
      (edge) => edge.source === clickedNodeId || edge.target === clickedNodeId,
    );
  }

  const meshItems = getMeshItems(
    volumeTracing,
    contextInfo,
    visibleSegmentationLayer,
    voxelSize.factor,
    currentMeshFile?.mappingName,
    isRotated,
  );

  const menuItems: ItemType[] = [
    {
      key: "set-node-active",
      disabled: isTheSameNode,
      onClick: () => Store.dispatch(setActiveNodeAction(clickedNodeId)),
      label: "Select this Node",
    },
    {
      key: "focus-tree",
      onClick: () => {
        Store.dispatch(setActiveNodeAction(clickedNodeId));
        Store.dispatch(expandParentGroupsOfTreeAction(clickedTree));
        Store.dispatch(focusTreeAction(clickedTree));
        layoutEmitter.emit(LayoutEvents.showSkeletonTab);
      },
      label: "Activate & Focus Tree in Skeleton Tab",
    },
    getMaybeMinCutItem(clickedTree, volumeTracing, userBoundingBoxes, isVolumeModificationAllowed),
    ...(allowUpdate
      ? [
          {
            key: "merge-trees",
            disabled: areInSameTree,
            onClick: () =>
              activeNodeId != null
                ? Store.dispatch(mergeTreesAction(activeNodeId, clickedNodeId))
                : null,
            label: (
              <>
                Create Edge & Merge with this Tree{" "}
                {useLegacyBindings ? shortcutBuilder(["Shift", AltOrOptionKey, "leftMouse"]) : null}
              </>
            ),
          },
          isProofreadingActive
            ? {
                key: "min-cut-node",
                disabled: !areInSameTree || isTheSameNode,
                onClick: () =>
                  activeNodeId != null
                    ? Store.dispatch(minCutAgglomerateAction(clickedNodeId, activeNodeId))
                    : null,
                label: "Perform Min-Cut between these Nodes",
              }
            : null,

          isProofreadingActive
            ? {
                key: "cut-agglomerate-from-neighbors",
                disabled: !isProofreadingActive,
                onClick: () =>
                  Store.dispatch(
                    cutAgglomerateFromNeighborsAction(
                      clickedNode.untransformedPosition,
                      clickedTree,
                    ),
                  ),
                label: (
                  <FastTooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot cut because the proofreading tool is not active."
                    }
                  >
                    Split from all neighboring segments
                  </FastTooltip>
                ),
              }
            : null,

          {
            key: "delete-edge",
            disabled: !areNodesConnected,
            onClick: () =>
              activeNodeId != null
                ? Store.dispatch(deleteEdgeAction(activeNodeId, clickedNodeId))
                : null,
            label: (
              <>
                Delete Edge to this Node{" "}
                {useLegacyBindings ? shortcutBuilder(["Shift", CtrlOrCmdKey, "leftMouse"]) : null}
              </>
            ),
          },
          {
            key: "delete-node",
            onClick: () => Actions.deleteNode(Store.dispatch, clickedNodeId, clickedTree.treeId),
            label: (
              <>
                Delete this Node {activeNodeId === clickedNodeId ? shortcutBuilder(["Del"]) : null}
              </>
            ),
          },
          isBranchpoint
            ? {
                key: "branchpoint-node",
                className: "node-context-menu-item",
                onClick: () =>
                  activeNodeId != null
                    ? Store.dispatch(deleteBranchpointByIdAction(clickedNodeId, clickedTree.treeId))
                    : null,
                label: "Unmark as Branchpoint",
              }
            : {
                key: "branchpoint-node",
                className: "node-context-menu-item",
                onClick: () =>
                  activeNodeId != null
                    ? Store.dispatch(createBranchPointAction(clickedNodeId, clickedTree.treeId))
                    : null,
                label: (
                  <>
                    Mark as Branchpoint{" "}
                    {activeNodeId === clickedNodeId ? shortcutBuilder(["B"]) : null}
                  </>
                ),
              },
          isTheSameNode
            ? null
            : {
                key: "extract-shortest-path",
                disabled: activeNodeId == null || !areInSameTree || isTheSameNode,
                onClick: () =>
                  activeNodeId != null
                    ? extractShortestPathAsNewTree(clickedTree, activeNodeId, clickedNodeId)
                    : null,
                label: "Extract shortest Path to this Node",
              },
        ]
      : []),
    ...meshItems,
    isTheSameNode
      ? null
      : {
          key: "measure-node-path-length",
          disabled: activeNodeId == null || !areInSameTree || isTheSameNode,
          onClick: () =>
            activeNodeId != null
              ? measureAndShowLengthBetweenNodes(activeNodeId, clickedNodeId, voxelSize.unit)
              : null,
          label: "Path Length to this Node",
        },
    {
      key: "measure-whole-tree-length",
      onClick: () =>
        measureAndShowFullTreeLength(clickedTree.treeId, clickedTree.name, voxelSize.unit),
      label: "Path Length of this Tree",
    },
    allowUpdate
      ? {
          key: "hide-tree",
          onClick: () => Store.dispatch(setTreeVisibilityAction(clickedTree.treeId, false)),
          label: "Hide this Tree",
        }
      : null,
    ...infoRows,
  ];

  return menuItems;
}
