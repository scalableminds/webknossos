import { CopyOutlined, PushpinOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { getSegmentBoundingBoxes, getSegmentVolumes } from "admin/rest_api";
import {
  ConfigProvider,
  Dropdown,
  Empty,
  Input,
  type MenuProps,
  Modal,
  Popover,
  notification,
} from "antd";
import type {
  ItemType,
  MenuItemGroupType,
  MenuItemType,
  SubMenuType,
} from "antd/es/menu/interface";
import { AsyncIconButton } from "components/async_clickables";
import FastTooltip from "components/fast_tooltip";
import { formatLengthAsVx, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useFetch } from "libs/react_helpers";
import Shortcut from "libs/shortcut_component";
import Toast from "libs/toast";
import { hexToRgb, rgbToHex, roundTo, truncateStringToLength } from "libs/utils";
import messages from "messages";

import { useWkSelector } from "libs/react_hooks";
import {
  AltOrOptionKey,
  CtrlOrCmdKey,
  LongUnitToShortUnitMap,
  type OrthoView,
  type UnitLong,
  type Vector3,
} from "oxalis/constants";
import {
  loadAgglomerateSkeletonAtPosition,
  loadSynapsesOfAgglomerateAtPosition,
} from "oxalis/controller/combinations/segmentation_handlers";
import { handleCreateNodeFromGlobalPosition } from "oxalis/controller/combinations/skeleton_handlers";
import {
  getSegmentIdForPosition,
  getSegmentIdForPositionAsync,
  handleFloodFillFromGlobalPosition,
} from "oxalis/controller/combinations/volume_handlers";
import {
  getMagInfo,
  getMappingInfo,
  getMaybeSegmentIndexAvailability,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { getDisabledInfoForTools } from "oxalis/model/accessors/disabled_tool_accessor";
import {
  areGeometriesTransformed,
  getActiveNode,
  getNodePosition,
  getTreeAndNode,
  getTreeAndNodeOrNull,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { AnnotationTool, VolumeTools } from "oxalis/model/accessors/tool_accessor";
import { maybeGetSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  getActiveCellId,
  getActiveSegmentationTracing,
  getSegmentsForLayer,
  hasAgglomerateMapping,
  hasConnectomeFile,
  hasEditableMapping,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
  maybeFetchMeshFilesAction,
  refreshMeshAction,
  removeMeshAction,
  updateMeshVisibilityAction,
} from "oxalis/model/actions/annotation_actions";
import {
  ensureLayerMappingsAreLoadedAction,
  ensureSegmentIndexIsLoadedAction,
} from "oxalis/model/actions/dataset_actions";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import {
  cutAgglomerateFromNeighborsAction,
  minCutAgglomerateAction,
  minCutAgglomerateWithPositionAction,
  proofreadMerge,
} from "oxalis/model/actions/proofread_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import {
  addTreesAndGroupsAction,
  createBranchPointAction,
  createTreeAction,
  deleteBranchpointByIdAction,
  deleteEdgeAction,
  deleteNodeAsUserAction,
  mergeTreesAction,
  setActiveNodeAction,
  setTreeVisibilityAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { hideContextMenuAction, setActiveUserBoundingBoxId } from "oxalis/model/actions/ui_actions";
import {
  clickSegmentAction,
  performMinCutAction,
  setActiveCellAction,
} from "oxalis/model/actions/volumetracing_actions";
import { extractPathAsNewTree } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { isBoundingBoxUsableForMinCut } from "oxalis/model/sagas/min_cut_saga";
import { getBoundingBoxInMag1 } from "oxalis/model/sagas/volume/helpers";
import { voxelToVolumeInUnit } from "oxalis/model/scaleinfo";
import { api } from "oxalis/singletons";
import type {
  ActiveMappingInfo,
  MutableNode,
  SegmentMap,
  SkeletonTracing,
  Tree,
  UserBoundingBox,
  VolumeTracing,
} from "oxalis/store";
import Store from "oxalis/store";
import {
  getVolumeRequestUrl,
  withMappingActivationConfirmation,
} from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import React, { createContext, type MouseEvent, useContext, useEffect, useState } from "react";
import type { Dispatch } from "redux";
import type {
  APIConnectomeFile,
  APIDataLayer,
  APIDataset,
  APIMeshFile,
  VoxelSize,
} from "types/api_types";
import type { AdditionalCoordinate } from "types/api_types";
import { LoadMeshMenuItemLabel } from "./right-border-tabs/segments_tab/load_mesh_menu_item_label";

type ContextMenuContextValue = React.MutableRefObject<HTMLElement | null> | null;
export const ContextMenuContext = createContext<ContextMenuContextValue>(null);

// The newest eslint version thinks the props listed below aren't used.
type OwnProps = {
  contextMenuPosition: Readonly<[number, number]> | null | undefined;
  maybeClickedNodeId: number | null | undefined;
  maybeClickedMeshId: number | null | undefined;
  maybeUnmappedSegmentId: number | null | undefined;
  maybeMeshIntersectionPosition: Vector3 | null | undefined;
  clickedBoundingBoxId: number | null | undefined;
  globalPosition: Vector3 | null | undefined;
  additionalCoordinates: AdditionalCoordinate[] | undefined;
  maybeViewport: OrthoView | null | undefined;
};

type StateProps = {
  skeletonTracing: SkeletonTracing | null | undefined;
  voxelSize: VoxelSize;
  visibleSegmentationLayer: APIDataLayer | null | undefined;
  dataset: APIDataset;
  currentMeshFile: APIMeshFile | null | undefined;
  currentConnectomeFile: APIConnectomeFile | null | undefined;
  volumeTracing: VolumeTracing | null | undefined;
  activeTool: AnnotationTool;
  useLegacyBindings: boolean;
  userBoundingBoxes: Array<UserBoundingBox>;
  mappingInfo: ActiveMappingInfo;
  allowUpdate: boolean;
  segments: SegmentMap | null | undefined;
};
type Props = OwnProps & StateProps;

type NodeContextMenuOptionsProps = Props & {
  viewport: OrthoView;
  clickedNodeId: number;
  infoRows: ItemType[];
};

type NoNodeContextMenuProps = Props & {
  viewport: OrthoView;
  segmentIdAtPosition: number;
  activeTool: AnnotationTool;
  infoRows: ItemType[];
};

const hideContextMenu = () => Store.dispatch(hideContextMenuAction());

export const getNoActionsAvailableMenu = (hideContextMenu: () => void): MenuProps => ({
  onClick: hideContextMenu,
  style: {
    borderRadius: 6,
  },
  mode: "vertical",
  items: [
    {
      key: "view",
      disabled: true,
      label: "No actions available.",
    },
  ],
});

function copyIconWithTooltip(value: string | number, title: string) {
  return (
    <FastTooltip title={title}>
      <CopyOutlined
        style={{
          margin: "0 0 0 5px",
        }}
        onClick={async () => {
          await navigator.clipboard.writeText(value.toString());
          Toast.success(`"${value}" copied to clipboard`);
        }}
      />
    </FastTooltip>
  );
}

function measureAndShowLengthBetweenNodes(
  sourceNodeId: number,
  targetNodeId: number,
  voxelSizeUnit: UnitLong,
) {
  const [lengthInUnit, lengthInVx] = api.tracing.measurePathLengthBetweenNodes(
    sourceNodeId,
    targetNodeId,
  );
  notification.open({
    message: `The shortest path length between the nodes is ${formatNumberToLength(
      lengthInUnit,
      LongUnitToShortUnitMap[voxelSizeUnit],
    )} (${formatLengthAsVx(lengthInVx)}).`,
    icon: <i className="fas fa-ruler" />,
  });
}

function extractShortestPathAsNewTree(
  sourceTree: Tree,
  sourceNodeId: number,
  targetNodeId: number,
) {
  const { shortestPath } = api.tracing.findShortestPathBetweenNodes(sourceNodeId, targetNodeId);
  const newTree = extractPathAsNewTree(Store.getState(), sourceTree, shortestPath);
  if (newTree != null) {
    const treeMap = { [newTree.treeId]: newTree };
    Store.dispatch(addTreesAndGroupsAction(treeMap, null));
  }
}

function measureAndShowFullTreeLength(treeId: number, treeName: string, voxelSizeUnit: UnitLong) {
  const [lengthInUnit, lengthInVx] = api.tracing.measureTreeLength(treeId);
  notification.open({
    message: messages["tracing.tree_length_notification"](
      treeName,
      formatNumberToLength(lengthInUnit, LongUnitToShortUnitMap[voxelSizeUnit]),
      formatLengthAsVx(lengthInVx),
    ),
    icon: <i className="fas fa-ruler" />,
  });
}

function positionToString(
  pos: Vector3,
  optAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
): string {
  const additionalCoordinates = (optAdditionalCoordinates || []).map((coord) => coord.value);
  return [...pos, ...additionalCoordinates].map((value) => roundTo(value, 2)).join(", ");
}

function shortcutBuilder(shortcuts: Array<string>): React.ReactNode {
  const lineColor = "var(--ant-color-text-secondary)";
  const mouseIconStyle = { margin: 0, marginLeft: -2, height: 18 };

  const mapNameToShortcutIcon = (name: string) => {
    switch (name) {
      case "leftMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-left.svg"
            alt="Mouse Left Click"
            style={mouseIconStyle}
          />
        );
      }

      case "rightMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-right.svg"
            alt="Mouse Right Click"
            style={mouseIconStyle}
          />
        );
      }

      case "middleMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-wheel.svg"
            alt="Mouse Wheel"
            style={mouseIconStyle}
          />
        );
      }

      default: {
        return (
          <span
            className="keyboard-key-icon-small"
            style={{
              borderColor: lineColor,
            }}
          >
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span
              style={{
                position: "relative",
                top: -9,
              }}
            >
              {name}
            </span>
          </span>
        );
      }
    }
  };

  return (
    <span
      style={{
        float: "right",
        color: lineColor,
        marginLeft: 10,
      }}
    >
      {shortcuts.map((name, index) => (
        <React.Fragment key={name}>
          {mapNameToShortcutIcon(name)}
          {index < shortcuts.length - 1 ? " + " : null}
        </React.Fragment>
      ))}
    </span>
  );
}

