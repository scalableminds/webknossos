import type { ItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
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
import type { ContextMenuInfo } from "viewer/store";
import { LayoutEvents, layoutEmitter } from "../layouting/layout_persistence";
import {
  extractShortestPathAsNewTree,
  measureAndShowFullTreeLength,
  measureAndShowLengthBetweenNodes,
  shortcutBuilder,
} from "./helpers";
import { useMeshItems } from "./mesh_items";
import { useMaybeMinCutItem } from "./min_cut_item";
import { useContextMenuActions } from "./use_context_menu_actions";

export function useNodeContextMenuOptions(
  contextInfo: ContextMenuInfo,
  infoRows: ItemType[],
): ItemType[] {
  const { clickedNodeId } = contextInfo;

  const skeletonTracing = useWkSelector((state) => state.annotation.skeleton);
  const voxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
  const useLegacyBindings = useWkSelector((state) => state.userConfiguration.useLegacyBindings);
  const allowUpdate = useWkSelector((state) => state.annotation.isUpdatingCurrentlyAllowed);
  const isProofreadingActive = useWkSelector(
    (state) => state.uiInformation.activeTool === AnnotationTool.PROOFREAD,
  );

  const dispatch = useDispatch();
  const actions = useContextMenuActions();

  const { node: clickedNode, tree: clickedTree } =
    skeletonTracing && clickedNodeId != null
      ? getTreeAndNodeOrNull(skeletonTracing, clickedNodeId)
      : { node: null, tree: null };

  const minCutItem = useMaybeMinCutItem(clickedTree);
  const meshItems = useMeshItems(contextInfo);

  if (skeletonTracing == null) {
    return [];
  }

  if (clickedTree == null || clickedNode == null || clickedNodeId == null) {
    return [{ key: "disabled-error", disabled: true, label: "Error: Could not find clicked node" }];
  }

  const { activeTreeId, activeNodeId } = skeletonTracing;

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

  const menuItems: ItemType[] = [
    {
      key: "set-node-active",
      disabled: isTheSameNode,
      onClick: () => dispatch(setActiveNodeAction(clickedNodeId)),
      label: "Select this Node",
    },
    {
      key: "focus-tree",
      onClick: () => {
        dispatch(setActiveNodeAction(clickedNodeId));
        dispatch(expandParentGroupsOfTreeAction(clickedTree));
        dispatch(focusTreeAction(clickedTree));
        layoutEmitter.emit(LayoutEvents.showSkeletonTab);
      },
      label: "Activate & Focus Tree in Skeleton Tab",
    },
    ...(minCutItem ? [minCutItem] : []),
    ...(allowUpdate
      ? [
          {
            key: "merge-trees",
            disabled: areInSameTree,
            onClick: () =>
              activeNodeId != null ? dispatch(mergeTreesAction(activeNodeId, clickedNodeId)) : null,
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
                    ? dispatch(minCutAgglomerateAction(clickedNodeId, activeNodeId))
                    : null,
                label: "Perform Min-Cut between these Nodes",
              }
            : null,

          isProofreadingActive
            ? {
                key: "cut-agglomerate-from-neighbors",
                disabled: !isProofreadingActive,
                onClick: () =>
                  dispatch(
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
              activeNodeId != null ? dispatch(deleteEdgeAction(activeNodeId, clickedNodeId)) : null,
            label: (
              <>
                Delete Edge to this Node{" "}
                {useLegacyBindings ? shortcutBuilder(["Shift", CtrlOrCmdKey, "leftMouse"]) : null}
              </>
            ),
          },
          {
            key: "delete-node",
            onClick: () => actions.deleteNode(clickedNodeId, clickedTree.treeId),
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
                    ? dispatch(deleteBranchpointByIdAction(clickedNodeId, clickedTree.treeId))
                    : null,
                label: "Unmark as Branchpoint",
              }
            : {
                key: "branchpoint-node",
                className: "node-context-menu-item",
                onClick: () =>
                  activeNodeId != null
                    ? dispatch(createBranchPointAction(clickedNodeId, clickedTree.treeId))
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
          onClick: () => dispatch(setTreeVisibilityAction(clickedTree.treeId, false)),
          label: "Hide this Tree",
        }
      : null,
    ...infoRows,
  ];

  return menuItems;
}
