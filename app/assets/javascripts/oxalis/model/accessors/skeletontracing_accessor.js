// @flow
import Maybe from "data.maybe";
import _ from "lodash";
import type { OxalisState, SkeletonTracingType, NodeType, TreeType, TreeMapType } from "oxalis/store";

export function getActiveNode(tracing: SkeletonTracingType) {
  const { activeTreeId, activeNodeId } = tracing;
  if (activeTreeId != null && activeNodeId != null) {
    return Maybe.Just(tracing.trees[activeTreeId].nodes[activeNodeId]);
  }
  return Maybe.Nothing();
}

export function getActiveTree(tracing: SkeletonTracingType) {
  const { activeTreeId } = tracing;
  if (activeTreeId != null) {
    return Maybe.Just(tracing.trees[activeTreeId]);
  }
  return Maybe.Nothing();
}

export function getEdges(tree: TreeType, node: NodeType) {
  return tree.edges.filter(e => e.source === node.id || e.target === node.id);
}

export function getActiveNodeFromTree(tracing: SkeletonTracingType, tree: TreeType) {
  const { activeNodeId } = tracing;
  if (activeNodeId != null) {
    return Maybe.Just(tree.nodes[activeNodeId]);
  }
  return Maybe.Nothing();
}

export function findTreeByNodeId(trees: TreeMapType, nodeId: number): Maybe<TreeType> {
  return Maybe.fromNullable(_.values(trees).find(tree => tree.nodes[nodeId] != null));
}

export function getTree(state: OxalisState, treeId: ?number) {
  if (treeId != null) {
    return Maybe.fromNullable(state.skeletonTracing.trees[treeId]);
  }
  const { activeTreeId } = state.skeletonTracing;
  if (activeTreeId != null) {
    return Maybe.fromNullable(state.skeletonTracing.trees[activeTreeId]);
  }
  return Maybe.Nothing();
}

export function getNodeAndTree(state: OxalisState, nodeId: ?number, treeId: ?number) {
  let tree;
  if (treeId != null) {
    tree = state.skeletonTracing.trees[treeId];
  } else if (nodeId != null) {
    tree = _.values(state.skeletonTracing.trees).find(__ => __.nodes[nodeId] != null);
  } else {
    const { activeTreeId } = state.skeletonTracing;
    if (activeTreeId != null) {
      tree = state.skeletonTracing.trees[activeTreeId];
    }
  }

  if (tree != null) {
    let node = null;
    if (nodeId != null) {
      node = tree.nodes[nodeId];
    } else {
      const { activeNodeId } = state.skeletonTracing;
      if (activeNodeId != null) {
        node = tree.nodes[activeNodeId];
      }
    }
    if (node != null) {
      return Maybe.Just([tree, node]);
    }
  }
  return Maybe.Nothing();
}

export function getMaxNodeIdInTree(tree: TreeType) {
  const maxNodeId = _.reduce(tree.nodes, (r, node) => Math.max(r, node.id), -Infinity);
  return maxNodeId === -Infinity ?
    Maybe.Nothing() :
    Maybe.Just(maxNodeId);
}

export function getMaxNodeId(tracing: SkeletonTracingType) {
  const maxNodeId = _.reduce(
    tracing.trees,
    (r, tree) => Math.max(r, getMaxNodeId(tree).getOrElse(-Infinity)),
    -Infinity);
  return maxNodeId === -Infinity ?
    Maybe.Nothing() :
    Maybe.Just(maxNodeId);
}