function getMaybeMinCutItem(
  clickedTree: Tree,
  volumeTracing: VolumeTracing | null | undefined,
  userBoundingBoxes: Array<UserBoundingBox>,
  isVolumeModificationAllowed: boolean,
): SubMenuType | null {
  const seeds = Array.from(clickedTree.nodes.values());

  if (volumeTracing == null || !isVolumeModificationAllowed || seeds.length !== 2) {
    return null;
  }

  return {
    key: "min-cut",
    label: "Perform Min-Cut (Experimental)",
    // For some reason, antd doesn't pass the ant-dropdown class to the
    // sub menu itself which makes the label of the item group too big.
    // Passing the CSS class here fixes it (font-size is 14px instead of
    // 16px then).
    popupClassName: "ant-dropdown",
    children: [
      {
        key: "choose-bbox-group",
        label: "Choose a bounding box for the min-cut operation:",
        type: "group", // double check if the group is assigned to right item
        children: [
          {
            key: "create-new",
            onClick: () => Store.dispatch(performMinCutAction(clickedTree.treeId)),
            label: "Use default bounding box",
          },
          ...userBoundingBoxes
            .filter((bbox) => isBoundingBoxUsableForMinCut(bbox.boundingBox, seeds))
            .map((bbox) => {
              return {
                key: bbox.id.toString(),
                onClick: () => Store.dispatch(performMinCutAction(clickedTree.treeId, bbox.id)),
                label: bbox.name || "Unnamed bounding box",
              };
            }),
        ],
      },
    ],
  };
}

