import { CopyOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { Dropdown, Empty, Menu, notification, Tooltip, Popover, Input } from "antd";
import { connect, useDispatch, useSelector } from "react-redux";
import React, { useEffect } from "react";
import type {
  APIConnectomeFile,
  APIDataset,
  APIDataLayer,
  APIMeshFile,
} from "types/api_flow_types";
import type {
  ActiveMappingInfo,
  MutableNode,
  MutableTreeMap,
  OxalisState,
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
} from "oxalis/model/actions/annotation_actions";
import {
  deleteEdgeAction,
  mergeTreesAction,
  deleteNodeAction,
  setActiveNodeAction,
  createTreeAction,
  setTreeVisibilityAction,
  createBranchPointAction,
  deleteBranchpointByIdAction,
  addTreesAndGroupsAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import { getActiveSegmentationTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { getNodeAndTree, findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  getSegmentIdForPosition,
  getSegmentIdForPositionAsync,
  handleFloodFillFromGlobalPosition,
} from "oxalis/controller/combinations/volume_handlers";
import {
  getVisibleSegmentationLayer,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  hasAgglomerateMapping,
  hasConnectomeFile,
  loadAgglomerateSkeletonAtPosition,
  loadSynapsesOfAgglomerateAtPosition,
} from "oxalis/controller/combinations/segmentation_handlers";
import { isBoundingBoxUsableForMinCut } from "oxalis/model/sagas/min_cut_saga";
import {
  maybeFetchMeshFiles,
  withMappingActivationConfirmation,
} from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import { maybeGetSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  performMinCutAction,
  setActiveCellAction,
} from "oxalis/model/actions/volumetracing_actions";
import { roundTo, hexToRgb, rgbToHex } from "libs/utils";
import { setWaypoint } from "oxalis/controller/combinations/skeleton_handlers";
import Shortcut from "libs/shortcut_component";
import Toast from "libs/toast";
import api from "oxalis/api/internal_api";
import messages from "messages";
import { extractPathAsNewTree } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import Store from "oxalis/store";
import {
  minCutAgglomerateAction,
  minCutAgglomerateWithPositionAction,
  proofreadMerge,
} from "oxalis/model/actions/proofread_actions";
const { SubMenu } = Menu;

/* eslint-disable react/no-unused-prop-types */
// The newest eslint version thinks the props listed below aren't used.
type OwnProps = {
  contextMenuPosition: [number, number] | null | undefined;
  maybeClickedNodeId: number | null | undefined;
  clickedBoundingBoxId: number | null | undefined;
  globalPosition: Vector3 | null | undefined;
  maybeViewport: OrthoView | null | undefined;
  hideContextMenu: () => void;
};
type DispatchProps = {
  deleteEdge: (arg0: number, arg1: number) => void;
  mergeTrees: (arg0: number, arg1: number) => void;
  minCutAgglomerate: (arg0: number, arg1: number) => void;
  deleteNode: (arg0: number, arg1: number) => void;
  setActiveNode: (arg0: number) => void;
  hideTree: (arg0: number) => void;
  createTree: () => void;
  addTreesAndGroups: (arg0: MutableTreeMap) => void;
  hideBoundingBox: (arg0: number) => void;
  setBoundingBoxColor: (arg0: number, arg1: Vector3) => void;
  setBoundingBoxName: (arg0: number, arg1: string) => void;
  addNewBoundingBox: (arg0: Vector3) => void;
  deleteBoundingBox: (arg0: number) => void;
  setActiveCell: (arg0: number, somePosition?: Vector3) => void;
  createBranchPoint: (arg0: number, arg1: number) => void;
  deleteBranchpointById: (arg0: number, arg1: number) => void;
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
};
type Props = OwnProps & StateProps & DispatchProps;
type PropsWithRef = Props & {
  inputRef: React.MutableRefObject<HTMLElement | null>;
};
type NodeContextMenuOptionsProps = Props & {
  viewport: OrthoView;
  clickedNodeId: number;
  infoRows: Array<React.ReactNode>;
};

/* eslint-enable react/no-unused-prop-types */
type NoNodeContextMenuProps = Props & {
  viewport: OrthoView;
  segmentIdAtPosition: number;
  activeTool: AnnotationTool;
  infoRows: Array<React.ReactNode>;
};
// @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'typeof MenuItem' is not assignab... Remove this comment to see the full error message
const MenuItemWithMappingActivationConfirmation = withMappingActivationConfirmation(Menu.Item);

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

function positionToString(pos: Vector3): string {
  return pos.map((value) => roundTo(value, 2)).join(", ");
}

function shortcutBuilder(shortcuts: Array<string>): React.ReactNode {
  const lineColor = "var(--ant-text-secondary)";

  const mapNameToShortcutIcon = (name: string) => {
    switch (name) {
      case "leftMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-left.svg"
            alt="Mouse Left Click"
            style={{
              margin: 0,
            }}
          />
        );
      }

      case "rightMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-right.svg"
            alt="Mouse Right Click"
            style={{
              margin: 0,
            }}
          />
        );
      }

      case "middleMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-wheel.svg"
            alt="Mouse Wheel"
            style={{
              margin: 0,
            }}
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
  dispatch: Dispatch<any>,
) {
  const seeds = Array.from(clickedTree.nodes.values());

  if (volumeTracing == null || seeds.length !== 2) {
    return null;
  }

  return (
    <SubMenu
      key="min-cut"
      title="Perform Min-Cut (Experimental)" // For some reason, antd doesn't pass the ant-dropdown class to the
      // sub menu itself which makes the label of the item group too big.
      // Passing the CSS class here fixes it (font-size is 14px instead of
      // 16px then).
      popupClassName="ant-dropdown"
    >
      <Menu.ItemGroup
        key="choose-bbox-group"
        title="Choose a bounding box for the min-cut operation:"
      >
        <Menu.Item
          key="create-new"
          onClick={() => dispatch(performMinCutAction(clickedTree.treeId))}
        >
          Use default bounding box
        </Menu.Item>

        {userBoundingBoxes
          .filter((bbox) => isBoundingBoxUsableForMinCut(bbox.boundingBox, seeds))
          .map((bbox) => (
            <Menu.Item
              key={bbox.id}
              onClick={() => dispatch(performMinCutAction(clickedTree.treeId, bbox.id))}
            >
              {bbox.name || "Unnamed bounding box"}
            </Menu.Item>
          ))}
      </Menu.ItemGroup>
    </SubMenu>
  );
}

function NodeContextMenuOptions({
  skeletonTracing,
  clickedNodeId,
  hideContextMenu,
  deleteEdge,
  mergeTrees,
  minCutAgglomerate,
  deleteNode,
  createBranchPoint,
  deleteBranchpointById,
  setActiveNode,
  hideTree,
  useLegacyBindings,
  volumeTracing,
  infoRows,
  allowUpdate,
}: NodeContextMenuOptionsProps): JSX.Element {
  const isProofreadingActive = useSelector(
    (state: OxalisState) => state.uiInformation.activeTool === "PROOFREAD",
  );
  const dispatch = useDispatch();

  if (skeletonTracing == null) {
    throw new Error(
      "NodeContextMenuOptions should not have been called without existing skeleton tracing.",
    );
  }

  const { userBoundingBoxes } = skeletonTracing;
  const { activeTreeId, trees, activeNodeId } = skeletonTracing;
  const clickedTree = findTreeByNodeId(trees, clickedNodeId).get();
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

  return (
    <Menu
      onClick={hideContextMenu}
      style={{
        borderRadius: 6,
      }}
      mode="vertical"
    >
      <Menu.Item
        key="set-node-active"
        disabled={isTheSameNode}
        onClick={() => setActiveNode(clickedNodeId)}
      >
        Select this Node
      </Menu.Item>
      {getMaybeMinCutItem(clickedTree, volumeTracing, userBoundingBoxes, dispatch)}
      {allowUpdate ? (
        <>
          <Menu.Item
            key="merge-trees"
            disabled={areInSameTree}
            onClick={() => (activeNodeId != null ? mergeTrees(clickedNodeId, activeNodeId) : null)}
          >
            Create Edge & Merge with this Tree{" "}
            {useLegacyBindings ? shortcutBuilder(["Shift", "Alt", "leftMouse"]) : null}
          </Menu.Item>
          {isProofreadingActive ? (
            <Menu.Item
              key="min-cut-node"
              disabled={!areInSameTree || isTheSameNode}
              onClick={() =>
                activeNodeId != null ? minCutAgglomerate(clickedNodeId, activeNodeId) : null
              }
            >
              Perform Min-Cut between these Nodes
            </Menu.Item>
          ) : null}
          <Menu.Item
            key="delete-edge"
            disabled={!areNodesConnected}
            onClick={() => (activeNodeId != null ? deleteEdge(activeNodeId, clickedNodeId) : null)}
          >
            Delete Edge to this Node{" "}
            {useLegacyBindings ? shortcutBuilder(["Shift", "Ctrl", "leftMouse"]) : null}
          </Menu.Item>
          <Menu.Item
            key="delete-node"
            onClick={() => deleteNode(clickedNodeId, clickedTree.treeId)}
          >
            Delete this Node {activeNodeId === clickedNodeId ? shortcutBuilder(["Del"]) : null}
          </Menu.Item>
          {isBranchpoint ? (
            <Menu.Item
              className="node-context-menu-item"
              key="branchpoint-node"
              onClick={() =>
                activeNodeId != null
                  ? deleteBranchpointById(clickedNodeId, clickedTree.treeId)
                  : null
              }
            >
              Unmark as Branchpoint
            </Menu.Item>
          ) : (
            <Menu.Item
              className="node-context-menu-item"
              key="branchpoint-node"
              onClick={() =>
                activeNodeId != null ? createBranchPoint(clickedNodeId, clickedTree.treeId) : null
              }
            >
              Mark as Branchpoint {activeNodeId === clickedNodeId ? shortcutBuilder(["B"]) : null}
            </Menu.Item>
          )}
          {isTheSameNode ? null : (
            <Menu.Item
              key="extract-shortest-path"
              disabled={activeNodeId == null || !areInSameTree || isTheSameNode}
              onClick={() =>
                activeNodeId != null
                  ? extractShortestPathAsNewTree(clickedTree, activeNodeId, clickedNodeId)
                  : null
              }
            >
              Extract shortest Path to this Node
            </Menu.Item>
          )}
        </>
      ) : null}
      {isTheSameNode ? null : (
        <Menu.Item
          key="measure-node-path-length"
          disabled={activeNodeId == null || !areInSameTree || isTheSameNode}
          onClick={() =>
            activeNodeId != null
              ? measureAndShowLengthBetweenNodes(activeNodeId, clickedNodeId)
              : null
          }
        >
          Path Length to this Node
        </Menu.Item>
      )}
      <Menu.Item
        key="measure-whole-tree-length"
        onClick={() => measureAndShowFullTreeLength(clickedTree.treeId, clickedTree.name)}
      >
        Path Length of this Tree
      </Menu.Item>
      {allowUpdate ? (
        <Menu.Item key="hide-tree" onClick={() => hideTree(clickedTree.treeId)}>
          Hide this Tree
        </Menu.Item>
      ) : null}
      {infoRows}
    </Menu>
  );
}

function getBoundingBoxMenuOptions({
  addNewBoundingBox,
  globalPosition,
  activeTool,
  clickedBoundingBoxId,
  userBoundingBoxes,
  setBoundingBoxName,
  hideContextMenu,
  setBoundingBoxColor,
  hideBoundingBox,
  deleteBoundingBox,
  allowUpdate,
}: NoNodeContextMenuProps) {
  if (globalPosition == null) return [];

  const isBoundingBoxToolActive = activeTool === AnnotationToolEnum.BOUNDING_BOX;
  const newBoundingBoxMenuItem = (
    <Menu.Item
      key="add-new-bounding-box"
      onClick={() => {
        addNewBoundingBox(globalPosition);
      }}
    >
      Create new Bounding Box
      {isBoundingBoxToolActive ? shortcutBuilder(["C"]) : null}
    </Menu.Item>
  );
  const hideBoundingBoxMenuItem =
    clickedBoundingBoxId != null ? (
      <Menu.Item
        key="hide-bounding-box"
        onClick={() => {
          hideBoundingBox(clickedBoundingBoxId);
        }}
      >
        Hide Bounding Box
      </Menu.Item>
    ) : null;
  if (!allowUpdate && clickedBoundingBoxId != null) {
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
    setBoundingBoxName(clickedBoundingBoxId, evt.target.value);
  };

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'evt' implicitly has an 'any' type.
  const preventContextMenuFromClosing = (evt) => {
    evt.stopPropagation();
  };

  const upscaledBBoxColor = hoveredBBox.color.map((colorPart) => colorPart * 255) as any as Vector3;
  return [
    newBoundingBoxMenuItem,
    <Menu.Item key="change-bounding-box-name">
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
    </Menu.Item>,
    <Menu.Item key="change-bounding-box-color">
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
          onChange={(evt: React.SyntheticEvent) => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
            let color = hexToRgb(evt.target.value);
            color = color.map((colorPart) => colorPart / 255) as any as Vector3;
            setBoundingBoxColor(clickedBoundingBoxId, color);
          }}
          value={rgbToHex(upscaledBBoxColor)}
        />
      </span>
    </Menu.Item>,
    <Menu.Item
      key="hide-bounding-box"
      onClick={() => {
        hideBoundingBox(clickedBoundingBoxId);
      }}
    >
      Hide Bounding Box
    </Menu.Item>,
    <Menu.Item
      key="delete-bounding-box"
      onClick={() => {
        deleteBoundingBox(clickedBoundingBoxId);
      }}
    >
      Delete Bounding Box
    </Menu.Item>,
  ];
}

