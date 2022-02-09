// @flow
import { CopyOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { Dropdown, Menu, notification, Tooltip, Popover, Input } from "antd";
import { connect, useDispatch, useSelector } from "react-redux";
import React, { useEffect, type Node } from "react";

import type { APIDataset, APIDataLayer, APIMeshFile } from "types/api_flow_types";
import type {
  ActiveMappingInfo,
  OxalisState,
  SkeletonTracing,
  UserBoundingBox,
  VolumeTracing,
} from "oxalis/store";
import {
  type AnnotationTool,
  AnnotationToolEnum,
  type Vector3,
  type OrthoView,
  VolumeTools,
} from "oxalis/constants";
import { V3 } from "libs/mjs";
import {
  addUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
  changeUserBoundingBoxAction,
} from "oxalis/model/actions/annotation_actions";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import {
  deleteEdgeAction,
  mergeTreesAction,
  deleteNodeAction,
  setActiveNodeAction,
  createTreeAction,
  setTreeVisibilityAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import { getActiveSegmentationTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { getNodeAndTree, findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import {
  getSegmentIdForPosition,
  handleFloodFillFromGlobalPosition,
} from "oxalis/controller/combinations/volume_handlers";
import {
  getVisibleSegmentationLayer,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  hasAgglomerateMapping,
  loadAgglomerateSkeletonAtPosition,
} from "oxalis/controller/combinations/segmentation_handlers";
import { isBoundingBoxUsableForMinCut } from "oxalis/model/sagas/min_cut_saga";
import {
  loadMeshFromFile,
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
import Model from "oxalis/model";
import Shortcut from "libs/shortcut_component";
import Toast from "libs/toast";
import api from "oxalis/api/internal_api";
import messages from "messages";

const { SubMenu } = Menu;

/* eslint-disable react/no-unused-prop-types */
// The newest eslint version thinks the props listed below aren't used.
type OwnProps = {|
  contextMenuPosition: ?[number, number],
  maybeClickedNodeId: ?number,
  clickedBoundingBoxId: ?number,
  globalPosition: Vector3,
  maybeViewport: ?OrthoView,
  hideContextMenu: () => void,
|};

type DispatchProps = {|
  deleteEdge: (number, number) => void,
  mergeTrees: (number, number) => void,
  deleteNode: (number, number) => void,
  setActiveNode: number => void,
  hideTree: number => void,
  createTree: () => void,
  hideBoundingBox: number => void,
  setActiveCell: number => void,
  addNewBoundingBox: Vector3 => void,
  setBoundingBoxColor: (number, Vector3) => void,
  setBoundingBoxName: (number, string) => void,
  addNewBoundingBox: Vector3 => void,
  deleteBoundingBox: number => void,
  setActiveCell: (number, somePosition?: Vector3) => void,
|};

type StateProps = {|
  skeletonTracing: ?SkeletonTracing,
  datasetScale: Vector3,
  visibleSegmentationLayer: ?APIDataLayer,
  dataset: APIDataset,
  zoomStep: number,
  currentMeshFile: ?APIMeshFile,
  volumeTracing: ?VolumeTracing,
  activeTool: AnnotationTool,
  useLegacyBindings: boolean,
  userBoundingBoxes: Array<UserBoundingBox>,
  mappingInfo: ActiveMappingInfo,
|};

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};
type PropsWithRef = {| ...Props, inputRef: React$ElementRef<*> |};
type NodeContextMenuOptionsProps = {|
  ...Props,
  viewport: OrthoView,
  clickedNodeId: number,
  infoRows: Array<React$Node>,
|};
/* eslint-enable react/no-unused-prop-types */
type NoNodeContextMenuProps = {|
  ...Props,
  viewport: OrthoView,
  segmentIdAtPosition: number,
  activeTool: AnnotationTool,
  infoRows: Array<React$Node>,
|};

const MenuItemWithMappingActivationConfirmation = withMappingActivationConfirmation(Menu.Item);

function copyIconWithTooltip(value: string | number, title: string) {
  return (
    <Tooltip title={title}>
      <CopyOutlined
        style={{ margin: "0 0 0 5px" }}
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

function getMaybeHoveredCellMenuItem(globalPosition: Vector3) {
  const hoveredCellInfo = Model.getHoveredCellId(globalPosition);
  if (!hoveredCellInfo) {
    return null;
  }
  const cellIdAsString = hoveredCellInfo.isMapped
    ? `${hoveredCellInfo.id} (mapped)`
    : hoveredCellInfo.id;

  return (
    <div key="hovered-info" className="node-context-menu-item">
      <i className="fas fa-ruler" /> Hovered Segment: {cellIdAsString}
      {copyIconWithTooltip(
        hoveredCellInfo.id,
        `Copy ${hoveredCellInfo.isMapped ? "mapped" : ""} segment id`,
      )}
    </div>
  );
}

function positionToString(pos: Vector3): string {
  return pos.map(value => roundTo(value, 2)).join(", ");
}

function shortcutBuilder(shortcuts: Array<string>): Node {
  const lineColor = "var(--ant-text-secondary)";
  const mapNameToShortcutIcon = (name: string) => {
    switch (name) {
      case "leftMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-left.svg"
            alt="Mouse Left Click"
            style={{ margin: 0 }}
          />
        );
      }
      case "rightMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-right.svg"
            alt="Mouse Right Click"
            style={{ margin: 0 }}
          />
        );
      }
      case "middleMouse": {
        return (
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-wheel.svg"
            alt="Mouse Wheel"
            style={{ margin: 0 }}
          />
        );
      }
      default: {
        return (
          <span className="keyboard-key-icon-small" style={{ borderColor: lineColor }}>
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span style={{ position: "relative", top: -9 }}>{name}</span>
          </span>
        );
      }
    }
  };
  return (
    <span style={{ float: "right", color: lineColor, marginLeft: 10 }}>
      {shortcuts.map((name, index) => (
        <React.Fragment key={name}>
          {mapNameToShortcutIcon(name)}
          {index < shortcuts.length - 1 ? " + " : null}
        </React.Fragment>
      ))}
    </span>
  );
}

function getMaybeMinCutItem(clickedTree, volumeTracing, userBoundingBoxes, dispatch) {
  const seeds = Array.from(clickedTree.nodes.values());
  if (volumeTracing == null || seeds.length !== 2) {
    return null;
  }

  return (
    <SubMenu
      key="min-cut"
      title="Perform Min-Cut (Experimental)"
      // For some reason, antd doesn't pass the ant-dropdown class to the
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
          Create new bounding box
        </Menu.Item>

        {userBoundingBoxes
          .filter(bbox => isBoundingBoxUsableForMinCut(bbox.boundingBox, seeds))
          .map(bbox => (
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
  deleteNode,
  setActiveNode,
  hideTree,
  useLegacyBindings,
  volumeTracing,
  infoRows,
}: NodeContextMenuOptionsProps) {
  const dispatch = useDispatch();
  if (skeletonTracing == null) {
    return null;
  }
  const { userBoundingBoxes } = skeletonTracing;
  const { activeTreeId, trees, activeNodeId } = skeletonTracing;
  const clickedTree = findTreeByNodeId(trees, clickedNodeId).get();
  const areInSameTree = activeTreeId === clickedTree.treeId;
  const isTheSameNode = activeNodeId === clickedNodeId;
  let areNodesConnected = false;
  if (areInSameTree && !isTheSameNode && activeNodeId != null) {
    const activeTreeEdges = clickedTree.edges.getEdgesForNode(activeNodeId);
    areNodesConnected = activeTreeEdges.some(
      edge => edge.source === clickedNodeId || edge.target === clickedNodeId,
    );
  }
  return (
    <Menu onClick={hideContextMenu} style={{ borderRadius: 6 }} mode="vertical">
      <Menu.Item
        key="set-node-active"
        disabled={isTheSameNode}
        onClick={() => setActiveNode(clickedNodeId)}
      >
        Select this Node
      </Menu.Item>
      {getMaybeMinCutItem(clickedTree, volumeTracing, userBoundingBoxes, dispatch)}
      <Menu.Item
        key="merge-trees"
        disabled={areInSameTree}
        onClick={() => (activeNodeId != null ? mergeTrees(clickedNodeId, activeNodeId) : null)}
      >
        Create Edge & Merge with this Tree{" "}
        {useLegacyBindings ? shortcutBuilder(["Shift", "Alt", "leftMouse"]) : null}
      </Menu.Item>
      <Menu.Item
        key="delete-edge"
        disabled={!areNodesConnected}
        onClick={() => (activeNodeId != null ? deleteEdge(activeNodeId, clickedNodeId) : null)}
      >
        Delete Edge to this Node{" "}
        {useLegacyBindings ? shortcutBuilder(["Shift", "Ctrl", "leftMouse"]) : null}
      </Menu.Item>
      <Menu.Item key="delete-node" onClick={() => deleteNode(clickedNodeId, clickedTree.treeId)}>
        Delete this Node {activeNodeId === clickedNodeId ? shortcutBuilder(["Del"]) : null}
      </Menu.Item>
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
      <Menu.Item key="hide-tree" onClick={() => hideTree(clickedTree.treeId)}>
        Hide this Tree
      </Menu.Item>
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
}: NoNodeContextMenuProps) {
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
  if (clickedBoundingBoxId == null) {
    return [newBoundingBoxMenuItem];
  }
  const hoveredBBox = userBoundingBoxes.find(bbox => bbox.id === clickedBoundingBoxId);
  if (hoveredBBox == null) {
    return [newBoundingBoxMenuItem];
  }
  const setBBoxName = (evt: SyntheticInputEvent<>) => {
    setBoundingBoxName(clickedBoundingBoxId, evt.target.value);
  };
  const preventContextMenuFromClosing = evt => {
    evt.stopPropagation();
  };
  const upscaledBBoxColor = ((hoveredBBox.color.map(colorPart => colorPart * 255): any): Vector3);
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
            onPressEnter={evt => {
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
          style={{ width: "100%", display: "inline-block" }}
        >
          Change Bounding Box Name
        </span>
      </Popover>
    </Menu.Item>,
    <Menu.Item key="change-bounding-box-color">
      <span
        onClick={preventContextMenuFromClosing}
        style={{ width: "100%", display: "inline-block", position: "relative" }}
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
          onChange={(evt: SyntheticInputEvent<>) => {
            let color = hexToRgb(evt.target.value);
            color = ((color.map(colorPart => colorPart / 255): any): Vector3);
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

function NoNodeContextMenuOptions(props: NoNodeContextMenuProps) {
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
    hideContextMenu,
    setActiveCell,
    mappingInfo,
    zoomStep,
    infoRows,
  } = props;

  const dispatch = useDispatch();
  const isAgglomerateMappingEnabled = useSelector(hasAgglomerateMapping);
  useEffect(() => {
    (async () => {
      await maybeFetchMeshFiles(visibleSegmentationLayer, dataset, false);
    })();
  }, [visibleSegmentationLayer, dataset]);

  const loadPrecomputedMesh = async () => {
    if (!currentMeshFile) return;

    if (visibleSegmentationLayer) {
      // Make sure the corresponding bucket is loaded
      await api.data.getDataValue(visibleSegmentationLayer.name, globalPosition, zoomStep);
      const id = getSegmentIdForPosition(globalPosition);
      if (id === 0) {
        Toast.info("No segment found at the clicked position");
        return;
      }

      await loadMeshFromFile(
        id,
        globalPosition,
        currentMeshFile.meshFileName,
        visibleSegmentationLayer,
        dataset,
      );
    }
  };

  const computeMeshAdHoc = () => {
    if (!visibleSegmentationLayer) {
      return;
    }
    const id = getSegmentIdForPosition(globalPosition);
    if (id === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }
    dispatch(changeActiveIsosurfaceCellAction(id, globalPosition, true));
  };

  const isVolumeBasedToolActive = VolumeTools.includes(activeTool);
  const isBoundingBoxToolActive = activeTool === AnnotationToolEnum.BOUNDING_BOX;

  const skeletonActions =
    skeletonTracing != null
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
              <Tooltip title="Requires an active ID Mapping">
                <span>Import Agglomerate Skeleton {shortcutBuilder(["SHIFT", "middleMouse"])}</span>
              </Tooltip>
            )}
          </Menu.Item>,
        ]
      : [];

  const layerName = visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null;
  const loadPrecomputedMeshItem = (
    <MenuItemWithMappingActivationConfirmation
      key="load-precomputed-mesh"
      onClick={loadPrecomputedMesh}
      disabled={!currentMeshFile}
      currentMeshFile={currentMeshFile}
      layerName={layerName}
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
    volumeTracing != null
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
          <Menu.Item
            key="fill-cell"
            onClick={() => handleFloodFillFromGlobalPosition(globalPosition, viewport)}
          >
            Fill Segment (flood-fill region)
          </Menu.Item>,
        ]
      : [];

  const boundingBoxActions = getBoundingBoxMenuOptions(props);

  if (volumeTracing == null && visibleSegmentationLayer != null) {
    nonSkeletonActions.push(loadPrecomputedMeshItem);
    nonSkeletonActions.push(computeMeshAdHocItem);
  }
  const isSkeletonToolActive = activeTool === AnnotationToolEnum.SKELETON;
  let allActions = [];
  if (isSkeletonToolActive) {
    allActions = skeletonActions.concat(nonSkeletonActions).concat(boundingBoxActions);
  } else if (isBoundingBoxToolActive) {
    allActions = boundingBoxActions.concat(nonSkeletonActions).concat(skeletonActions);
  } else {
    allActions = nonSkeletonActions.concat(skeletonActions).concat(boundingBoxActions);
  }

  if (allActions.length === 0) {
    return null;
  }

  return (
    <Menu onClick={hideContextMenu} style={{ borderRadius: 6 }} mode="vertical">
      {allActions}
      {infoRows}
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

  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (inputRef.current != null) {
      inputRef.current.focus();
    }
  }, [inputRef.current]);

  const { contextMenuPosition, hideContextMenu } = props;

  return (
    <>
      <React.Fragment>
        <div
          className="node-context-menu-overlay"
          onClick={hideContextMenu}
          onContextMenu={evt => {
            evt.preventDefault();
            hideContextMenu();
          }}
          style={{ display: contextMenuPosition == null ? "none" : "inherit" }}
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
            ref={inputRef}
          />
          <ContextMenuInner {...props} inputRef={inputRef} />
        </div>
      </React.Fragment>
    </>
  );
}

function ContextMenuInner(propsWithInputRef: PropsWithRef) {
  const { inputRef, ...props } = propsWithInputRef;
  const {
    skeletonTracing,
    activeTool,
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
    const activeNodeId = skeletonTracing != null ? skeletonTracing.activeNodeId : null;

    let nodeContextMenuTree = null;
    let nodeContextMenuNode = null;
    if (skeletonTracing != null && maybeClickedNodeId != null) {
      getNodeAndTree(skeletonTracing, maybeClickedNodeId).map(([tree, node]) => {
        nodeContextMenuNode = node;
        nodeContextMenuTree = tree;
      });
    }
    const positionToMeasureDistanceTo =
      nodeContextMenuNode != null ? nodeContextMenuNode.position : globalPosition;
    const activeNode =
      activeNodeId != null && skeletonTracing != null
        ? getNodeAndTree(skeletonTracing, activeNodeId, activeTreeId).get()[1]
        : null;
    const distanceToSelection =
      activeNode != null
        ? [
            formatNumberToLength(
              V3.scaledDist(activeNode.position, positionToMeasureDistanceTo, datasetScale),
            ),
            formatLengthAsVx(V3.length(V3.sub(activeNode.position, positionToMeasureDistanceTo))),
          ]
        : null;
    const nodePositionAsString =
      nodeContextMenuNode != null ? positionToString(nodeContextMenuNode.position) : "";

    const segmentIdAtPosition = getSegmentIdForPosition(globalPosition);

    const infoRows = [];

    if (maybeClickedNodeId != null && nodeContextMenuTree != null) {
      infoRows.push(
        <div key="nodeInfo" className="node-context-menu-item">
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
    } else {
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
          <div className="cell-context-icon" alt="Segment Icon" />
          Segment ID: {segmentIdAtPosition}{" "}
          {copyIconWithTooltip(segmentIdAtPosition, "Copy Segment ID")}
        </div>,
      );
    }

    const maybeHoveredCellMenuItem = getMaybeHoveredCellMenuItem(globalPosition);
    if (!maybeHoveredCellMenuItem) {
      infoRows.push(maybeHoveredCellMenuItem);
    }

    infoRows.unshift(
      <Menu.Divider
        key="divider"
        className="hide-if-first hide-if-last"
        style={{ margin: "4px 0px" }}
      />,
    );

    overlay =
      maybeClickedNodeId != null
        ? NodeContextMenuOptions({
            clickedNodeId: maybeClickedNodeId,
            infoRows,
            viewport: maybeViewport,
            ...props,
          })
        : NoNodeContextMenuOptions({
            activeTool,
            segmentIdAtPosition,
            infoRows,
            viewport: maybeViewport,
            ...props,
          });
  }

  return (
    <React.Fragment>
      {inputRef != null ? (
        <>
          <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
          <Dropdown
            overlay={overlay}
            overlayClassName="dropdown-overlay-container-for-context-menu"
            visible={contextMenuPosition != null}
            getPopupContainer={() => inputRef.current}
            destroyPopupOnHide
          >
            <div />
          </Dropdown>
        </>
      ) : null}
    </React.Fragment>
  );
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  deleteEdge(firstNodeId: number, secondNodeId: number) {
    dispatch(deleteEdgeAction(firstNodeId, secondNodeId));
  },
  mergeTrees(sourceNodeId: number, targetNodeId: number) {
    dispatch(mergeTreesAction(sourceNodeId, targetNodeId));
  },
  deleteNode(nodeId: number, treeId: number) {
    dispatch(deleteNodeAction(nodeId, treeId));
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
    dispatch(changeUserBoundingBoxAction(id, { name }));
  },
  setBoundingBoxColor(id: number, color: Vector3) {
    dispatch(changeUserBoundingBoxAction(id, { color }));
  },
  deleteBoundingBox(id: number) {
    dispatch(deleteUserBoundingBoxAction(id));
  },
  hideBoundingBox(id: number) {
    dispatch(changeUserBoundingBoxAction(id, { isVisible: false }));
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
    visibleSegmentationLayer: getVisibleSegmentationLayer(state),
    zoomStep: getRequestLogZoomStep(state),
    currentMeshFile:
      visibleSegmentationLayer != null
        ? state.localSegmentationData[visibleSegmentationLayer.name].currentMeshFile
        : null,
    useLegacyBindings: state.userConfiguration.useLegacyBindings,
    userBoundingBoxes: someTracing != null ? someTracing.userBoundingBoxes : [],
    mappingInfo,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(ContextMenuContainer);
