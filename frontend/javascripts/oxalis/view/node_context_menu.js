// @flow
import * as React from "react";
import { Menu } from "antd";
import type { OxalisState, SkeletonTracing } from "oxalis/store";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { deleteEdgeAction } from "oxalis/model/actions/skeletontracing_actions";
import { findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";

type OwnProps = {|
  nodeContextMenuPosition: [number, number],
  nodeContextMenuNodeId: number,
  hideNodeContextMenu: () => void,
|};

type DispatchProps = {|
  deleteEdgeBetweenNodesAction: (number, number) => void,
|};

type StateProps = {| skeletonTracing: ?SkeletonTracing |};

type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};

const NAVBAR_HEIGHT = 48;

function NodeContextMenu({
  skeletonTracing,
  nodeContextMenuNodeId,
  nodeContextMenuPosition,
  hideNodeContextMenu,
  deleteEdgeBetweenNodesAction,
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
    <Menu
      style={{
        zIndex: 100,
        position: "absolute",
        left: nodeContextMenuPosition[0],
        top: nodeContextMenuPosition[1] - NAVBAR_HEIGHT,
      }}
      onClick={hideNodeContextMenu}
    >
      <Menu.Item
        key="create-edge"
        disabled={!areInSameTree || isTheSameNode || areNodesConnected}
        onClick={() => {
          console.log("First awesome method");
        }}
      >
        Create Edge To This Node
      </Menu.Item>
      <Menu.Item
        key="delete-edge"
        disabled={!areNodesConnected}
        onClick={() =>
          activeNodeId != null
            ? deleteEdgeBetweenNodesAction(activeNodeId, nodeContextMenuNodeId)
            : null
        }
      >
        Delete Edge To This Node
      </Menu.Item>
    </Menu>
  );
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  deleteEdgeBetweenNodesAction(firstNodeId: number, secondNodeId: number) {
    dispatch(deleteEdgeAction(firstNodeId, secondNodeId));
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
