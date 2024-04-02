import { CopyOutlined, PushpinOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { Dropdown, Empty, notification, Tooltip, Popover, Input, MenuProps, Modal } from "antd";
import { connect, useSelector } from "react-redux";
import React, { createContext, MouseEvent, useContext, useEffect, useState } from "react";
import type {
  APIConnectomeFile,
  APIDataset,
  APIDataLayer,
  APIMeshFile,
} from "types/api_flow_types";
import type {
  ActiveMappingInfo,
  MutableNode,
  OxalisState,
  SegmentMap,
  SkeletonTracing,
  Tree,
  UserBoundingBox,
  VolumeTracing,
} from "oxalis/store";
import {
  AnnotationTool,
  Vector3,
  OrthoView,
  AnnotationToolEnum,
  VolumeTools,
  AltOrOptionKey,
  CtrlOrCmdKey,
} from "oxalis/constants";
import { V3 } from "libs/mjs";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import {
  addUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
  changeUserBoundingBoxAction,
  maybeFetchMeshFilesAction,
  removeMeshAction,
  updateMeshVisibilityAction,
  refreshMeshAction,
} from "oxalis/model/actions/annotation_actions";
import {
  deleteEdgeAction,
  mergeTreesAction,
  deleteNodeAsUserAction,
  setActiveNodeAction,
  createTreeAction,
  setTreeVisibilityAction,
  createBranchPointAction,
  deleteBranchpointByIdAction,
  addTreesAndGroupsAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { formatNumberToLength, formatLengthAsVx, formatNumberToVolume } from "libs/format_utils";
import {
  getActiveSegmentationTracing,
  getSegmentsForLayer,
  hasAgglomerateMapping,
  hasConnectomeFile,
  hasEditableMapping,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getNodeAndTree,
  getNodeAndTreeOrNull,
  getNodePosition,
  isSkeletonLayerTransformed,
} from "oxalis/model/accessors/skeletontracing_accessor";
import {
  getSegmentIdForPosition,
  getSegmentIdForPositionAsync,
  handleFloodFillFromGlobalPosition,
} from "oxalis/controller/combinations/volume_handlers";
import {
  getVisibleSegmentationLayer,
  getMappingInfo,
  getResolutionInfo,
  getMaybeSegmentIndexAvailability,
} from "oxalis/model/accessors/dataset_accessor";
import {
  loadAgglomerateSkeletonAtPosition,
  loadSynapsesOfAgglomerateAtPosition,
} from "oxalis/controller/combinations/segmentation_handlers";
import { isBoundingBoxUsableForMinCut } from "oxalis/model/sagas/min_cut_saga";
import {
  getVolumeRequestUrl,
  withMappingActivationConfirmation,
} from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import { maybeGetSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  clickSegmentAction,
  performMinCutAction,
  setActiveCellAction,
} from "oxalis/model/actions/volumetracing_actions";
import { roundTo, hexToRgb, rgbToHex, truncateStringToLength } from "libs/utils";
import { setWaypoint } from "oxalis/controller/combinations/skeleton_handlers";
import Shortcut from "libs/shortcut_component";
import Toast from "libs/toast";
import { api } from "oxalis/singletons";
import messages from "messages";
import { extractPathAsNewTree } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import Store from "oxalis/store";
import {
  minCutAgglomerateAction,
  minCutAgglomerateWithPositionAction,
  cutAgglomerateFromNeighborsAction,
  proofreadMerge,
} from "oxalis/model/actions/proofread_actions";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import {
  ItemType,
  MenuItemGroupType,
  MenuItemType,
  SubMenuType,
} from "antd/lib/menu/hooks/useItems";
import { getSegmentBoundingBoxes, getSegmentVolumes } from "admin/admin_rest_api";
import { useFetch } from "libs/react_helpers";
import { AsyncIconButton } from "components/async_clickables";
import { type AdditionalCoordinate } from "types/api_flow_types";
import { voxelToNm3 } from "oxalis/model/scaleinfo";
import { getBoundingBoxInMag1 } from "oxalis/model/sagas/volume/helpers";
import {
  ensureLayerMappingsAreLoadedAction,
  ensureSegmentIndexIsLoadedAction,
} from "oxalis/model/actions/dataset_actions";

type ContextMenuContextValue = React.MutableRefObject<HTMLElement | null> | null;
export const ContextMenuContext = createContext<ContextMenuContextValue>(null);

// The newest eslint version thinks the props listed below aren't used.
type OwnProps = {
  contextMenuPosition: [number, number] | null | undefined;
  maybeClickedNodeId: number | null | undefined;
  maybeClickedMeshId: number | null | undefined;
  maybeMeshIntersectionPosition: Vector3 | null | undefined;
  clickedBoundingBoxId: number | null | undefined;
  globalPosition: Vector3 | null | undefined;
  additionalCoordinates: AdditionalCoordinate[] | undefined;
  maybeViewport: OrthoView | null | undefined;
  hideContextMenu: () => void;
};

type StateProps = {
  skeletonTracing: SkeletonTracing | null | undefined;
  datasetScale: Vector3;
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

function copyIconWithTooltip(value: string | number, title: string) {
  return (
    <Tooltip title={title}>
      <CopyOutlined
        style={{
          margin: "0 0 0 5px",
        }}
        onClick={async () => {
          await navigator.clipboard.writeText(value.toString());
          Toast.success(`"${value}" copied to clipboard`);
        }}
      />
    </Tooltip>
  );
}

function measureAndShowLengthBetweenNodes(sourceNodeId: number, targetNodeId: number) {
  const [lengthNm, lengthVx] = api.tracing.measurePathLengthBetweenNodes(
    sourceNodeId,
    targetNodeId,
  );
  notification.open({
    message: `The shortest path length between the nodes is ${formatNumberToLength(
      lengthNm,
    )} (${formatLengthAsVx(lengthVx)}).`,
    icon: <i className="fas fa-ruler" />,
  });
}

function extractShortestPathAsNewTree(
  sourceTree: Tree,
  sourceNodeId: number,
  targetNodeId: number,
) {
  const { shortestPath } = api.tracing.findShortestPathBetweenNodes(sourceNodeId, targetNodeId);
  const newTree = extractPathAsNewTree(Store.getState(), sourceTree, shortestPath).getOrElse(null);
  if (newTree != null) {
    const treeMap = { [newTree.treeId]: newTree };
    Store.dispatch(addTreesAndGroupsAction(treeMap, null));
  }
}

function measureAndShowFullTreeLength(treeId: number, treeName: string) {
  const [lengthInNm, lengthInVx] = api.tracing.measureTreeLength(treeId);
  notification.open({
    message: messages["tracing.tree_length_notification"](
      treeName,
      formatNumberToLength(lengthInNm),
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
  maybeClickedMeshId: number | null | undefined,
  maybeMeshIntersectionPosition: Vector3 | null | undefined,
  visibleSegmentationLayer: APIDataLayer | null | undefined,
  datasetScale: Vector3,
): MenuItemType[] {
  if (
    maybeClickedMeshId == null ||
    maybeMeshIntersectionPosition == null ||
    visibleSegmentationLayer == null
  ) {
    return [];
  }

  return [
    {
      key: "hide-mesh",
      onClick: () =>
        Actions.hideMesh(Store.dispatch, visibleSegmentationLayer.name, maybeClickedMeshId),
      label: "Hide Mesh",
    },
    {
      key: "reload-mesh",
      onClick: () =>
        Actions.refreshMesh(Store.dispatch, visibleSegmentationLayer.name, maybeClickedMeshId),
      label: "Reload Mesh",
    },
    {
      key: "jump-to-mesh",
      onClick: () => {
        const unscaledPosition = V3.divide3(maybeMeshIntersectionPosition, datasetScale);
        Actions.setPosition(Store.dispatch, unscaledPosition);
      },
      label: "Jump to Position",
    },
    {
      key: "remove-mesh",
      onClick: () =>
        Actions.removeMesh(Store.dispatch, visibleSegmentationLayer.name, maybeClickedMeshId),
      label: "Remove Mesh",
    },
  ];
}

function getNodeContextMenuOptions({
  skeletonTracing,
  clickedNodeId,
  maybeClickedMeshId,
  maybeMeshIntersectionPosition,
  visibleSegmentationLayer,
  datasetScale,
  useLegacyBindings,
  volumeTracing,
  infoRows,
  allowUpdate,
}: NodeContextMenuOptionsProps): ItemType[] {
  const state = Store.getState();
  const isProofreadingActive = state.uiInformation.activeTool === AnnotationToolEnum.PROOFREAD;
  const isVolumeModificationAllowed = !hasEditableMapping(state);

  if (skeletonTracing == null) {
    throw new Error(
      "NodeContextMenuOptions should not have been called without existing skeleton tracing.",
    );
  }

  const { userBoundingBoxes } = skeletonTracing;
  const { activeTreeId, activeNodeId } = skeletonTracing;
  const { node: clickedNode, tree: clickedTree } = getNodeAndTreeOrNull(
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
    maybeClickedMeshId,
    maybeMeshIntersectionPosition,
    visibleSegmentationLayer,
    datasetScale,
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
                ? Store.dispatch(mergeTreesAction(clickedNodeId, activeNodeId))
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
                  <Tooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot cut because the proofreading tool is not active."
                    }
                  >
                    Split from all neighboring segments
                  </Tooltip>
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
              ? measureAndShowLengthBetweenNodes(activeNodeId, clickedNodeId)
              : null,
          label: "Path Length to this Node",
        },
    {
      key: "measure-whole-tree-length",
      onClick: () => measureAndShowFullTreeLength(clickedTree.treeId, clickedTree.name),
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
  hideContextMenu,
  allowUpdate,
}: NoNodeContextMenuProps): ItemType[] {
  if (globalPosition == null) return [];

  const isBoundingBoxToolActive = activeTool === AnnotationToolEnum.BOUNDING_BOX;
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
    viewport,
    visibleSegmentationLayer,
    segmentIdAtPosition,
    dataset,
    datasetScale,
    currentMeshFile,
    currentConnectomeFile,
    mappingInfo,
    infoRows,
    allowUpdate,
  } = props;

  const state = Store.getState();
  const isAgglomerateMappingEnabled = hasAgglomerateMapping(state);
  const isConnectomeMappingEnabled = hasConnectomeFile(state);

  const isProofreadingActive = state.uiInformation.activeTool === AnnotationToolEnum.PROOFREAD;

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
  const isBoundingBoxToolActive = activeTool === AnnotationToolEnum.BOUNDING_BOX;
  const skeletonActions: ItemType[] =
    skeletonTracing != null && globalPosition != null && allowUpdate
      ? [
          {
            key: "create-node",
            onClick: () => setWaypoint(globalPosition, viewport, false),
            label: "Create Node here",
            disabled: isSkeletonLayerTransformed(state),
          },
          {
            key: "create-node-with-tree",
            onClick: () => {
              Store.dispatch(createTreeAction());
              setWaypoint(globalPosition, viewport, false);
            },
            label: (
              <>
                Create new Tree here{" "}
                {!isVolumeBasedToolActive && !isBoundingBoxToolActive
                  ? shortcutBuilder(["C"])
                  : null}
              </>
            ),
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
              <Tooltip
                title={
                  isAgglomerateMappingEnabled.value ? undefined : isAgglomerateMappingEnabled.reason
                }
                onOpenChange={(open: boolean) => {
                  if (open) {
                    Store.dispatch(ensureLayerMappingsAreLoadedAction());
                  }
                }}
              >
                <span>
                  Import Agglomerate Skeleton{" "}
                  {!isAgglomerateMappingEnabled.value ? (
                    <WarningOutlined style={{ color: "var(--ant-color-text-disabled)" }} />
                  ) : null}{" "}
                  {shortcutBuilder(["Shift", "middleMouse"])}
                </span>
              </Tooltip>
            ),
          },
          isAgglomerateMappingEnabled.value
            ? {
                key: "merge-agglomerate-skeleton",
                disabled: !isProofreadingActive,
                onClick: () => Store.dispatch(proofreadMerge(globalPosition)),
                label: (
                  <Tooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot merge because the proofreading tool is not active."
                    }
                  >
                    <span>Merge with active segment {shortcutBuilder(["Shift", "leftMouse"])}</span>
                  </Tooltip>
                ),
              }
            : null,
          isAgglomerateMappingEnabled.value
            ? {
                key: "min-cut-agglomerate-at-position",
                disabled: !isProofreadingActive,
                onClick: () => Store.dispatch(minCutAgglomerateWithPositionAction(globalPosition)),
                label: (
                  <Tooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot merge because the proofreading tool is not active."
                    }
                  >
                    <span>
                      Split from active segment {shortcutBuilder([CtrlOrCmdKey, "leftMouse"])}
                    </span>
                  </Tooltip>
                ),
              }
            : null,
          isAgglomerateMappingEnabled.value
            ? {
                key: "cut-agglomerate-from-neighbors",
                disabled: !isProofreadingActive,
                onClick: () => Store.dispatch(cutAgglomerateFromNeighborsAction(globalPosition)),
                label: (
                  <Tooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot cut because the proofreading tool is not active."
                    }
                  >
                    Split from all neighboring segments
                  </Tooltip>
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
        <Tooltip title={isConnectomeMappingEnabled.reason}>
          Import Synapses{" "}
          {!isConnectomeMappingEnabled.value ? (
            <WarningOutlined style={{ color: "var(--ant-color-text-disabled)" }} />
          ) : null}{" "}
        </Tooltip>
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
    label: "Load Mesh (precomputed)",
  };
  const computeMeshAdHocItem = {
    key: "compute-mesh-adhc",
    onClick: computeMeshAdHoc,
    label: "Compute Mesh (ad-hoc)",
  };
  const nonSkeletonActions: ItemType[] =
    volumeTracing != null && globalPosition != null
      ? [
          // Segment 0 cannot/shouldn't be made active (as this
          // would be an eraser effectively).
          segmentIdAtPosition > 0
            ? {
                key: "select-cell",
                onClick: () => {
                  Store.dispatch(
                    setActiveCellAction(segmentIdAtPosition, globalPosition, additionalCoordinates),
                  );
                },
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
          allowUpdate
            ? {
                key: "fill-cell",
                onClick: () => handleFloodFillFromGlobalPosition(globalPosition, viewport),
                label: "Fill Segment (flood-fill region)",
              }
            : null,
        ]
      : [];
  const boundingBoxActions = getBoundingBoxMenuOptions(props);
  if (volumeTracing == null && visibleSegmentationLayer != null && globalPosition != null) {
    nonSkeletonActions.push(focusInSegmentListItem);
    nonSkeletonActions.push(loadPrecomputedMeshItem);
    nonSkeletonActions.push(computeMeshAdHocItem);
  }

  const isSkeletonToolActive = activeTool === AnnotationToolEnum.SKELETON;
  let allActions: ItemType[] = [];

  const meshRelatedItems = getMeshItems(
    maybeClickedMeshId,
    maybeMeshIntersectionPosition,
    visibleSegmentationLayer,
    datasetScale,
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
  contextMenuPosition: [number, number] | null | undefined;
  hideContextMenu: () => void;
  children: React.ReactElement;
  positionAbsolute?: boolean;
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
        className="node-context-menu-overlay"
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
        className="node-context-menu-overlay"
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
            pointerEvents: "all",
          }}
          className="node-context-menu"
          tabIndex={-1}
          // @ts-ignore
          ref={inputRef}
        />
        <ContextMenuContext.Provider value={inputRef}>{props.children}</ContextMenuContext.Provider>
      </div>
    </React.Fragment>
  );
}

function ContextMenuContainer(props: Props) {
  return (
    <GenericContextMenuContainer {...props}>
      <ContextMenuInner {...props} />
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

function ContextMenuInner(propsWithInputRef: Props) {
  const [lastTimeSegmentInfoShouldBeFetched, setLastTimeSegmentInfoShouldBeFetched] = useState(
    new Date(),
  );
  const inputRef = useContext(ContextMenuContext);
  const { ...props } = propsWithInputRef;
  const {
    skeletonTracing,
    maybeClickedNodeId,
    maybeClickedMeshId,
    contextMenuPosition,
    segments,
    hideContextMenu,
    datasetScale,
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
  const wasSegmentOrMeshClicked = clickedSegmentOrMeshId > 0;

  const { dataset, tracing, flycam } = useSelector((state: OxalisState) => state);
  useEffect(() => {
    Store.dispatch(ensureSegmentIndexIsLoadedAction(visibleSegmentationLayer?.name));
  }, [visibleSegmentationLayer]);
  const isSegmentIndexAvailable = useSelector((state: OxalisState) =>
    getMaybeSegmentIndexAvailability(state.dataset, visibleSegmentationLayer?.name),
  );
  const mappingName: string | null | undefined = useSelector((state: OxalisState) => {
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
      // The value that is returned if the context menu is closed is shown if it's still loading
      if (contextMenuPosition == null || !wasSegmentOrMeshClicked) return isLoadingVolumeAndBB;
      if (visibleSegmentationLayer == null || !isSegmentIndexAvailable) return [];
      const tracingId = volumeTracing?.tracingId;
      const additionalCoordinates = flycam.additionalCoordinates;
      const requestUrl = getVolumeRequestUrl(dataset, tracing, tracingId, visibleSegmentationLayer);
      const magInfo = getResolutionInfo(visibleSegmentationLayer.resolutions);
      const layersFinestResolution = magInfo.getFinestResolution();
      const datasetScale = dataset.dataSource.scale;

      try {
        const [segmentSize] = await getSegmentVolumes(
          requestUrl,
          layersFinestResolution,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
        );
        const [boundingBoxInRequestedMag] = await getSegmentBoundingBoxes(
          requestUrl,
          layersFinestResolution,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
        );
        const boundingBoxInMag1 = getBoundingBoxInMag1(
          boundingBoxInRequestedMag,
          layersFinestResolution,
        );
        const boundingBoxTopLeftString = `(${boundingBoxInMag1.topLeft[0]}, ${boundingBoxInMag1.topLeft[1]}, ${boundingBoxInMag1.topLeft[2]})`;
        const boundingBoxSizeString = `(${boundingBoxInMag1.width}, ${boundingBoxInMag1.height}, ${boundingBoxInMag1.depth})`;
        const volumeInNm3 = voxelToNm3(datasetScale, layersFinestResolution, segmentSize);
        return [
          formatNumberToVolume(volumeInNm3),
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

  if (contextMenuPosition == null || maybeViewport == null) {
    return <></>;
  }

  const activeTreeId = skeletonTracing != null ? skeletonTracing.activeTreeId : null;
  const activeNodeId = skeletonTracing?.activeNodeId;

  let nodeContextMenuTree: Tree | null = null;
  let nodeContextMenuNode: MutableNode | null = null;

  if (skeletonTracing != null && maybeClickedNodeId != null) {
    getNodeAndTree(skeletonTracing, maybeClickedNodeId).map(([tree, node]) => {
      nodeContextMenuNode = node;
      nodeContextMenuTree = tree;
    });
  }
  // TS doesnt understand the above initialization and assumes the values
  // are always null. The following NOOP helps TS with the correct typing.
  nodeContextMenuTree = nodeContextMenuTree as Tree | null;
  nodeContextMenuNode = nodeContextMenuNode as MutableNode | null;

  const clickedNodesPosition =
    nodeContextMenuNode != null ? getNodePosition(nodeContextMenuNode, Store.getState()) : null;

  const positionToMeasureDistanceTo =
    nodeContextMenuNode != null ? clickedNodesPosition : globalPosition;
  const activeNode =
    activeNodeId != null && skeletonTracing != null
      ? getNodeAndTree(skeletonTracing, activeNodeId, activeTreeId).get()[1]
      : null;

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
            V3.scaledDist(getActiveNodePosition(), positionToMeasureDistanceTo, datasetScale),
          ),
          formatLengthAsVx(V3.length(V3.sub(getActiveNodePosition(), positionToMeasureDistanceTo))),
        ]
      : null;
  const nodePositionAsString =
    nodeContextMenuNode != null && clickedNodesPosition != null
      ? positionToString(clickedNodesPosition, nodeContextMenuNode.additionalCoordinates)
      : "";
  const infoRows = [];

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
    <Tooltip title="Update this statistic">
      <AsyncIconButton
        onClick={handleRefreshSegmentVolume}
        type="primary"
        icon={<ReloadOutlined />}
        style={{ marginLeft: 4 }}
      />
    </Tooltip>
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
        <Tooltip title="Distance to the active Node of the active Tree">
          <>
            <i className="fas fa-ruler" /> {distanceToSelection[0]} ({distanceToSelection[1]}) to
            this {maybeClickedNodeId != null ? "Node" : "Position"}
            {copyIconWithTooltip(distanceToSelection[0], "Copy the distance")}
          </>
        </Tooltip>,
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
  if (segments != null && maybeClickedMeshId != null) {
    const segmentName = segments.get(maybeClickedMeshId)?.name;
    if (segmentName != null) {
      const maxSegmentNameLength = 18;
      infoRows.push(
        getInfoMenuItem(
          "copy-cell",
          <>
            <Tooltip title="Segment Name">
              <i className="fas fa-tag" />{" "}
            </Tooltip>
            <Tooltip title={segmentName.length > maxSegmentNameLength ? segmentName : null}>
              {truncateStringToLength(segmentName, maxSegmentNameLength)}
            </Tooltip>
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
      maybeClickedNodeId != null
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
        // @ts-ignore
        destroyPopupOnHide
      >
        <div />
      </Dropdown>
    </React.Fragment>
  );
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

function mapStateToProps(state: OxalisState): StateProps {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  const mappingInfo = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
  );
  const someTracing = maybeGetSomeTracing(state.tracing);
  return {
    skeletonTracing: state.tracing.skeleton,
    volumeTracing: getActiveSegmentationTracing(state),
    datasetScale: state.dataset.dataSource.scale,
    activeTool: state.uiInformation.activeTool,
    dataset: state.dataset,
    allowUpdate: state.tracing.restrictions.allowUpdate,
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
  };
}

const connector = connect(mapStateToProps);
export default connector(ContextMenuContainer);
