// @flow
import * as React from "react";
import { Menu, notification, Icon, Divider, Popover } from "antd";
import type { Vector3 } from "oxalis/constants";
import type { OxalisState, SkeletonTracing } from "oxalis/store";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import {
  createEdgeAction,
  deleteEdgeAction,
  mergeTreesAction,
  deleteNodeAction,
  setActiveNodeAction,
  createTreeAction,
  setTreeVisibilityAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setWaypoint } from "oxalis/controller/combinations/skeletontracing_plane_controller";
import api from "oxalis/api/internal_api";
import messages from "messages";
import { getNodeAndTree, findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";
import { formatNumberToLength } from "libs/format_utils";
import { distanceBetweenVectors } from "libs/utils";

type OwnProps = {|
  nodeContextMenuPosition: [number, number],
  nodeContextMenuNodeId: ?number,
  globalPosition: Vector3,
  rotation: Vector3,
  hideNodeContextMenu: () => void,
|};

type DispatchProps = {|
  deleteEdge: (number, number) => void,
  createEdge: (number, number) => void,
  mergeTrees: (number, number) => void,
  deleteNode: (number, number) => void,
  setActiveNode: number => void,
  hideTree: number => void,
  createTree: () => void,
|};

type StateProps = {| skeletonTracing: ?SkeletonTracing, datasetScale: Vector3 |};

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};
type NodeContextMenuOptionsProps = {| ...Props, nodeContextMenuNodeId: number |};
type NoneNodeContextMenuProps = {| ...Props |};

const NAVBAR_HEIGHT = 48;

const interactionHints = (
  <table className="table-with-borders-between-columns">
    <tbody>
      <tr>
        <td>SHIFT + Mousewheel</td>
        <td>Change Active Node Radius</td>
      </tr>
      <tr>
        <td>CTRL + .</td>
        <td>Navigate to subsequent Active Node</td>
      </tr>
      <tr>
        <td>CTRL + ,</td>
        <td>Navigate to preceding Active Node</td>
      </tr>
      <tr>
        <td>CTRL + Left Click / CTRL + Arrow Keys</td>
        <td>Move the Active Node</td>
      </tr>
    </tbody>
  </table>
);

function measureAndShowLengthBetweenNodes(sourceNodeId: number, targetNodeId: number) {
  const length = api.tracing.measureLengthBetweenNodes(sourceNodeId, targetNodeId);
  notification.open({
    message: `The shortest path length between the nodes is ${formatNumberToLength(length)}.`,
    icon: <i className="fas fa-ruler" />,
  });
}

function measureAndShowFullTreeLength(treeId: number, treeName: string) {
  const length = api.tracing.measureTreeLength(treeId);
  notification.open({
    message: messages["tracing.tree_length_notification"](treeName, formatNumberToLength(length)),
    icon: <i className="fas fa-ruler" />,
  });
}

function NodeContextMenuOptions({
  skeletonTracing,
  nodeContextMenuNodeId,
  hideNodeContextMenu,
  deleteEdge,
  createEdge,
  mergeTrees,
  deleteNode,
  setActiveNode,
  hideTree,
}: NodeContextMenuOptionsProps) {
  if (skeletonTracing == null) {
    return null;
  }
  const { activeTreeId, trees, activeNodeId } = skeletonTracing;
  const nodeContextTree = findTreeByNodeId(trees, nodeContextMenuNodeId).get();
  const areInSameTree = activeTreeId === nodeContextTree.treeId;
  const isTheSameNode = activeNodeId === nodeContextMenuNodeId;
  let areNodesConnected = false;
  if (areInSameTree && !isTheSameNode && activeNodeId != null) {
    const activeTreeEdges = nodeContextTree.edges.getEdgesForNode(activeNodeId);
    areNodesConnected = activeTreeEdges.some(
      edge => edge.source === nodeContextMenuNodeId || edge.target === nodeContextMenuNodeId,
    );
  }
  return (
    <Menu onClick={hideNodeContextMenu} style={{ borderRadius: 6 }}>
      <Menu.Item
        className="node-context-menu-item"
        key="set-node-active"
        disabled={isTheSameNode}
        onClick={() => setActiveNode(nodeContextMenuNodeId)}
      >
        Select this Node
      </Menu.Item>
      {areInSameTree ? (
        <Menu.Item
          className="node-context-menu-item"
          key="create-edge"
          disabled={!areInSameTree || isTheSameNode || areNodesConnected}
          onClick={() =>
            activeNodeId != null ? createEdge(nodeContextMenuNodeId, activeNodeId) : null
          }
        >
          Create Edge to this Node
        </Menu.Item>
      ) : (
        <Menu.Item
          className="node-context-menu-item"
          key="merge-trees"
          onClick={() =>
            activeNodeId != null ? mergeTrees(nodeContextMenuNodeId, activeNodeId) : null
          }
        >
          Create Edge & Merge with this Tree
        </Menu.Item>
      )}
      <Menu.Item
        className="node-context-menu-item"
        key="delete-edge"
        disabled={!areNodesConnected}
        onClick={() =>
          activeNodeId != null ? deleteEdge(activeNodeId, nodeContextMenuNodeId) : null
        }
      >
        Delete Edge to this Node
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="delete-node"
        onClick={() => deleteNode(nodeContextMenuNodeId, nodeContextTree.treeId)}
      >
        Delete this Node
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="measure-node-path-length"
        disabled={activeNodeId == null || !areInSameTree || isTheSameNode}
        onClick={() =>
          activeNodeId != null
            ? measureAndShowLengthBetweenNodes(activeNodeId, nodeContextMenuNodeId)
            : null
        }
      >
        Path Length to this Node
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="measure-whole-tree-length"
        disabled={activeNodeId == null || !areInSameTree || isTheSameNode}
        onClick={() => measureAndShowFullTreeLength(nodeContextTree.treeId, nodeContextTree.name)}
      >
        Path Length of this Tree
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="hide-tree"
        onClick={() => hideTree(nodeContextTree.treeId)}
      >
        Hide this Tree
      </Menu.Item>
    </Menu>
  );
}

