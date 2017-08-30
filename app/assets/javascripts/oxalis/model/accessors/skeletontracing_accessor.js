// @flow
import Maybe from "data.maybe";
import _ from "lodash";
import type {
  TracingType,
  SkeletonTracingType,
  NodeType,
  TreeType,
  TreeMapType,
  BranchPointType,
} from "oxalis/store";

type SkeletonTracingStatsType = {
  treeCount: number,
  nodeCount: number,
  edgeCount: number,
  branchPointCount: number,
};

export function getSkeletonTracing(tracing: TracingType): Maybe<SkeletonTracingType> {
  if (tracing.type === "skeleton") {
    return Maybe.Just(tracing);
  }
  return Maybe.Nothing();
}

export function enforceSkeletonTracing(tracing: TracingType): SkeletonTracingType {
  return getSkeletonTracing(tracing).get();
}

export function getActiveNode(tracing: TracingType) {
  return getSkeletonTracing(tracing).chain(skeletonTracing => {
    const { activeTreeId, activeNodeId } = skeletonTracing;
    if (activeTreeId != null && activeNodeId != null) {
      return Maybe.Just(skeletonTracing.trees[activeTreeId].nodes[activeNodeId]);
    }
    return Maybe.Nothing();
  });
}

export function getActiveTree(tracing: TracingType) {
  return getSkeletonTracing(tracing).chain(skeletonTracing => {
    const { activeTreeId } = skeletonTracing;
    if (activeTreeId != null) {
      return Maybe.Just(skeletonTracing.trees[activeTreeId]);
    }
    return Maybe.Nothing();
  });
}

export function getEdges(tree: TreeType, node: NodeType) {
  return tree.edges.filter(e => e.source === node.id || e.target === node.id);
}

export function getActiveNodeFromTree(tracing: TracingType, tree: TreeType) {
  return getSkeletonTracing(tracing).chain(skeletonTracing => {
    const { activeNodeId } = skeletonTracing;
    if (activeNodeId != null) {
      return Maybe.Just(tree.nodes[activeNodeId]);
    }
    return Maybe.Nothing();
  });
}

export function findTreeByNodeId(trees: TreeMapType, nodeId: number): Maybe<TreeType> {
  return Maybe.fromNullable(_.values(trees).find(tree => tree.nodes[nodeId] != null));
}

export function getTree(tracing: TracingType, treeId: ?number) {
  return getSkeletonTracing(tracing).chain(skeletonTracing => {
    if (treeId != null) {
      return Maybe.fromNullable(skeletonTracing.trees[treeId]);
    }
    const { activeTreeId } = skeletonTracing;
    if (activeTreeId != null) {
      return Maybe.fromNullable(skeletonTracing.trees[activeTreeId]);
    }
    return Maybe.Nothing();
  });
}

export function getNodeAndTree(tracing: TracingType, nodeId: ?number, treeId: ?number) {
  return getSkeletonTracing(tracing).chain(skeletonTracing => {
    let tree;
    if (treeId != null) {
      tree = skeletonTracing.trees[treeId];
    } else if (nodeId != null) {
      tree = _.values(skeletonTracing.trees).find(__ => __.nodes[nodeId] != null);
    } else {
      const { activeTreeId } = skeletonTracing;
      if (activeTreeId != null) {
        tree = skeletonTracing.trees[activeTreeId];
      }
    }

    if (tree != null) {
      let node = null;
      if (nodeId != null) {
        node = tree.nodes[nodeId];
      } else {
        const { activeNodeId } = skeletonTracing;
        if (activeNodeId != null) {
          node = tree.nodes[activeNodeId];
        }
      }
      if (node != null) {
        return Maybe.Just([tree, node]);
      }
    }
    return Maybe.Nothing();
  });
}

export function getMaxNodeIdInTree(tree: TreeType) {
  const maxNodeId = _.reduce(tree.nodes, (r, node) => Math.max(r, node.id), -Infinity);
  return maxNodeId === -Infinity ? Maybe.Nothing() : Maybe.Just(maxNodeId);
}

export function getMaxNodeId(tracing: TracingType) {
  return getSkeletonTracing(tracing).chain(skeletonTracing => {
    const maxNodeId = _.reduce(
      skeletonTracing.trees,
      (r, tree) => Math.max(r, getMaxNodeId(tree).getOrElse(-Infinity)),
      -Infinity,
    );
    return maxNodeId === -Infinity ? Maybe.Nothing() : Maybe.Just(maxNodeId);
  });
}

export function getBranchPoints(tracing: TracingType): Maybe<Array<BranchPointType>> {
  return getSkeletonTracing(tracing).map(skeletonTracing =>
    _.flatMap(skeletonTracing.trees, tree => tree.branchPoints),
  );
}

export function getStats(tracing: TracingType): Maybe<SkeletonTracingStatsType> {
  return getSkeletonTracing(tracing)
    .chain(skeletonTracing => Maybe.fromNullable(skeletonTracing.trees))
    .map(trees => ({
      treeCount: _.size(trees),
      nodeCount: _.reduce(trees, (sum, tree) => sum + _.size(tree.nodes), 0),
      edgeCount: _.reduce(trees, (sum, tree) => sum + _.size(tree.edges), 0),
      branchPointCount: _.reduce(trees, (sum, tree) => sum + _.size(tree.branchPoints), 0),
    }));
}