function getMeshItems(
  volumeTracing: VolumeTracing | null | undefined,
  clickedMeshId: number | null | undefined,
  meshIntersectionPosition: Vector3 | null | undefined,
  maybeUnmappedSegmentId: number | null | undefined,
  visibleSegmentationLayer: APIDataLayer | null | undefined,
  voxelSizeFactor: Vector3,
  meshFileMappingName: string | null | undefined,
): MenuItemType[] {
  if (
    clickedMeshId == null ||
    meshIntersectionPosition == null ||
    visibleSegmentationLayer == null ||
    volumeTracing == null
  ) {
    return [];
  }
  const state = Store.getState();
  const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
  const activeCellId = getActiveCellId(volumeTracing);
  const { activeUnmappedSegmentId } = volumeTracing;
  const segments = getSegmentsForLayer(state, volumeTracing.tracingId);
  // The cut and merge operations depend on the active segment. The volume tracing *always* has an activeCellId.
  // However, the ID be 0 or it could be an unused ID (this is the default when creating a new
  // volume tracing). Therefore, merging/splitting with that ID won't work. We can avoid this
  // by looking the segment id up the segments list and checking against null.
  const activeSegmentMissing = segments.getNullable(activeCellId) == null;

  const getTooltip = (actionVerb: "merge" | "split", actionNeedsActiveSegment: boolean) => {
    return !isProofreadingActive
      ? `Cannot ${actionVerb} because the proofreading tool is not active.`
      : maybeUnmappedSegmentId == null
        ? "The mesh wasn't loaded in proofreading mode. Please reload the mesh."
        : meshFileMappingName != null
          ? "This mesh was created for a mapping. Please use a meshfile that is based on unmapped oversegmentation data."
          : actionNeedsActiveSegment && activeSegmentMissing
            ? "Select a segment first."
            : null;
  };

  const shouldAgglomerateSkeletonActionsBeDisabled =
    !isProofreadingActive ||
    activeSegmentMissing ||
    maybeUnmappedSegmentId == null ||
    meshFileMappingName != null;

  const maybeProofreadingItems: MenuItemType[] = isProofreadingActive
    ? [
        {
          key: "merge-agglomerate-skeleton",
          disabled: shouldAgglomerateSkeletonActionsBeDisabled || clickedMeshId === activeCellId,
          onClick: () => {
            if (maybeUnmappedSegmentId == null) {
              // Should not happen due to the disabled property.
              return;
            }
            return Store.dispatch(proofreadMerge(null, maybeUnmappedSegmentId, clickedMeshId));
          },
          label: (
            <FastTooltip title={getTooltip("merge", true)}>Merge with active segment</FastTooltip>
          ),
        },
        {
          key: "min-cut-agglomerate-at-position",
          disabled:
            shouldAgglomerateSkeletonActionsBeDisabled ||
            clickedMeshId !== activeCellId ||
            activeUnmappedSegmentId == null ||
            maybeUnmappedSegmentId === activeUnmappedSegmentId,
          onClick: () => {
            if (maybeUnmappedSegmentId == null) {
              // Should not happen due to the disabled property.
              return;
            }
            Store.dispatch(
              minCutAgglomerateWithPositionAction(null, maybeUnmappedSegmentId, clickedMeshId),
            );
          },
          label: (
            <FastTooltip title={getTooltip("split", true)}>Split from active segment</FastTooltip>
          ),
        },
        {
          key: "split-from-all-neighbors",
          disabled: maybeUnmappedSegmentId == null || meshFileMappingName != null,
          onClick: () => {
            if (maybeUnmappedSegmentId == null) {
              // Should not happen due to the disabled property.
              return;
            }
            Store.dispatch(
              cutAgglomerateFromNeighborsAction(null, null, maybeUnmappedSegmentId, clickedMeshId),
            );
          },
          label: (
            <FastTooltip title={getTooltip("split", false)}>
              Split from all neighboring segments
            </FastTooltip>
          ),
        },
      ]
    : [];

  const segmentIdLabel =
    isProofreadingActive && maybeUnmappedSegmentId != null
      ? `within Segment ${clickedMeshId}`
      : clickedMeshId;
  const segmentOrSuperVoxel =
    isProofreadingActive && maybeUnmappedSegmentId != null ? "Super-Voxel" : "Segment";
  const isAlreadySelected =
    activeUnmappedSegmentId === maybeUnmappedSegmentId && activeCellId === clickedMeshId;
  return [
    isProofreadingActive && activeUnmappedSegmentId != null && isAlreadySelected
      ? {
          // If a supervoxel is selected (and thus highlighted), allow to select it.
          key: "deactivate-segment",
          onClick: () =>
            Store.dispatch(setActiveCellAction(clickedMeshId, undefined, undefined, undefined)),
          label: `Deselect ${segmentOrSuperVoxel} (${segmentIdLabel})`,
        }
      : {
          key: "activate-segment",
          onClick: () =>
            Store.dispatch(
              setActiveCellAction(clickedMeshId, undefined, undefined, maybeUnmappedSegmentId),
            ),
          disabled: isAlreadySelected,
          label: `Select ${segmentOrSuperVoxel} (${segmentIdLabel})`,
        },
    {
      key: "hide-mesh",
      onClick: () => Actions.hideMesh(Store.dispatch, visibleSegmentationLayer.name, clickedMeshId),
      label: "Hide Mesh",
    },
    {
      key: "reload-mesh",
      onClick: () =>
        Actions.refreshMesh(Store.dispatch, visibleSegmentationLayer.name, clickedMeshId),
      label: "Reload Mesh",
    },
    {
      key: "jump-to-mesh",
      onClick: () => {
        const unscaledPosition = V3.divide3(meshIntersectionPosition, voxelSizeFactor);
        Actions.setPosition(Store.dispatch, unscaledPosition);
      },
      label: "Jump to Position",
    },
    {
      key: "remove-mesh",
      onClick: () =>
        Actions.removeMesh(Store.dispatch, visibleSegmentationLayer.name, clickedMeshId),
      label: "Remove Mesh",
    },
    ...maybeProofreadingItems,
  ];
}

