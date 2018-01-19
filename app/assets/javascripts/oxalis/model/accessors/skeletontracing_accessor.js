// @flow
import Maybe from "data.maybe";
import _ from "lodash";
import type {
  TracingType,
  SkeletonTracingType,
  NodeType,
  EdgeType,
  TreeType,
  TreeMapType,
  BranchPointType,
} from "oxalis/store";

export type SkeletonTracingStatsType = {
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
      return Maybe.Just(skeletonTracing.trees[activeTreeId].nodes.get(activeNodeId));
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

export function getNodeToEdgesMap(tree: TreeType, doublyLinked: boolean = true) {
  // Build a hashmap which contains for each node all edges leading/leaving into/from the node
  const nodeToEdgesMap: { [number]: Array<EdgeType> } = {};
  tree.edges.forEach(edge => {
    if (nodeToEdgesMap[edge.source]) {
      nodeToEdgesMap[edge.source].push(edge);
    } else {
      nodeToEdgesMap[edge.source] = [edge];
    }
    // The doublyLinked flag determines (if true) that source AND target node should contain their connecting edge
    // or (if false) that only the source node should contain the connecting edge
    if (doublyLinked) {
      if (nodeToEdgesMap[edge.target]) {
        nodeToEdgesMap[edge.target].push(edge);
      } else {
        nodeToEdgesMap[edge.target] = [edge];
      }
    }
  });
  return nodeToEdgesMap;
}

export function getActiveNodeFromTree(tracing: TracingType, tree: TreeType) {
  return getSkeletonTracing(tracing).chain(skeletonTracing => {
    const { activeNodeId } = skeletonTracing;
    if (activeNodeId != null) {
      return Maybe.Just(tree.nodes.get(activeNodeId));
    }
    return Maybe.Nothing();
  });
}

export function findTreeByNodeId(trees: TreeMapType, nodeId: number): Maybe<TreeType> {
  return Maybe.fromNullable(_.values(trees).find(tree => tree.nodes.has(nodeId)));
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
      tree = _.values(skeletonTracing.trees).find(__ => __.nodes.has(nodeId));
    } else {
      const { activeTreeId } = skeletonTracing;
      if (activeTreeId != null) {
        tree = skeletonTracing.trees[activeTreeId];
      }
    }

    if (tree != null) {
      let node = null;
      if (nodeId != null) {
        node = tree.nodes.get(nodeId);
      } else {
        const { activeNodeId } = skeletonTracing;
        if (activeNodeId != null) {
          node = tree.nodes.get(activeNodeId);
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
  const maxNodeId = _.reduce(
    Array.from(tree.nodes.keys()),
    (r, nodeId) => Math.max(r, nodeId),
    -Infinity,
  );
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
      nodeCount: _.reduce(trees, (sum, tree) => sum + tree.nodes.size(), 0),
      edgeCount: _.reduce(trees, (sum, tree) => sum + _.size(tree.edges), 0),
      branchPointCount: _.reduce(trees, (sum, tree) => sum + _.size(tree.branchPoints), 0),
    }));
}
