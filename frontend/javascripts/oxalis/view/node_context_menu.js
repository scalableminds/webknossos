// @flow
import * as React from "react";
import { Menu, notification } from "antd";
import type { OxalisState, SkeletonTracing } from "oxalis/store";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import {
  createEdgeAction,
  deleteEdgeAction,
  mergeTreesAction,
  deleteNodeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import api from "oxalis/api/internal_api";
import messages from "messages";
import { findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";
import { formatNumberToLength } from "libs/format_utils";

type OwnProps = {|
  nodeContextMenuPosition: [number, number],
  nodeContextMenuNodeId: number,
  hideNodeContextMenu: () => void,
|};

type DispatchProps = {|
  deleteEdge: (number, number) => void,
  createEdge: (number, number) => void,
  mergeTrees: (number, number) => void,
  deleteNode: (number, number) => void,
|};

type StateProps = {| skeletonTracing: ?SkeletonTracing |};

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};

const NAVBAR_HEIGHT = 48;

function measureAndShowLengthBetweenNodes(sourceNodeId: number, targetNodeId: number) {
  const length = api.tracing.measureLengthBetweenNodes(sourceNodeId, targetNodeId);
  notification.open({
    message: `The shortest length between the nodes is ${formatNumberToLength(length)}.`,
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

function NodeContextMenu({
  skeletonTracing,
  nodeContextMenuNodeId,
  nodeContextMenuPosition,
  hideNodeContextMenu,
  deleteEdge,
  createEdge,
  mergeTrees,
  deleteNode,
}: Props) {
  if (!skeletonTracing) {
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
    <div
      style={{ width: "100%", height: "100%", position: "absolute", zIndex: 99 }}
      onClick={hideNodeContextMenu}
    >
      <Menu
        style={{
          zIndex: 100,
          position: "absolute",
          left: nodeContextMenuPosition[0],
          top: nodeContextMenuPosition[1] - NAVBAR_HEIGHT,
          borderRadius: 4,
        }}
        onClick={hideNodeContextMenu}
      >
        {areInSameTree ? (
          <Menu.Item
            key="create-edge"
            disabled={!areInSameTree || isTheSameNode || areNodesConnected}
            onClick={() =>
              activeNodeId != null ? createEdge(nodeContextMenuNodeId, activeNodeId) : null
            }
          >
            Create Edge To This Node
          </Menu.Item>
        ) : (
          <Menu.Item
            key="merge-trees"
            onClick={() =>
              activeNodeId != null ? mergeTrees(nodeContextMenuNodeId, activeNodeId) : null
            }
          >
            Create Edge & Merge With This Tree
          </Menu.Item>
        )}
        <Menu.Item
          key="delete-edge"
          disabled={!areNodesConnected}
          onClick={() =>
            activeNodeId != null ? deleteEdge(activeNodeId, nodeContextMenuNodeId) : null
          }
        >
          Delete Edge To This Node
        </Menu.Item>
        <Menu.Item
          key="delete-node"
          onClick={() => deleteNode(nodeContextMenuNodeId, nodeContextTree.treeId)}
        >
          Delete This Node
        </Menu.Item>
        <Menu.Item
          key="measure-length"
          disabled={activeNodeId == null || !areInSameTree || isTheSameNode}
          onClick={() =>
            activeNodeId != null
              ? measureAndShowLengthBetweenNodes(activeNodeId, nodeContextMenuNodeId)
              : null
          }
        >
          Measure Length To This Node
        </Menu.Item>
        <Menu.Item
          key="measure-length"
          disabled={activeNodeId == null || !areInSameTree || isTheSameNode}
          onClick={() => measureAndShowFullTreeLength(nodeContextTree.treeId, nodeContextTree.name)}
        >
          Measure Length Of This Tree
        </Menu.Item>
      </Menu>
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
});

function mapStateToProps(state: OxalisState): StateProps {
  return {
    skeletonTracing: state.tracing.skeleton,
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(NodeContextMenu);