function getNodeContextMenuOptions({
  skeletonTracing,
  clickedNodeId,
  maybeClickedMeshId,
  maybeMeshIntersectionPosition,
  maybeUnmappedSegmentId,
  visibleSegmentationLayer,
  voxelSize,
  useLegacyBindings,
  volumeTracing,
  infoRows,
  allowUpdate,
  currentMeshFile,
}: NodeContextMenuOptionsProps): ItemType[] {
  const state = Store.getState();
  const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
  const isVolumeModificationAllowed = !hasEditableMapping(state);

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
    maybeClickedMeshId,
    maybeMeshIntersectionPosition,
    maybeUnmappedSegmentId,
    visibleSegmentationLayer,
    voxelSize.factor,
    currentMeshFile?.mappingName,
  );

  const menuItems: ItemType[] = [
    {
      key: "set-node-active",
      disabled: isTheSameNode,
      onClick: () => Store.dispatch(setActiveNodeAction(clickedNodeId)),
      label: "Select this Node",
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

function getBoundingBoxMenuOptions({
  globalPosition,
  activeTool,
  clickedBoundingBoxId,
  userBoundingBoxes,
  allowUpdate,
}: NoNodeContextMenuProps): ItemType[] {
  if (globalPosition == null) return [];

  const isBoundingBoxToolActive = activeTool === AnnotationTool.BOUNDING_BOX;
  const newBoundingBoxMenuItem: ItemType = {
    key: "add-new-bounding-box",
    onClick: () => {
      Store.dispatch(addUserBoundingBoxAction(null, globalPosition));
    },
    label: (
      <>
        Create new Bounding Box
        {isBoundingBoxToolActive ? shortcutBuilder(["C"]) : null}
      </>
    ),
  };

  if (!allowUpdate && clickedBoundingBoxId != null) {
    const hideBoundingBoxMenuItem: MenuItemType = {
      key: "hide-bounding-box",
      onClick: () => {
        Actions.hideBoundingBox(Store.dispatch, clickedBoundingBoxId);
      },
      label: "Hide Bounding Box",
    };
    return [hideBoundingBoxMenuItem];
  }

  if (!allowUpdate) {
    return [];
  }

  if (clickedBoundingBoxId == null) {
    return [newBoundingBoxMenuItem];
  }

  const hoveredBBox = userBoundingBoxes.find((bbox) => bbox.id === clickedBoundingBoxId);

  if (hoveredBBox == null) {
    return [newBoundingBoxMenuItem];
  }

  const setBBoxName = (evt: React.SyntheticEvent) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const value = evt.target.value;
    Actions.setBoundingBoxName(Store.dispatch, clickedBoundingBoxId, value);
  };

  const preventContextMenuFromClosing = (evt: MouseEvent) => {
    evt.stopPropagation();
  };

  const upscaledBBoxColor = hoveredBBox.color.map((colorPart) => colorPart * 255) as any as Vector3;

  return [
    newBoundingBoxMenuItem,
    {
      key: "focus-in-bbox-tab",
      label: "Focus in Bounding Box Tab",
      onClick: () => Store.dispatch(setActiveUserBoundingBoxId(hoveredBBox.id)),
    },
    {
      key: "change-bounding-box-name",
      label: (
        <Popover
          title="Set Bounding Box Name"
          content={
            <Input
              defaultValue={hoveredBBox.name}
              placeholder="Bounding Box Name"
              size="small"
              onPressEnter={(evt) => {
                setBBoxName(evt);
                hideContextMenu();
              }}
              onBlur={setBBoxName}
              onClick={preventContextMenuFromClosing}
            />
          }
          trigger="click"
        >
          <span
            onClick={preventContextMenuFromClosing}
            style={{
              width: "100%",
              display: "inline-block",
            }}
          >
            Change Bounding Box Name
          </span>
        </Popover>
      ),
    },
    {
      key: "change-bounding-box-color",
      label: (
        <span
          onClick={preventContextMenuFromClosing}
          style={{
            width: "100%",
            display: "inline-block",
            position: "relative",
          }}
        >
          Change Bounding Box Color
          <input
            type="color"
            style={{
              display: "inline-block",
              border: "none",
              cursor: "pointer",
              width: "100%",
              height: "100%",
              position: "absolute",
              left: 0,
              top: 0,
              opacity: 0,
            }}
            onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
              let color = hexToRgb(evt.target.value);
              color = color.map((colorPart) => colorPart / 255) as any as Vector3;
              Actions.setBoundingBoxColor(Store.dispatch, clickedBoundingBoxId, color);
            }}
            value={rgbToHex(upscaledBBoxColor)}
          />
        </span>
      ),
    },
    {
      key: "hide-bounding-box",
      onClick: () => {
        Actions.hideBoundingBox(Store.dispatch, clickedBoundingBoxId);
      },
      label: "Hide Bounding Box",
    },
    {
      key: "delete-bounding-box",
      onClick: () => {
        Actions.deleteBoundingBox(Store.dispatch, clickedBoundingBoxId);
      },
      label: "Delete Bounding Box",
    },
  ];
}