function NoNodeContextMenuOptions(props: NoNodeContextMenuProps): JSX.Element {
  const {
    skeletonTracing,
    volumeTracing,
    activeTool,
    globalPosition,
    viewport,
    createTree,
    segmentIdAtPosition,
    visibleSegmentationLayer,
    dataset,
    currentMeshFile,
    currentConnectomeFile,
    hideContextMenu,
    setActiveCell,
    mappingInfo,
    infoRows,
    allowUpdate,
  } = props;
  const dispatch = useDispatch();
  const isAgglomerateMappingEnabled = useSelector(hasAgglomerateMapping);
  const isConnectomeMappingEnabled = useSelector(hasConnectomeFile);

  useEffect(() => {
    (async () => {
      await maybeFetchMeshFiles(visibleSegmentationLayer, dataset, false);
    })();
  }, [visibleSegmentationLayer, dataset]);

  const loadPrecomputedMesh = async () => {
    if (!currentMeshFile || !visibleSegmentationLayer || globalPosition == null) return;
    // Ensure that the segment ID is loaded, since a mapping might have been activated
    // shortly before
    const segmentId = await getSegmentIdForPositionAsync(globalPosition);

    if (segmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }

    dispatch(loadPrecomputedMeshAction(segmentId, globalPosition, currentMeshFile.meshFileName));
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

    dispatch(loadAdHocMeshAction(segmentId, globalPosition));
  };

  const activeNodeId = skeletonTracing?.activeNodeId;
  const isVolumeBasedToolActive = VolumeTools.includes(activeTool);
  const isBoundingBoxToolActive = activeTool === AnnotationToolEnum.BOUNDING_BOX;
  const skeletonActions =
    skeletonTracing != null && globalPosition != null && allowUpdate
      ? [
          <Menu.Item key="create-node" onClick={() => setWaypoint(globalPosition, viewport, false)}>
            Create Node here
          </Menu.Item>,
          <Menu.Item
            key="create-node-with-tree"
            onClick={() => {
              createTree();
              setWaypoint(globalPosition, viewport, false);
            }}
          >
            Create new Tree here{" "}
            {!isVolumeBasedToolActive && !isBoundingBoxToolActive ? shortcutBuilder(["C"]) : null}
          </Menu.Item>,
          <Menu.Item
            key="load-agglomerate-skeleton"
            disabled={!isAgglomerateMappingEnabled.value}
            onClick={() => loadAgglomerateSkeletonAtPosition(globalPosition)}
          >
            {isAgglomerateMappingEnabled.value ? (
              <span>Import Agglomerate Skeleton {shortcutBuilder(["SHIFT", "middleMouse"])}</span>
            ) : (
              <Tooltip title={isAgglomerateMappingEnabled.reason}>
                <span>Import Agglomerate Skeleton {shortcutBuilder(["SHIFT", "middleMouse"])}</span>
              </Tooltip>
            )}
          </Menu.Item>,
          isAgglomerateMappingEnabled.value ? (
            <Menu.Item
              key="merge-agglomerate-skeleton"
              disabled={activeNodeId == null}
              onClick={() => Store.dispatch(proofreadMerge(globalPosition))}
            >
              {activeNodeId != null ? (
                <span>Merge with active segment</span>
              ) : (
                <Tooltip title={"Cannot merge because there's no active node id."}>
                  <span>Merge with active segment</span>
                </Tooltip>
              )}
            </Menu.Item>
          ) : null,
          isAgglomerateMappingEnabled.value ? (
            <Menu.Item
              key="min-cut-agglomerate-at-position"
              disabled={activeNodeId == null}
              onClick={() =>
                activeNodeId &&
                Store.dispatch(minCutAgglomerateWithPositionAction(activeNodeId, globalPosition))
              }
            >
              {activeNodeId != null ? (
                <span>Split from active segment (Min-Cut)</span>
              ) : (
                <Tooltip title={"Cannot split because there's no active node id."}>
                  <span>Split from active segment (Min-Cut)</span>
                </Tooltip>
              )}
            </Menu.Item>
          ) : null,
        ]
      : [];
  const segmentationLayerName =
    visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null;

  if (visibleSegmentationLayer != null && globalPosition != null) {
    const connectomeFileMappingName =
      currentConnectomeFile != null ? currentConnectomeFile.mappingName : undefined;
    const loadSynapsesItem = (
      <MenuItemWithMappingActivationConfirmation
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: string | Element; className: str... Remove this comment to see the full error message
        className="node-context-menu-item"
        key="load-synapses"
        disabled={!isConnectomeMappingEnabled.value}
        onClick={() => loadSynapsesOfAgglomerateAtPosition(globalPosition)}
        mappingName={connectomeFileMappingName}
        descriptor="connectome file"
        layerName={segmentationLayerName}
        mappingInfo={mappingInfo}
      >
        {isConnectomeMappingEnabled.value ? (
          "Import Agglomerate and Synapses"
        ) : (
          <Tooltip title={isConnectomeMappingEnabled.reason}>
            Import Agglomerate and Synapses
          </Tooltip>
        )}
      </MenuItemWithMappingActivationConfirmation>
    );
    // This action doesn't need a skeleton tracing but is conceptually related to the "Import Agglomerate Skeleton" action
    skeletonActions.push(loadSynapsesItem);
  }

  const meshFileMappingName = currentMeshFile != null ? currentMeshFile.mappingName : undefined;
  const loadPrecomputedMeshItem = (
    <MenuItemWithMappingActivationConfirmation
      key="load-precomputed-mesh"
      onClick={loadPrecomputedMesh}
      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: string; key: string; onClick: ()... Remove this comment to see the full error message
      disabled={!currentMeshFile}
      mappingName={meshFileMappingName}
      descriptor="mesh file"
      layerName={segmentationLayerName}
      mappingInfo={mappingInfo}
    >
      Load Mesh (precomputed)
    </MenuItemWithMappingActivationConfirmation>
  );
  const computeMeshAdHocItem = (
    <Menu.Item key="compute-mesh-adhc" onClick={computeMeshAdHoc}>
      Compute Mesh (ad-hoc)
    </Menu.Item>
  );
  const nonSkeletonActions =
    volumeTracing != null && globalPosition != null
      ? [
          // Segment 0 cannot/shouldn't be made active (as this
          // would be an eraser effectively).
          segmentIdAtPosition > 0 ? (
            <Menu.Item
              key="select-cell"
              onClick={() => {
                setActiveCell(segmentIdAtPosition, globalPosition);
              }}
            >
              Select Segment ({segmentIdAtPosition}){" "}
              {isVolumeBasedToolActive ? shortcutBuilder(["Shift", "leftMouse"]) : null}
            </Menu.Item>
          ) : null,
          loadPrecomputedMeshItem,
          computeMeshAdHocItem,
          allowUpdate ? (
            <Menu.Item
              key="fill-cell"
              onClick={() => handleFloodFillFromGlobalPosition(globalPosition, viewport)}
            >
              Fill Segment (flood-fill region)
            </Menu.Item>
          ) : null,
        ]
      : [];
  const boundingBoxActions = getBoundingBoxMenuOptions(props);

  if (volumeTracing == null && visibleSegmentationLayer != null) {
    nonSkeletonActions.push(loadPrecomputedMeshItem);
    nonSkeletonActions.push(computeMeshAdHocItem);
  }

  const isSkeletonToolActive = activeTool === AnnotationToolEnum.SKELETON;
  let allActions: Array<JSX.Element | null> = [];

  if (isSkeletonToolActive) {
    allActions = skeletonActions.concat(nonSkeletonActions).concat(boundingBoxActions);
  } else if (isBoundingBoxToolActive) {
    allActions = boundingBoxActions.concat(nonSkeletonActions).concat(skeletonActions);
  } else {
    allActions = nonSkeletonActions.concat(skeletonActions).concat(boundingBoxActions);
  }

  const empty = (
    <Menu.Item key="empty">
      <Empty description="No actions available" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    </Menu.Item>
  );

  return (
    <Menu
      onClick={hideContextMenu}
      style={{
        borderRadius: 6,
      }}
      mode="vertical"
    >
      {allActions.length + infoRows.length > 0 ? [...allActions, ...infoRows] : [empty]}
    </Menu>
  );
}

