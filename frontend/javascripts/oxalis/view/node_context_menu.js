// @flow
import React, { useEffect } from "react";
import { Menu, notification, Divider, Tooltip } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import type { Vector3, OrthoView } from "oxalis/constants";
import type { APIDataset, APIDataLayer } from "types/api_flow_types";
import type { OxalisState, SkeletonTracing } from "oxalis/store";
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
import { loadMeshFromFile, maybeFetchMeshFiles } from "oxalis/view/right-menu/meshes_view_helper";
import Model from "oxalis/model";
import { setWaypoint } from "oxalis/controller/combinations/skeletontracing_plane_controller";
import api from "oxalis/api/internal_api";
import Toast from "libs/toast";
import Clipboard from "clipboard-js";
import messages from "messages";
import { getSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { getNodeAndTree, findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import { roundTo } from "libs/utils";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";

/* eslint-disable react/no-unused-prop-types */
// The newest eslint version thinks the props listed below aren't used.
type OwnProps = {|
  nodeContextMenuPosition: [number, number],
  clickedNodeId: ?number,
  globalPosition: Vector3,
  viewport: OrthoView,
  hideNodeContextMenu: () => void,
|};

type DispatchProps = {|
  deleteEdge: (number, number) => void,
  mergeTrees: (number, number) => void,
  deleteNode: (number, number) => void,
  setActiveNode: number => void,
  hideTree: number => void,
  createTree: () => void,
|};

type StateProps = {|
  skeletonTracing: ?SkeletonTracing,
  datasetScale: Vector3,
  segmentationLayer: ?APIDataLayer,
  dataset: APIDataset,
  zoomStep: number,
  currentMeshFile: ?string,
|};
/* eslint-enable react/no-unused-prop-types */

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};
type NodeContextMenuOptionsProps = {| ...Props, clickedNodeId: number |};
type NoNodeContextMenuProps = {| ...Props |};

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

function NodeContextMenuOptions({
  skeletonTracing,
  clickedNodeId,
  hideNodeContextMenu,
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
    <Menu onClick={hideNodeContextMenu} style={{ borderRadius: 6 }}>
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
  hideNodeContextMenu,
  globalPosition,
  viewport,
  createTree,
  segmentationLayer,
  dataset,
  zoomStep,
  currentMeshFile,
}: NoNodeContextMenuProps) {
  useEffect(() => {
    (async () => {
      if (segmentationLayer) {
        await maybeFetchMeshFiles(segmentationLayer, dataset, false);
      }
    })();
  }, []);

  const loadMesh = async () => {
    if (!currentMeshFile) return;

    if (segmentationLayer) {
      const layer = Model.getSegmentationLayer();
      if (!layer) {
        throw new Error("No segmentation layer found");
      }
      const segmentationCube = layer.cube;
      const id = segmentationCube.getDataValue(globalPosition, null, zoomStep);

      await loadMeshFromFile(id, globalPosition, currentMeshFile, segmentationLayer, dataset);
    }
  };

  const getLoadMeshMenuItem = () => (
    <Menu.Item
      className="node-context-menu-item"
      key="load-mesh-file"
      onClick={loadMesh}
      disabled={!currentMeshFile}
    >
      Load Mesh from File
    </Menu.Item>
  );

  return (
    <Menu onClick={hideNodeContextMenu} style={{ borderRadius: 6 }} mode="vertical">
      <Menu.Item
        className="node-context-menu-item"
        key="create-node"
        onClick={() => setWaypoint(globalPosition, viewport, false)}
      >
        Create Node here (Right Click)
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="create-node-with-tree"
        onClick={() => {
          createTree();
          setWaypoint(globalPosition, viewport, false);
        }}
      >
        Create new Tree here
      </Menu.Item>
      {getLoadMeshMenuItem()}
    </Menu>
  );
}

function NodeContextMenu(props: Props) {
  const {
    skeletonTracing,
    clickedNodeId,
    nodeContextMenuPosition,
    hideNodeContextMenu,
    datasetScale,
    globalPosition,
  } = props;
  if (!skeletonTracing) {
    return null;
  }
  const { activeTreeId, activeNodeId } = skeletonTracing;
  let nodeContextMenuTree = null;
  let nodeContextMenuNode = null;
  if (clickedNodeId != null) {
    getNodeAndTree(skeletonTracing, clickedNodeId).map(([tree, node]) => {
      nodeContextMenuNode = node;
      nodeContextMenuTree = tree;
    });
  }
  const positionToMeasureDistanceTo =
    nodeContextMenuNode != null ? nodeContextMenuNode.position : globalPosition;
  const activeNode =
    activeNodeId != null
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
  return (
    <React.Fragment>
      <div className="node-context-menu-overlay" onClick={hideNodeContextMenu} />
      <div
        style={{
          position: "absolute",
          left: nodeContextMenuPosition[0],
          top: nodeContextMenuPosition[1],
        }}
        className="node-context-menu"
      >
        {clickedNodeId != null
          ? NodeContextMenuOptions({ ...props, clickedNodeId })
          : NoNodeContextMenuOptions({ ...props })}
        <Divider style={{ margin: "4px 0px" }} />
        {clickedNodeId != null && nodeContextMenuTree != null ? (
          <div className="node-context-menu-item">
            Node with Id {clickedNodeId} in Tree {nodeContextMenuTree.treeId}
          </div>
        ) : null}
        {nodeContextMenuNode != null ? (
          <div className="node-context-menu-item">
            Position: {nodePositionAsString}
            {copyIconWithTooltip(nodePositionAsString, "Copy node position")}
          </div>
        ) : null}
        {distanceToSelection != null ? (
          <div className="node-context-menu-item">
            <i className="fas fa-ruler" /> {distanceToSelection[0]} ({distanceToSelection[1]}) to
            this {clickedNodeId != null ? "Node" : "Position"}
            {copyIconWithTooltip(distanceToSelection[0], "Copy the distance")}
          </div>
        ) : null}
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
});

function mapStateToProps(state: OxalisState): StateProps {
  return {
    skeletonTracing: state.tracing.skeleton,
    datasetScale: state.dataset.dataSource.scale,
    dataset: state.dataset,
    segmentationLayer: getSegmentationLayer(state.dataset),
    zoomStep: getRequestLogZoomStep(state),
    currentMeshFile: state.currentMeshFile,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(NodeContextMenu);