function getNoNodeContextMenuOptions(props: NoNodeContextMenuProps): ItemType[] {
  const {
    skeletonTracing,
    volumeTracing,
    activeTool,
    globalPosition,
    additionalCoordinates,
    maybeClickedMeshId,
    maybeMeshIntersectionPosition,
    maybeUnmappedSegmentId,
    viewport,
    visibleSegmentationLayer,
    segmentIdAtPosition,
    dataset,
    voxelSize,
    currentMeshFile,
    currentConnectomeFile,
    mappingInfo,
    infoRows,
    allowUpdate,
  } = props;

  const state = Store.getState();
  const disabledVolumeInfo = getDisabledInfoForTools(state);
  const isAgglomerateMappingEnabled = hasAgglomerateMapping(state);
  const isConnectomeMappingEnabled = hasConnectomeFile(state);

  const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;

  Store.dispatch(maybeFetchMeshFilesAction(visibleSegmentationLayer, dataset, false));

  const loadPrecomputedMesh = async () => {
    if (!currentMeshFile || !visibleSegmentationLayer || globalPosition == null) return;
    // Ensure that the segment ID is loaded, since a mapping might have been activated
    // shortly before
    const segmentId = await getSegmentIdForPositionAsync(globalPosition);

    if (segmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }

    Store.dispatch(
      loadPrecomputedMeshAction(
        segmentId,
        globalPosition,
        additionalCoordinates,
        currentMeshFile.meshFileName,
        undefined,
      ),
    );
  };

  const maybeFocusSegment = () => {
    if (!visibleSegmentationLayer || globalPosition == null) {
      return;
    }
    const clickedSegmentId = getSegmentIdForPosition(globalPosition);
    const layerName = visibleSegmentationLayer.name;
    if (clickedSegmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }
    const additionalCoordinates = state.flycam.additionalCoordinates;
    // This action is dispatched because the behaviour is identical to a click on a segment.
    // Note that the updated position is where the segment was clicked to open the context menu.
    Store.dispatch(
      clickSegmentAction(clickedSegmentId, globalPosition, additionalCoordinates, layerName),
    );
  };

  const computeMeshAdHoc = () => {
    if (!visibleSegmentationLayer || globalPosition == null) {
      return;
    }

    const segmentId = getSegmentIdForPosition(globalPosition);

    if (segmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }

    Store.dispatch(loadAdHocMeshAction(segmentId, globalPosition, additionalCoordinates));
  };

  const showAutomatedSegmentationServicesModal = (errorMessage: string, entity: string) =>
    Modal.info({
      title: "Get More out of WEBKNOSSOS",
      content: (
        <>
          {errorMessage} {entity} are created as part of our automated segmentation services.{" "}
          <a
            target="_blank"
            href="https://webknossos.org/services/automated-segmentation"
            rel="noreferrer noopener"
          >
            Learn more.
          </a>
        </>
      ),
      onOk() {},
    });

  const isVolumeBasedToolActive = VolumeTools.includes(activeTool);
  const isBoundingBoxToolActive = activeTool === AnnotationTool.BOUNDING_BOX;
  const skeletonActions: ItemType[] =
    skeletonTracing != null && globalPosition != null && allowUpdate
      ? [
          {
            key: "create-node",
            onClick: () => handleCreateNodeFromGlobalPosition(globalPosition, viewport, false),
            label: "Create Node here",
            disabled: areGeometriesTransformed(state),
          },
          {
            key: "create-node-with-tree",
            onClick: () => {
              Store.dispatch(createTreeAction());
              handleCreateNodeFromGlobalPosition(globalPosition, viewport, false);
            },
            label: (
              <>
                Create new Tree here{" "}
                {!isVolumeBasedToolActive && !isBoundingBoxToolActive
                  ? shortcutBuilder(["C"])
                  : null}
              </>
            ),
            disabled: areGeometriesTransformed(state),
          },
          {
            key: "load-agglomerate-skeleton",
            // Do not disable menu entry, but show modal advertising automated segmentation services if no agglomerate file is activated
            onClick: () =>
              isAgglomerateMappingEnabled.value
                ? loadAgglomerateSkeletonAtPosition(globalPosition)
                : showAutomatedSegmentationServicesModal(
                    isAgglomerateMappingEnabled.reason,
                    "Agglomerate files",
                  ),
            label: (
              <FastTooltip
                title={
                  isAgglomerateMappingEnabled.value ? undefined : isAgglomerateMappingEnabled.reason
                }
                onMouseEnter={() => {
                  Store.dispatch(ensureLayerMappingsAreLoadedAction());
                }}
              >
                <span>
                  Import Agglomerate Skeleton{" "}
                  {!isAgglomerateMappingEnabled.value ? (
                    <WarningOutlined style={{ color: "var(--ant-color-text-disabled)" }} />
                  ) : null}{" "}
                  {shortcutBuilder(["Shift", "middleMouse"])}
                </span>
              </FastTooltip>
            ),
          },
          isAgglomerateMappingEnabled.value
            ? {
                key: "merge-agglomerate-skeleton",
                disabled: !isProofreadingActive,
                onClick: () => Store.dispatch(proofreadMerge(globalPosition)),
                label: (
                  <FastTooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot merge because the proofreading tool is not active."
                    }
                  >
                    <span>Merge with active segment {shortcutBuilder(["Shift", "leftMouse"])}</span>
                  </FastTooltip>
                ),
              }
            : null,
          isAgglomerateMappingEnabled.value
            ? {
                key: "min-cut-agglomerate-at-position",
                disabled: !isProofreadingActive,
                onClick: () => Store.dispatch(minCutAgglomerateWithPositionAction(globalPosition)),
                label: (
                  <FastTooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot split because the proofreading tool is not active."
                    }
                  >
                    <span>
                      Split from active segment {shortcutBuilder([CtrlOrCmdKey, "leftMouse"])}
                    </span>
                  </FastTooltip>
                ),
              }
            : null,
          isAgglomerateMappingEnabled.value
            ? {
                key: "cut-agglomerate-from-neighbors",
                disabled: !isProofreadingActive,
                onClick: () => Store.dispatch(cutAgglomerateFromNeighborsAction(globalPosition)),
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
        ]
      : [];
  const segmentationLayerName =
    visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null;

  if (visibleSegmentationLayer != null && globalPosition != null) {
    const connectomeFileMappingName =
      currentConnectomeFile != null ? currentConnectomeFile.mappingName : undefined;
    const loadSynapsesItem: MenuItemType = {
      className: "node-context-menu-item",
      key: "load-synapses",
      // Do not disable menu entry, but show modal advertising automated segmentation services if no connectome file is activated
      onClick: isConnectomeMappingEnabled.value
        ? withMappingActivationConfirmation(
            () => loadSynapsesOfAgglomerateAtPosition(globalPosition),
            connectomeFileMappingName,
            "connectome file",
            segmentationLayerName,
            mappingInfo,
          )
        : () =>
            showAutomatedSegmentationServicesModal(
              isConnectomeMappingEnabled.reason,
              "Connectome files",
            ),
      label: isConnectomeMappingEnabled.value ? (
        "Import Synapses"
      ) : (
        <FastTooltip title={isConnectomeMappingEnabled.reason}>
          Import Synapses{" "}
          {!isConnectomeMappingEnabled.value ? (
            <WarningOutlined style={{ color: "var(--ant-color-text-disabled)" }} />
          ) : null}{" "}
        </FastTooltip>
      ),
    };
    // This action doesn't need a skeleton tracing but is conceptually related to the "Import Agglomerate Skeleton" action
    skeletonActions.push(loadSynapsesItem);
  }

  const meshFileMappingName = currentMeshFile != null ? currentMeshFile.mappingName : undefined;
  const focusInSegmentListItem: MenuItemType = {
    key: "focus-in-segment-list",
    onClick: maybeFocusSegment,
    label: "Focus in Segment List",
  };
  const loadPrecomputedMeshItem: MenuItemType = {
    key: "load-precomputed-mesh",
    disabled: !currentMeshFile,
    onClick: withMappingActivationConfirmation(
      loadPrecomputedMesh,
      meshFileMappingName,
      "mesh file",
      segmentationLayerName,
      mappingInfo,
    ),
    label: (
      <LoadMeshMenuItemLabel currentMeshFile={currentMeshFile} volumeTracing={volumeTracing} />
    ),
  };
  const computeMeshAdHocItem = {
    key: "compute-mesh-adhc",
    onClick: computeMeshAdHoc,
    label: "Compute Mesh (ad-hoc)",
  };
  const nonSkeletonActions: ItemType[] =
    globalPosition != null && visibleSegmentationLayer != null
      ? [
          // Segment 0 cannot/shouldn't be made active (as this
          // would be an eraser effectively).
          segmentIdAtPosition > 0 && !disabledVolumeInfo.PICK_CELL.isDisabled
            ? {
                key: "select-cell",
                onClick: () => {
                  Store.dispatch(
                    setActiveCellAction(segmentIdAtPosition, globalPosition, additionalCoordinates),
                  );
                },
                disabled:
                  volumeTracing == null || // satisfy TS
                  segmentIdAtPosition === getActiveCellId(volumeTracing),
                label: (
                  <>
                    Activate Segment ({segmentIdAtPosition}){" "}
                    {isVolumeBasedToolActive ? shortcutBuilder(["Shift", "leftMouse"]) : null}
                  </>
                ),
              }
            : null,
          focusInSegmentListItem,
          loadPrecomputedMeshItem,
          computeMeshAdHocItem,
          allowUpdate && !disabledVolumeInfo.FILL_CELL.isDisabled
            ? {
                key: "fill-cell",
                onClick: () => handleFloodFillFromGlobalPosition(globalPosition, viewport),
                label: "Fill Segment (flood-fill region)",
              }
            : null,
        ]
      : [];
  const boundingBoxActions = getBoundingBoxMenuOptions(props);

  const isSkeletonToolActive = activeTool === AnnotationTool.SKELETON;
  let allActions: ItemType[] = [];

  const meshRelatedItems = getMeshItems(
    volumeTracing,
    maybeClickedMeshId,
    maybeMeshIntersectionPosition,
    maybeUnmappedSegmentId,
    visibleSegmentationLayer,
    voxelSize.factor,
    currentMeshFile?.mappingName,
  );

  if (isSkeletonToolActive) {
    allActions = [...skeletonActions, ...nonSkeletonActions, ...boundingBoxActions];
  } else if (isBoundingBoxToolActive) {
    allActions = [...boundingBoxActions, ...nonSkeletonActions, ...skeletonActions];
  } else {
    allActions = [...nonSkeletonActions, ...skeletonActions, ...boundingBoxActions];
  }
  if (meshRelatedItems) {
    allActions = allActions.concat(meshRelatedItems);
  }

  const empty: ItemType = {
    key: "empty",
    label: <Empty description="No actions available" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
  };

  const menuItems =
    allActions.length + infoRows.length > 0 ? [...allActions, ...infoRows] : [empty];

  return menuItems;
}