function NoneNodeContextMenu({
  hideNodeContextMenu,
  globalPosition,
  rotation,
  createTree,
}: NoneNodeContextMenuProps) {
  return (
    <Menu onClick={hideNodeContextMenu} style={{ borderRadius: 6 }}>
      <Menu.Item
        className="node-context-menu-item"
        key="create-node"
        onClick={() => setWaypoint(globalPosition, rotation, false)}
      >
        Create Node here (Right Click)
      </Menu.Item>
      <Menu.Item
        className="node-context-menu-item"
        key="create-node-with-tree"
        onClick={() => {
          createTree();
          setWaypoint(globalPosition, rotation, false);
        }}
      >
        Create new Tree here
      </Menu.Item>
    </Menu>
  );
}

function NodeContextMenu(props: Props) {
  const {
    skeletonTracing,
    nodeContextMenuNodeId,
    nodeContextMenuPosition,
    hideNodeContextMenu,
    datasetScale,
    globalPosition,
  } = props;
  if (!skeletonTracing) {
    return null;
  }
  const { activeTreeId, activeNodeId } = skeletonTracing;
  const nodeContextMenuNode = getNodeAndTree(skeletonTracing, nodeContextMenuNodeId).get()[1];
  const positionToMeasureDistanceTo =
    nodeContextMenuNodeId != null ? nodeContextMenuNode.position : globalPosition;
  const activeNode = getNodeAndTree(skeletonTracing, activeNodeId, activeTreeId).get()[1];
  const distanceToSelection = formatNumberToLength(
    distanceBetweenVectors(activeNode.position, positionToMeasureDistanceTo, datasetScale),
  );

  return (
    <div
      style={{ width: "100%", height: "100%", position: "absolute", zIndex: 99 }}
      onClick={hideNodeContextMenu}
    >
      <div
        style={{
          position: "absolute",
          left: nodeContextMenuPosition[0],
          top: nodeContextMenuPosition[1] - NAVBAR_HEIGHT,
        }}
        className="node-context-menu"
      >
        <div className="node-context-menu-item">
          <Icon type="info-circle" /> {distanceToSelection} to this{" "}
          {nodeContextMenuNodeId != null ? "Node" : "Position"}
        </div>
        <div className="node-context-menu-item" style={{ cursor: "help" }}>
          <Popover
            placement="right"
            title="Interaction Hints"
            content={interactionHints}
            style={{ borderRadius: 6 }}
          >
            <Icon type="bulb" /> Show possible interactions
          </Popover>
        </div>
        <Divider style={{ margin: "4px 0px" }} />
        {nodeContextMenuNodeId != null
          ? NodeContextMenuOptions({ ...props, nodeContextMenuNodeId })
          : NoneNodeContextMenu({ ...props })}
      </div>
    </div>
  );
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  deleteEdge(firstNodeId: number, secondNodeId: number) {
    dispatch(deleteEdgeAction(firstNodeId, secondNodeId));
  },
  createEdge(firstNodeId: number, secondNodeId: number) {
    dispatch(createEdgeAction(firstNodeId, secondNodeId));
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
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(NodeContextMenu);