function ContextMenuContainer(props: Props) {
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
            position: "sticky",
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
        <ContextMenuInner {...props} inputRef={inputRef} />
      </div>
    </React.Fragment>
  );
}

function ContextMenuInner(propsWithInputRef: PropsWithRef) {
  const { inputRef, ...props } = propsWithInputRef;
  const {
    skeletonTracing,
    maybeClickedNodeId,
    contextMenuPosition,
    hideContextMenu,
    datasetScale,
    globalPosition,
    maybeViewport,
  } = props;
  let overlay = <div />;

  if (contextMenuPosition != null && maybeViewport != null) {
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

    const positionToMeasureDistanceTo =
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'never'... Remove this comment to see the full error message
      nodeContextMenuNode != null ? nodeContextMenuNode.position : globalPosition;
    const activeNode =
      activeNodeId != null && skeletonTracing != null
        ? getNodeAndTree(skeletonTracing, activeNodeId, activeTreeId).get()[1]
        : null;
    const distanceToSelection =
      activeNode != null && positionToMeasureDistanceTo != null
        ? [
            formatNumberToLength(
              V3.scaledDist(activeNode.position, positionToMeasureDistanceTo, datasetScale),
            ),
            formatLengthAsVx(V3.length(V3.sub(activeNode.position, positionToMeasureDistanceTo))),
          ]
        : null;
    const nodePositionAsString =
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'never'... Remove this comment to see the full error message
      nodeContextMenuNode != null ? positionToString(nodeContextMenuNode.position) : "";
    const segmentIdAtPosition =
      globalPosition != null ? getSegmentIdForPosition(globalPosition) : 0;
    const infoRows = [];

    if (maybeClickedNodeId != null && nodeContextMenuTree != null) {
      infoRows.push(
        <div key="nodeInfo" className="node-context-menu-item">
          {/* @ts-expect-error ts-migrate(2339) FIXME: Property 'treeId' does not exist on type 'never'.*/}
          Node with Id {maybeClickedNodeId} in Tree {nodeContextMenuTree.treeId}
        </div>,
      );
    }

    if (nodeContextMenuNode != null) {
      infoRows.push(
        <div key="positionInfo" className="node-context-menu-item">
          Position: {nodePositionAsString}
          {copyIconWithTooltip(nodePositionAsString, "Copy node position")}
        </div>,
      );
    } else if (globalPosition != null) {
      const positionAsString = positionToString(globalPosition);
      infoRows.push(
        <div key="positionInfo" className="node-context-menu-item">
          Position: {positionAsString}
          {copyIconWithTooltip(positionAsString, "Copy position")}
        </div>,
      );
    }

    if (distanceToSelection != null) {
      infoRows.push(
        <div key="distanceInfo" className="node-context-menu-item">
          <i className="fas fa-ruler" /> {distanceToSelection[0]} ({distanceToSelection[1]}) to this{" "}
          {maybeClickedNodeId != null ? "Node" : "Position"}
          {copyIconWithTooltip(distanceToSelection[0], "Copy the distance")}
        </div>,
      );
    }

    if (segmentIdAtPosition > 0) {
      infoRows.push(
        <div key="copy-cell" className="node-context-menu-item">
          <div className="cell-context-icon" />
          Segment ID: {`${segmentIdAtPosition}`}{" "}
          {copyIconWithTooltip(segmentIdAtPosition, "Copy Segment ID")}
        </div>,
      );
    }

    if (infoRows.length > 0) {
      infoRows.unshift(
        <Menu.Divider
          key="divider"
          className="hide-if-first hide-if-last"
          style={{
            margin: "4px 0px",
          }}
        />,
      );
    }

    // It's important to not use <NodeContextMenuOptions ...>
    // or <NoNodeContextMenuOptions ... />
    // for the following two expressions, since this breaks
    // antd's internal population of the correct class names
    // for the menu.
    overlay =
      maybeClickedNodeId != null
        ? NodeContextMenuOptions({
            clickedNodeId: maybeClickedNodeId,
            infoRows,
            viewport: maybeViewport,
            ...props,
          })
        : NoNodeContextMenuOptions({
            segmentIdAtPosition,
            infoRows,
            viewport: maybeViewport,
            ...props,
          });
  }
  if (inputRef == null || inputRef.current == null) return null;
  const refContent = inputRef.current;

  return (
    <React.Fragment>
      <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
      <Dropdown
        overlay={overlay}
        overlayClassName="dropdown-overlay-container-for-context-menu"
        visible={contextMenuPosition != null}
        getPopupContainer={() => refContent}
        // @ts-ignore
        destroyPopupOnHide
      >
        <div />
      </Dropdown>
    </React.Fragment>
  );
}

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  deleteEdge(firstNodeId: number, secondNodeId: number) {
    dispatch(deleteEdgeAction(firstNodeId, secondNodeId));
  },

  mergeTrees(sourceNodeId: number, targetNodeId: number) {
    dispatch(mergeTreesAction(sourceNodeId, targetNodeId));
  },

  minCutAgglomerate(sourceNodeId: number, targetNodeId: number) {
    dispatch(minCutAgglomerateAction(sourceNodeId, targetNodeId));
  },

  deleteNode(nodeId: number, treeId: number) {
    dispatch(deleteNodeAction(nodeId, treeId));
  },

  createBranchPoint(nodeId: number, treeId: number) {
    dispatch(createBranchPointAction(nodeId, treeId));
  },

  addTreesAndGroups(treeMap: MutableTreeMap) {
    dispatch(addTreesAndGroupsAction(treeMap, null));
  },

  deleteBranchpointById(nodeId: number, treeId: number) {
    dispatch(deleteBranchpointByIdAction(nodeId, treeId));
  },

  setActiveNode(nodeId: number) {
    dispatch(setActiveNodeAction(nodeId));
  },

  hideTree(treeId: number) {
    dispatch(setTreeVisibilityAction(treeId, false));
  },

  createTree() {
    dispatch(createTreeAction());
  },

  setActiveCell(segmentId: number, somePosition?: Vector3) {
    dispatch(setActiveCellAction(segmentId, somePosition));
  },

  addNewBoundingBox(center: Vector3) {
    dispatch(addUserBoundingBoxAction(null, center));
  },

  setBoundingBoxName(id: number, name: string) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        name,
      }),
    );
  },

  setBoundingBoxColor(id: number, color: Vector3) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        color,
      }),
    );
  },

  deleteBoundingBox(id: number) {
    dispatch(deleteUserBoundingBoxAction(id));
  },

  hideBoundingBox(id: number) {
    dispatch(
      changeUserBoundingBoxAction(id, {
        isVisible: false,
      }),
    );
  },
});

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
    visibleSegmentationLayer: getVisibleSegmentationLayer(state),
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
    mappingInfo,
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(ContextMenuContainer);