export function GenericContextMenuContainer(props: {
  contextMenuPosition: Readonly<[number, number]> | null | undefined;
  hideContextMenu: () => void;
  children: React.ReactElement;
  positionAbsolute?: boolean;
  className?: string;
}) {
  /*
   * This container for the context menu is *always* rendered.
   * An input ref is stored for the actual container which is
   * passed to antd <Dropdown /> so that it renders the actual
   * menu into that container when desired.
   * When <Dropdown /> is not used to render the menu, antd assumes
   * that the <Menu /> is a navigational menu. Navigational menus
   * behave differently (predominantly, their styling uses way more
   * padding and entries are rendered as links). In earlier implementations
   * of the context menu, we simply overrode those styles. However, at the
   * latest when sub menus are used, the styling issues become too complicated
   * to deal with.
   */
  const inputRef: React.MutableRefObject<HTMLElement | null> = React.useRef(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Always focus newest input ref
  React.useEffect(() => {
    if (inputRef.current != null) {
      inputRef.current.focus();
    }
  }, [inputRef.current]);
  const { contextMenuPosition, hideContextMenu } = props;
  return (
    <React.Fragment>
      <div
        className={`node-context-menu-overlay ${props.className || ""}`}
        onClick={hideContextMenu}
        onContextMenu={(evt) => {
          evt.preventDefault();
          hideContextMenu();
        }}
        style={{
          display: contextMenuPosition == null ? "none" : "inherit",
        }}
      />
      {/*
         This div serves as a "prison" for the sticky context menu. The above div
         cannot be used since the context menu would then be closed on every click.
         Since both divs are absolutely positioned and cover the whole page,
         avoid blocking click events by temporarily disabling them for this "prison"
         div.
        */}
      <div
        className={`node-context-menu-overlay ${props.className || ""}`}
        style={{
          pointerEvents: "none",
          display: contextMenuPosition == null ? "none" : "inherit",
        }}
      >
        <div
          style={{
            position: props.positionAbsolute ? "absolute" : "sticky",
            left: contextMenuPosition != null ? contextMenuPosition[0] : 0,
            top: contextMenuPosition != null ? contextMenuPosition[1] : 0,
            width: "fit-content",
            height: "fit-content",
            pointerEvents: "all",
          }}
          className="node-context-menu"
          tabIndex={-1}
          // @ts-ignore
          ref={inputRef}
        />
        {/* Disable animations for the context menu (for performance reasons). */}
        <ConfigProvider theme={{ token: { motion: false } }}>
          <ContextMenuContext.Provider value={inputRef}>
            {props.children}
          </ContextMenuContext.Provider>
        </ConfigProvider>
      </div>
    </React.Fragment>
  );
}

function WkContextMenu() {
  const contextMenuPosition = useWkSelector((state) => {
    return state.uiInformation.contextInfo.contextMenuPosition;
  });

  return (
    <GenericContextMenuContainer
      hideContextMenu={hideContextMenu}
      contextMenuPosition={contextMenuPosition}
    >
      {contextMenuPosition != null ? <ContextMenuInner /> : <div />}
    </GenericContextMenuContainer>
  );
}

function getInfoMenuItem(
  key: MenuItemType["key"],
  label: MenuItemType["label"],
): MenuItemGroupType {
  /*
   * This component is a work-around. We want antd menu entries that can not be selected
   * or otherwise interacted with. An "empty" menu group will only display the group header
   * which gives us the desired behavior.
   */

  return { key, label, type: "group" };
}

function ContextMenuInner() {
  const props = useWkSelector((state) => {
    const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
    const mappingInfo = getMappingInfo(
      state.temporaryConfiguration.activeMappingByLayer,
      visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
    );
    const someTracing = maybeGetSomeTracing(state.annotation);
    const { contextInfo } = state.uiInformation;
    return {
      skeletonTracing: state.annotation.skeleton,
      volumeTracing: getActiveSegmentationTracing(state),
      voxelSize: state.dataset.dataSource.scale,
      activeTool: state.uiInformation.activeTool,
      dataset: state.dataset,
      allowUpdate: state.annotation.restrictions.allowUpdate,
      visibleSegmentationLayer,
      currentMeshFile:
        visibleSegmentationLayer != null
          ? state.localSegmentationData[visibleSegmentationLayer.name].currentMeshFile
          : null,
      currentConnectomeFile:
        visibleSegmentationLayer != null
          ? state.localSegmentationData[visibleSegmentationLayer.name].connectomeData
              .currentConnectomeFile
          : null,
      useLegacyBindings: state.userConfiguration.useLegacyBindings,
      userBoundingBoxes: someTracing != null ? someTracing.userBoundingBoxes : [],
      segments:
        visibleSegmentationLayer != null
          ? getSegmentsForLayer(state, visibleSegmentationLayer.name)
          : null,
      mappingInfo,
      maybeClickedNodeId: contextInfo.clickedNodeId,
      clickedBoundingBoxId: contextInfo.clickedBoundingBoxId,
      globalPosition: contextInfo.globalPosition,
      additionalCoordinates: state.flycam.additionalCoordinates || undefined,
      contextMenuPosition: contextInfo.contextMenuPosition,
      maybeViewport: contextInfo.viewport,
      maybeClickedMeshId: contextInfo.meshId,
      maybeMeshIntersectionPosition: contextInfo.meshIntersectionPosition,
      maybeUnmappedSegmentId: contextInfo.unmappedSegmentId,
    };
  });

  const [lastTimeSegmentInfoShouldBeFetched, setLastTimeSegmentInfoShouldBeFetched] = useState(
    new Date(),
  );
  const inputRef = useContext(ContextMenuContext);
  const {
    skeletonTracing,
    maybeClickedNodeId,
    maybeClickedMeshId,
    contextMenuPosition,
    segments,
    voxelSize,
    globalPosition,
    maybeViewport,
    visibleSegmentationLayer,
    volumeTracing,
  } = props;

  const segmentIdAtPosition = globalPosition != null ? getSegmentIdForPosition(globalPosition) : 0;

  // Currently either segmentIdAtPosition or maybeClickedMeshId is set, but not both.
  // segmentIdAtPosition is only set if a segment is hovered in one of the xy, xz, or yz viewports.
  // maybeClickedMeshId is only set, when a mesh is hovered in the 3d viewport.
  // Thus the segment id is always unambiguous / clearly defined.
  const clickedSegmentOrMeshId =
    maybeClickedMeshId != null ? maybeClickedMeshId : segmentIdAtPosition;
  const wasSegmentOrMeshClicked = clickedSegmentOrMeshId !== 0;

  const dataset = useWkSelector((state) => state.dataset);
  useEffect(() => {
    Store.dispatch(ensureSegmentIndexIsLoadedAction(visibleSegmentationLayer?.name));
  }, [visibleSegmentationLayer]);
  const isSegmentIndexAvailable = getMaybeSegmentIndexAvailability(
    dataset,
    visibleSegmentationLayer?.name,
  );
  const mappingName: string | null | undefined = useWkSelector((state) => {
    if (volumeTracing?.mappingName != null) return volumeTracing?.mappingName;
    const mappingInfo = getMappingInfo(
      state.temporaryConfiguration.activeMappingByLayer,
      visibleSegmentationLayer?.name,
    );
    return mappingInfo.mappingName;
  });
  const isLoadingMessage = "loading";
  const isLoadingVolumeAndBB = [isLoadingMessage, isLoadingMessage];
  const [segmentVolumeLabel, boundingBoxInfoLabel] = useFetch(
    async () => {
      const { annotation, flycam } = Store.getState();
      // The value that is returned if the context menu is closed is shown if it's still loading
      if (contextMenuPosition == null || !wasSegmentOrMeshClicked) return isLoadingVolumeAndBB;
      if (visibleSegmentationLayer == null || !isSegmentIndexAvailable) return [];
      const tracingId = volumeTracing?.tracingId;
      const additionalCoordinates = flycam.additionalCoordinates;
      const requestUrl = getVolumeRequestUrl(
        dataset,
        annotation,
        tracingId,
        visibleSegmentationLayer,
      );
      const magInfo = getMagInfo(visibleSegmentationLayer.resolutions);
      const layersFinestMag = magInfo.getFinestMag();
      const voxelSize = dataset.dataSource.scale;

      try {
        const [segmentSize] = await getSegmentVolumes(
          requestUrl,
          layersFinestMag,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
        );
        const [boundingBoxInRequestedMag] = await getSegmentBoundingBoxes(
          requestUrl,
          layersFinestMag,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
        );
        const boundingBoxInMag1 = getBoundingBoxInMag1(boundingBoxInRequestedMag, layersFinestMag);
        const boundingBoxTopLeftString = `(${boundingBoxInMag1.topLeft[0]}, ${boundingBoxInMag1.topLeft[1]}, ${boundingBoxInMag1.topLeft[2]})`;
        const boundingBoxSizeString = `(${boundingBoxInMag1.width}, ${boundingBoxInMag1.height}, ${boundingBoxInMag1.depth})`;
        const volumeInUnit3 = voxelToVolumeInUnit(voxelSize, layersFinestMag, segmentSize);
        return [
          formatNumberToVolume(volumeInUnit3, LongUnitToShortUnitMap[voxelSize.unit]),
          `${boundingBoxTopLeftString}, ${boundingBoxSizeString}`,
        ];
      } catch (_error) {
        const notFetchedMessage = "could not be fetched";
        return [notFetchedMessage, notFetchedMessage];
      }
    },
    isLoadingVolumeAndBB,
    // Update segment infos when opening the context menu, in case the annotation was saved since the context menu was last opened.
    // Of course the info should also be updated when the menu is opened for another segment, or after the refresh button was pressed.
    [contextMenuPosition, clickedSegmentOrMeshId, lastTimeSegmentInfoShouldBeFetched],
  );

  let nodeContextMenuTree: Tree | null = null;
  let nodeContextMenuNode: MutableNode | null = null;

  if (skeletonTracing != null && maybeClickedNodeId != null) {
    const treeAndNode = getTreeAndNode(skeletonTracing, maybeClickedNodeId);
    if (treeAndNode) {
      nodeContextMenuTree = treeAndNode[0];
      nodeContextMenuNode = treeAndNode[1];
    }
  }
  // TS doesn't understand the above initialization and assumes the values
  // are always null. The following NOOP helps TS with the correct typing.
  nodeContextMenuTree = nodeContextMenuTree as Tree | null;
  nodeContextMenuNode = nodeContextMenuNode as MutableNode | null;

  const clickedNodesPosition =
    nodeContextMenuNode != null ? getNodePosition(nodeContextMenuNode, Store.getState()) : null;

  const positionToMeasureDistanceTo =
    nodeContextMenuNode != null ? clickedNodesPosition : globalPosition;
  const activeNode = skeletonTracing != null ? getActiveNode(skeletonTracing) : null;

  const getActiveNodePosition = () => {
    if (activeNode == null) {
      throw new Error("getActiveNodePosition was called even though activeNode is null.");
    }
    return getNodePosition(activeNode, Store.getState());
  };
  const distanceToSelection =
    activeNode != null && positionToMeasureDistanceTo != null
      ? [
          formatNumberToLength(
            V3.scaledDist(getActiveNodePosition(), positionToMeasureDistanceTo, voxelSize.factor),
            LongUnitToShortUnitMap[voxelSize.unit],
          ),
          formatLengthAsVx(V3.length(V3.sub(getActiveNodePosition(), positionToMeasureDistanceTo))),
        ]
      : null;
  const nodePositionAsString =
    nodeContextMenuNode != null && clickedNodesPosition != null
      ? positionToString(clickedNodesPosition, nodeContextMenuNode.additionalCoordinates)
      : "";
  const infoRows: ItemType[] = [];

  if (maybeClickedNodeId != null && nodeContextMenuTree != null) {
    infoRows.push(
      getInfoMenuItem(
        "nodeInfo",
        `Node with Id ${maybeClickedNodeId} in Tree ${nodeContextMenuTree.treeId}`,
      ),
    );
  }

  if (nodeContextMenuNode != null) {
    infoRows.push(
      getInfoMenuItem(
        "positionInfo",
        <>
          <PushpinOutlined style={{ transform: "rotate(-45deg)" }} /> Position:{" "}
          {nodePositionAsString}
          {copyIconWithTooltip(nodePositionAsString, "Copy node position")}
        </>,
      ),
    );
  } else if (globalPosition != null) {
    const positionAsString = positionToString(globalPosition, props.additionalCoordinates);

    infoRows.push(
      getInfoMenuItem(
        "positionInfo",
        <>
          <PushpinOutlined style={{ transform: "rotate(-45deg)" }} /> Position: {positionAsString}
          {copyIconWithTooltip(positionAsString, "Copy position")}
        </>,
      ),
    );
  }

  const handleRefreshSegmentVolume = async () => {
    await api.tracing.save();
    setLastTimeSegmentInfoShouldBeFetched(new Date());
  };

  const refreshButton = (
    <FastTooltip title="Update this statistic">
      <AsyncIconButton
        onClick={handleRefreshSegmentVolume}
        type="primary"
        icon={<ReloadOutlined />}
        style={{ marginLeft: 4 }}
      />
    </FastTooltip>
  );

  const areSegmentStatisticsAvailable = wasSegmentOrMeshClicked && isSegmentIndexAvailable;

  if (areSegmentStatisticsAvailable) {
    infoRows.push(
      getInfoMenuItem(
        "volumeInfo",
        <>
          <i className="fas fa-expand-alt segment-context-icon" />
          Volume: {segmentVolumeLabel}
          {copyIconWithTooltip(segmentVolumeLabel as string, "Copy volume")}
          {refreshButton}
        </>,
      ),
    );
  }

  if (areSegmentStatisticsAvailable) {
    infoRows.push(
      getInfoMenuItem(
        "boundingBoxPositionInfo",
        <>
          <i className="fas fa-dice-d6 segment-context-icon" />
          <>Bounding Box: </>
          <div style={{ marginLeft: 22, marginTop: -5 }}>
            {boundingBoxInfoLabel}
            {copyIconWithTooltip(
              boundingBoxInfoLabel as string,
              "Copy BBox top left point and extent",
            )}
            {refreshButton}
          </div>
        </>,
      ),
    );
  }

  if (distanceToSelection != null) {
    infoRows.push(
      getInfoMenuItem(
        "distanceInfo",
        <FastTooltip title="Distance to the active Node of the active Tree">
          <>
            <i className="fas fa-ruler" /> {distanceToSelection[0]} ({distanceToSelection[1]}) to
            this {maybeClickedNodeId != null ? "Node" : "Position"}
            {copyIconWithTooltip(distanceToSelection[0], "Copy the distance")}
          </>
        </FastTooltip>,
      ),
    );
  }

  if (wasSegmentOrMeshClicked) {
    infoRows.push(
      getInfoMenuItem(
        "copy-cell",
        <>
          <div className="cell-context-icon" />
          Segment ID: {`${clickedSegmentOrMeshId}`}{" "}
          {copyIconWithTooltip(clickedSegmentOrMeshId, "Copy Segment ID")}
        </>,
      ),
    );
  }
  if (segments != null && wasSegmentOrMeshClicked) {
    const segmentName = segments.getNullable(clickedSegmentOrMeshId)?.name;
    if (segmentName != null) {
      const maxNameLength = 20;
      infoRows.push(
        getInfoMenuItem(
          "copy-cell",
          <>
            <i className="fas fa-tag segment-context-icon" />
            Segment Name:{" "}
            {segmentName.length > maxNameLength
              ? truncateStringToLength(segmentName, maxNameLength)
              : segmentName}
            {copyIconWithTooltip(segmentName, "Copy Segment Name")}
          </>,
        ),
      );
    }
  }

  if (infoRows.length > 0) {
    infoRows.unshift({
      key: "divider",
      type: "divider",
      className: "hide-if-first hide-if-last",
      style: {
        margin: "4px 0px",
      },
    });
  }

  const menu: MenuProps = {
    onClick: hideContextMenu,
    style: {
      borderRadius: 6,
    },
    mode: "vertical",
    items:
      maybeViewport == null
        ? []
        : maybeClickedNodeId != null
          ? getNodeContextMenuOptions({
              clickedNodeId: maybeClickedNodeId,
              infoRows,
              viewport: maybeViewport,
              ...props,
            })
          : getNoNodeContextMenuOptions({
              segmentIdAtPosition,
              infoRows,
              viewport: maybeViewport,
              ...props,
            }),
  };

  if (inputRef == null || inputRef.current == null) return null;
  const refContent = inputRef.current;

  return (
    <React.Fragment>
      <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />

      <Dropdown
        menu={menu}
        overlayClassName="dropdown-overlay-container-for-context-menu"
        open={contextMenuPosition != null}
        getPopupContainer={() => refContent}
        destroyPopupOnHide
      >
        <div />
      </Dropdown>
    </React.Fragment>
  );
}

export function getContextMenuPositionFromEvent(
  event: React.MouseEvent<HTMLDivElement>,
  className: string,
): [number, number] {
  const overlayDivs = document.getElementsByClassName(className);
  const referenceDiv = Array.from(overlayDivs)
    .map((p) => p.parentElement)
    .find((potentialParent) => {
      if (potentialParent == null) {
        return false;
      }
      const bounds = potentialParent.getBoundingClientRect();
      return bounds.width > 0;
    });

  if (referenceDiv == null) {
    return [0, 0];
  }
  const bounds = referenceDiv.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  return [x, y];
}

const Actions = {
  deleteNode(dispatch: Dispatch<any>, nodeId: number, treeId: number) {
    dispatch(deleteNodeAsUserAction(Store.getState(), nodeId, treeId));
  },

  setActiveCell(
    dispatch: Dispatch<any>,
    segmentId: number,
    somePosition?: Vector3,
    someAdditionalCoordinates?: AdditionalCoordinate[],
  ) {
    dispatch(setActiveCellAction(segmentId, somePosition, someAdditionalCoordinates));
  },

  setBoundingBoxName(dispatch: Dispatch<any>, id: number, name: string) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        name,
      }),
    );
  },

  setBoundingBoxColor(dispatch: Dispatch<any>, id: number, color: Vector3) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        color,
      }),
    );
  },

  deleteBoundingBox(dispatch: Dispatch<any>, id: number) {
    dispatch(deleteUserBoundingBoxAction(id));
  },

  hideBoundingBox(dispatch: Dispatch<any>, id: number) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        isVisible: false,
      }),
    );
  },
  removeMesh(dispatch: Dispatch<any>, layerName: string, meshId: number) {
    dispatch(removeMeshAction(layerName, meshId));
  },
  hideMesh(dispatch: Dispatch<any>, layerName: string, meshId: number) {
    dispatch(
      updateMeshVisibilityAction(
        layerName,
        meshId,
        false,
        Store.getState().flycam.additionalCoordinates,
      ),
    );
  },
  setPosition(dispatch: Dispatch<any>, position: Vector3) {
    dispatch(setPositionAction(position));
  },
  refreshMesh(dispatch: Dispatch<any>, layerName: string, segmentId: number) {
    dispatch(refreshMeshAction(layerName, segmentId));
  },
};

export default WkContextMenu;
