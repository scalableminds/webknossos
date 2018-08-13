// @flow
import Maybe from "data.maybe";
import _ from "lodash";
import type {
  TracingType,
  SkeletonTracingType,
  TreeType,
  TreeMapType,
  BranchPointType,
  TreeGroupTypeFlat,
} from "oxalis/store";
import type { HybridServerTracingType, ServerSkeletonTracingType } from "admin/api_flow_types";
import { mapGroups } from "oxalis/model/reducers/skeletontracing_reducer_helpers";

export type SkeletonTracingStatsType = {|
  treeCount: number,
  nodeCount: number,
  edgeCount: number,
  branchPointCount: number,
|};

export function getSkeletonTracing(tracing: TracingType): Maybe<SkeletonTracingType> {
  if (tracing.skeleton != null) {
    return Maybe.Just(tracing.skeleton);
  }
  return Maybe.Nothing();
}

export function serverTracingAsSkeletonTracingMaybe(
  tracing: ?HybridServerTracingType,
): Maybe<ServerSkeletonTracingType> {
  if (tracing && tracing.skeleton) {
    return Maybe.Just(tracing.skeleton);
  } else {
    return Maybe.Nothing();
  }
}

export function enforceSkeletonTracing(tracing: TracingType): SkeletonTracingType {
  return getSkeletonTracing(tracing).get();
}

export function getActiveNode(skeletonTracing: SkeletonTracingType) {
  const { activeTreeId, activeNodeId } = skeletonTracing;
  if (activeTreeId != null && activeNodeId != null) {
    return Maybe.Just(skeletonTracing.trees[activeTreeId].nodes.get(activeNodeId));
  }
  return Maybe.Nothing();
}

export function getActiveTree(skeletonTracing: SkeletonTracingType) {
  const { activeTreeId } = skeletonTracing;
  if (activeTreeId != null) {
    return Maybe.Just(skeletonTracing.trees[activeTreeId]);
  }
  return Maybe.Nothing();
}

export function getActiveNodeFromTree(skeletonTracing: SkeletonTracingType, tree: TreeType) {
  const { activeNodeId } = skeletonTracing;
  if (activeNodeId != null) {
    return Maybe.Just(tree.nodes.get(activeNodeId));
  }
  return Maybe.Nothing();
}

export function findTreeByNodeId(trees: TreeMapType, nodeId: number): Maybe<TreeType> {
  return Maybe.fromNullable(_.values(trees).find(tree => tree.nodes.has(nodeId)));
}

export function getTree(skeletonTracing: SkeletonTracingType, treeId: ?number) {
  if (treeId != null) {
    return Maybe.fromNullable(skeletonTracing.trees[treeId]);
  }
  const { activeTreeId } = skeletonTracing;
  if (activeTreeId != null) {
    return Maybe.fromNullable(skeletonTracing.trees[activeTreeId]);
  }
  return Maybe.Nothing();
}

export function getNodeAndTree(
  skeletonTracing: SkeletonTracingType,
  nodeId: ?number,
  treeId: ?number,
) {
  let tree;
  if (treeId != null) {
    tree = skeletonTracing.trees[treeId];
  } else if (nodeId != null) {
    // Flow doesn't understand that nodeId is not null, otherwise ¯\_(ツ)_/¯
    const nonNullNodeId = nodeId;
    tree = _.values(skeletonTracing.trees).find(__ => __.nodes.has(nonNullNodeId));
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
}

export function getMaxNodeIdInTree(tree: TreeType) {
  const maxNodeId = _.reduce(
    Array.from(tree.nodes.keys()),
    (r, nodeId) => Math.max(r, nodeId),
    -Infinity,
  );
  return maxNodeId === -Infinity ? Maybe.Nothing() : Maybe.Just(maxNodeId);
}

export function getMaxNodeId(skeletonTracing: SkeletonTracingType) {
  const maxNodeId = _.reduce(
    skeletonTracing.trees,
    (r, tree) => Math.max(r, getMaxNodeId(tree).getOrElse(-Infinity)),
    -Infinity,
  );
  return maxNodeId === -Infinity ? Maybe.Nothing() : Maybe.Just(maxNodeId);
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
      edgeCount: _.reduce(trees, (sum, tree) => sum + tree.edges.size(), 0),
      branchPointCount: _.reduce(trees, (sum, tree) => sum + _.size(tree.branchPoints), 0),
    }));
}

export function getFlatTreeGroups(skeletonTracing: SkeletonTracingType): Array<TreeGroupTypeFlat> {
  return Array.from(
    mapGroups(skeletonTracing.treeGroups, ({ ...bareTreeGroup }) => ({
      ...bareTreeGroup,
    })),
  );
}

export function getTreeGroupsMap(
  skeletonTracing: SkeletonTracingType,
): { [key: string]: TreeGroupTypeFlat } {
  return _.keyBy(getFlatTreeGroups(skeletonTracing), "groupId");
}
