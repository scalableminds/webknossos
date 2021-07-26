// @flow
import React, { useEffect } from "react";
import { Menu, notification, Divider, Tooltip } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { AnnotationToolEnum } from "oxalis/constants";
import type { Vector3, OrthoView } from "oxalis/constants";
import type { OxalisState, SkeletonTracing, VolumeTracing } from "oxalis/store";
import type { APIDataset, APIDataLayer } from "types/api_flow_types";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { V3 } from "libs/mjs";
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
import { handleFloodFillFromGlobalPosition } from "oxalis/controller/combinations/volume_handlers";
import {
  loadMeshFromFile,
  maybeFetchMeshFiles,
  getSegmentIdForPosition,
} from "oxalis/view/right-border-tabs/meshes_view_helper";
import Model from "oxalis/model";
import api from "oxalis/api/internal_api";
import Toast from "libs/toast";
import Clipboard from "clipboard-js";
import messages from "messages";
import { getSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { getNodeAndTree, findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import { roundTo } from "libs/utils";

import Shortcut from "libs/shortcut_component";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";

/* eslint-disable react/no-unused-prop-types */
// The newest eslint version thinks the props listed below aren't used.
type OwnProps = {|
  contextMenuPosition: [number, number],
  clickedNodeId: ?number,
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
  setActiveCell: number => void,
|};

type StateProps = {|
  skeletonTracing: ?SkeletonTracing,
  datasetScale: Vector3,
  segmentationLayer: ?APIDataLayer,
  dataset: APIDataset,
  zoomStep: number,
  currentMeshFile: ?string,
  volumeTracing: ?VolumeTracing,
  isSkeletonToolActive: boolean,
|};

/* eslint-enable react/no-unused-prop-types */

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};
type NodeContextMenuOptionsProps = {| ...Props, clickedNodeId: number |};
type NoNodeContextMenuProps = {|
  ...Props,
  segmentIdAtPosition: number,
  isSkeletonToolActive: boolean,
|};

function copyIconWithTooltip(value: string | number, title: string) {
  return (
    <Tooltip title={title}>
      <CopyOutlined
        style={{ margin: "0 0 0 5px" }}
        onClick={async () => {
          await Clipboard.copy(value);
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

function NodeContextMenuOptions({
  skeletonTracing,
  clickedNodeId,
  hideContextMenu,
  deleteEdge,
  mergeTrees,
  deleteNode,
  setActiveNode,
  hideTree,
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
        Create Edge & Merge with this Tree
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="delete-edge"
        disabled={!areNodesConnected}
        onClick={() => (activeNodeId != null ? deleteEdge(activeNodeId, clickedNodeId) : null)}
      >
        Delete Edge to this Node
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="delete-node"
        onClick={() => deleteNode(clickedNodeId, clickedTree.treeId)}
      >
        Delete this Node
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

function NoNodeContextMenuOptions({
  skeletonTracing,
  volumeTracing,
  isSkeletonToolActive,
  hideContextMenu,
  globalPosition,
  viewport,
  createTree,
  segmentIdAtPosition,
  segmentationLayer,
  dataset,
  currentMeshFile,
  setActiveCell,
}: NoNodeContextMenuProps) {
  useEffect(() => {
    (async () => {
      await maybeFetchMeshFiles(segmentationLayer, dataset, false);
    })();
  }, []);

  const loadMesh = async () => {
    if (!currentMeshFile) return;

    if (segmentationLayer) {
      const id = getSegmentIdForPosition(globalPosition);
      if (id === 0) {
        Toast.info("No segment found at the clicked position");
        return;
      }
      await loadMeshFromFile(id, globalPosition, currentMeshFile, segmentationLayer, dataset);
    }
  };

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
            Create new Tree here
          </Menu.Item>,
        ]
      : [];

  const loadMeshItem = (
    <Menu.Item
      className="node-context-menu-item"
      key="load-mesh-file"
      onClick={loadMesh}
      disabled={!currentMeshFile}
    >
      Load Precomputed Mesh
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
                setActiveCell(segmentIdAtPosition);
              }}
            >
              Select Segment ({segmentIdAtPosition})
            </Menu.Item>
          ) : null,
          loadMeshItem,
          <Menu.Item
            className="node-context-menu-item"
            key="fill-cell"
            onClick={() => handleFloodFillFromGlobalPosition(globalPosition, viewport)}
          >
            Fill Segment (flood-fill region)
          </Menu.Item>,
        ]
      : [];
  if (volumeTracing == null && segmentationLayer != null) {
    nonSkeletonActions.push(loadMeshItem);
  }

  const allActions = isSkeletonToolActive
    ? skeletonActions.concat(nonSkeletonActions)
    : nonSkeletonActions.concat(skeletonActions);

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
    isSkeletonToolActive,
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
    nodeContextMenuNode != null
      ? nodeContextMenuNode.position.map(value => roundTo(value, 2)).join(", ")
      : "";

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
        style={{
          position: "absolute",
          left: contextMenuPosition[0],
          top: contextMenuPosition[1],
        }}
        className="node-context-menu"
        tabIndex={-1}
        onBlur={hideContextMenu}
        ref={inputRef}
      >
        <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />
        {clickedNodeId != null
          ? NodeContextMenuOptions({ ...props, clickedNodeId })
          : NoNodeContextMenuOptions({ isSkeletonToolActive, segmentIdAtPosition, ...props })}

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
  setActiveCell(segmentId: number) {
    dispatch(setActiveCellAction(segmentId));
  },
});

function mapStateToProps(state: OxalisState): StateProps {
  return {
    skeletonTracing: state.tracing.skeleton,
    volumeTracing: state.tracing.volume,
    datasetScale: state.dataset.dataSource.scale,
    isSkeletonToolActive: state.uiInformation.activeTool === AnnotationToolEnum.SKELETON,
    dataset: state.dataset,
    segmentationLayer: getSegmentationLayer(state.dataset),
    zoomStep: getRequestLogZoomStep(state),
    currentMeshFile: state.currentMeshFile,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(ContextMenu);
