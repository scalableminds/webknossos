// @flow
import React, { useEffect, type Node } from "react";
import { Menu, notification, Divider, Tooltip, Popover, Input } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import {
  type AnnotationTool,
  AnnotationToolEnum,
  type Vector3,
  type OrthoView,
  VolumeTools,
} from "oxalis/constants";

import type { OxalisState, SkeletonTracing, VolumeTracing, ActiveMappingInfo } from "oxalis/store";
import type { APIDataset, APIDataLayer, APIMeshFile } from "types/api_flow_types";
import { maybeGetSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import type { Dispatch } from "redux";
import { connect, useDispatch } from "react-redux";
import { V3 } from "libs/mjs";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import {
  addUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
  changeUserBoundingBoxAction,
} from "oxalis/model/actions/annotation_actions";
import { type UserBoundingBox } from "oxalis/store";
import {
  deleteEdgeAction,
  mergeTreesAction,
  deleteNodeAction,
  setActiveNodeAction,
  createTreeAction,
  setTreeVisibilityAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setWaypoint } from "oxalis/controller/combinations/skeleton_handlers";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import {
  getSegmentIdForPosition,
  handleFloodFillFromGlobalPosition,
} from "oxalis/controller/combinations/volume_handlers";
import {
  loadMeshFromFile,
  maybeFetchMeshFiles,
  withMappingActivationConfirmation,
} from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import Model from "oxalis/model";
import api from "oxalis/api/internal_api";
import Toast from "libs/toast";
import messages from "messages";
import {
  getVisibleSegmentationLayer,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { getNodeAndTree, findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import { roundTo, hexToRgb, rgbToHex } from "libs/utils";

import Shortcut from "libs/shortcut_component";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";

/* eslint-disable react/no-unused-prop-types */
// The newest eslint version thinks the props listed below aren't used.
type OwnProps = {|
  contextMenuPosition: [number, number],
  clickedNodeId: ?number,
  clickedBoundingBoxId: ?number,
  globalPosition: Vector3,
  viewport: OrthoView,
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

/* eslint-enable react/no-unused-prop-types */

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};
type NodeContextMenuOptionsProps = {| ...Props, clickedNodeId: number |};
type NoNodeContextMenuProps = {|
  ...Props,
  segmentIdAtPosition: number,
  activeTool: AnnotationTool,
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
    <div className="node-context-menu-item">
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
}: NodeContextMenuOptionsProps) {
  if (skeletonTracing == null) {
    return null;
  }
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
        className="node-context-menu-item"
        key="set-node-active"
        disabled={isTheSameNode}
        onClick={() => setActiveNode(clickedNodeId)}
      >
        Select this Node
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="merge-trees"
        disabled={areInSameTree}
        onClick={() => (activeNodeId != null ? mergeTrees(clickedNodeId, activeNodeId) : null)}
      >
        Create Edge & Merge with this Tree{" "}
        {useLegacyBindings ? shortcutBuilder(["Shift", "Alt", "leftMouse"]) : null}
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="delete-edge"
        disabled={!areNodesConnected}
        onClick={() => (activeNodeId != null ? deleteEdge(activeNodeId, clickedNodeId) : null)}
      >
        Delete Edge to this Node{" "}
        {useLegacyBindings ? shortcutBuilder(["Shift", "Ctrl", "leftMouse"]) : null}
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="delete-node"
        onClick={() => deleteNode(clickedNodeId, clickedTree.treeId)}
      >
        Delete this Node {activeNodeId === clickedNodeId ? shortcutBuilder(["Del"]) : null}
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
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
      <Menu.Item
        className="node-context-menu-item"
        key="measure-whole-tree-length"
        onClick={() => measureAndShowFullTreeLength(clickedTree.treeId, clickedTree.name)}
      >
        Path Length of this Tree
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="hide-tree"
        onClick={() => hideTree(clickedTree.treeId)}
      >
        Hide this Tree
      </Menu.Item>
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
      className="node-context-menu-item"
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
    <Menu.Item className="node-context-menu-item" key="change-bounding-box-name">
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
    <Menu.Item className="node-context-menu-item" key="change-bounding-box-color">
      <span
        onClick={preventContextMenuFromClosing}
        style={{ width: "100%", display: "inline-block" }}
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
      className="node-context-menu-item"
      key="hide-bounding-box"
      onClick={() => {
        hideBoundingBox(clickedBoundingBoxId);
      }}
    >
      Hide Bounding Box
    </Menu.Item>,
    <Menu.Item
      className="node-context-menu-item"
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
  } = props;

  const dispatch = useDispatch();
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
          <Menu.Item
            className="node-context-menu-item"
            key="create-node"
            onClick={() => setWaypoint(globalPosition, viewport, false)}
          >
            Create Node here
          </Menu.Item>,
          <Menu.Item
            className="node-context-menu-item"
            key="create-node-with-tree"
            onClick={() => {
              createTree();
              setWaypoint(globalPosition, viewport, false);
            }}
          >
            Create new Tree here{" "}
            {!isVolumeBasedToolActive && !isBoundingBoxToolActive ? shortcutBuilder(["C"]) : null}
          </Menu.Item>,
        ]
      : [];

  const layerName = visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null;
  const loadPrecomputedMeshItem = (
    <MenuItemWithMappingActivationConfirmation
      className="node-context-menu-item"
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
    <Menu.Item
      className="node-context-menu-item"
      key="compute-mesh-adhc"
      onClick={computeMeshAdHoc}
    >
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
              className="node-context-menu-item"
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
            className="node-context-menu-item"
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
    </Menu>
  );
}

function ContextMenu(props: Props) {
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (inputRef.current != null) {
      inputRef.current.focus();
    }
  }, [inputRef.current]);

  const {
    skeletonTracing,
    activeTool,
    clickedNodeId,
    contextMenuPosition,
    hideContextMenu,
    datasetScale,
    globalPosition,
  } = props;
  const activeTreeId = skeletonTracing != null ? skeletonTracing.activeTreeId : null;
  const activeNodeId = skeletonTracing != null ? skeletonTracing.activeNodeId : null;

  let nodeContextMenuTree = null;
  let nodeContextMenuNode = null;
  if (skeletonTracing != null && clickedNodeId != null) {
    getNodeAndTree(skeletonTracing, clickedNodeId).map(([tree, node]) => {
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

  if (clickedNodeId != null && nodeContextMenuTree != null) {
    infoRows.push(
      <div key="nodeInfo" className="node-context-menu-item">
        Node with Id {clickedNodeId} in Tree {nodeContextMenuTree.treeId}
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
        {clickedNodeId != null ? "Node" : "Position"}
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

  return (
    <React.Fragment>
      <div
        className="node-context-menu-overlay"
        onClick={hideContextMenu}
        onContextMenu={evt => {
          evt.preventDefault();
          hideContextMenu();
        }}
      />
      <div
        style={{
          position: "absolute",
          left: contextMenuPosition[0],
          top: contextMenuPosition[1],
        }}
        className="node-context-menu"
        tabIndex={-1}
        ref={inputRef}
      >
        <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
        {clickedNodeId != null
          ? NodeContextMenuOptions({ ...props, clickedNodeId })
          : NoNodeContextMenuOptions({ activeTool, segmentIdAtPosition, ...props })}

        <Divider className="hide-if-first hide-if-last" style={{ margin: "4px 0px" }} />
        {infoRows}
      </div>
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
    volumeTracing: state.tracing.volume,
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
)(ContextMenu);
