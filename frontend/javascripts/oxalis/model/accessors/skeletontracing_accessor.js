// @flow
import Maybe from "data.maybe";
import _ from "lodash";

import type { HybridServerTracing, ServerSkeletonTracing } from "admin/api_flow_types";
import type {
  Tracing,
  SkeletonTracing,
  Tree,
  TreeMap,
  BranchPoint,
  TreeGroup,
  TreeGroupTypeFlat,
  Node,
} from "oxalis/store";
import { findGroup } from "oxalis/view/right-menu/tree_hierarchy_view_helpers";
import { mapGroups } from "oxalis/model/reducers/skeletontracing_reducer_helpers";

export type SkeletonTracingStats = {|
  treeCount: number,
  nodeCount: number,
  edgeCount: number,
  branchPointCount: number,
|};

export function getSkeletonTracing(tracing: Tracing): Maybe<SkeletonTracing> {
  if (tracing.skeleton != null) {
    return Maybe.Just(tracing.skeleton);
  }
  return Maybe.Nothing();
}

export function serverTracingAsSkeletonTracingMaybe(
  tracing: ?HybridServerTracing,
): Maybe<ServerSkeletonTracing> {
  if (tracing && tracing.skeleton) {
    return Maybe.Just(tracing.skeleton);
  } else {
    return Maybe.Nothing();
  }
}

export function enforceSkeletonTracing(tracing: Tracing): SkeletonTracing {
  return getSkeletonTracing(tracing).get();
}

export function getActiveNode(skeletonTracing: SkeletonTracing): Maybe<Node> {
  const { activeTreeId, activeNodeId } = skeletonTracing;
  if (activeTreeId != null && activeNodeId != null) {
    return Maybe.Just(skeletonTracing.trees[activeTreeId].nodes.get(activeNodeId));
  }
  return Maybe.Nothing();
}

export function getActiveTree(skeletonTracing: SkeletonTracing): Maybe<Tree> {
  const { activeTreeId } = skeletonTracing;
  if (activeTreeId != null) {
    return Maybe.Just(skeletonTracing.trees[activeTreeId]);
  }
  return Maybe.Nothing();
}

export function getActiveGroup(skeletonTracing: SkeletonTracing): Maybe<TreeGroup> {
  const { activeGroupId } = skeletonTracing;
  if (activeGroupId != null) {
    const group = findGroup(skeletonTracing.treeGroups, activeGroupId);
    return Maybe.fromNullable(group);
  }
  return Maybe.Nothing();
}

export function getActiveNodeFromTree(skeletonTracing: SkeletonTracing, tree: Tree): Maybe<Node> {
  const { activeNodeId } = skeletonTracing;
  if (activeNodeId != null) {
    return Maybe.Just(tree.nodes.get(activeNodeId));
  }
  return Maybe.Nothing();
}

export function findTreeByNodeId(trees: TreeMap, nodeId: number): Maybe<Tree> {
  return Maybe.fromNullable(_.values(trees).find(tree => tree.nodes.has(nodeId)));
}

export function getTree(skeletonTracing: SkeletonTracing, treeId: ?number): Maybe<Tree> {
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
  skeletonTracing: SkeletonTracing,
  nodeId: ?number,
  treeId: ?number,
): Maybe<[Tree, Node]> {
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

export function getNodeAndTreeOrNull(
  skeletonTracing: SkeletonTracing,
  nodeId: ?number,
  treeId: ?number,
): { tree: Tree | null, node: Node | null } {
  return getNodeAndTree(skeletonTracing, nodeId, treeId)
    .map(([maybeTree, maybeNode]) => ({ tree: maybeTree, node: maybeNode }))
    .getOrElse({
      tree: null,
      node: null,
    });
}

export function getMaxNodeIdInTree(tree: Tree): Maybe<number> {
  const maxNodeId = _.reduce(
    Array.from(tree.nodes.keys()),
    (r, nodeId) => Math.max(r, nodeId),
    -Infinity,
  );
  return maxNodeId === -Infinity ? Maybe.Nothing() : Maybe.Just(maxNodeId);
}

export function getMaxNodeId(skeletonTracing: SkeletonTracing): Maybe<number> {
  const maxNodeId = _.reduce(
    skeletonTracing.trees,
    (r, tree) => Math.max(r, getMaxNodeId(tree).getOrElse(-Infinity)),
    -Infinity,
  );
  return maxNodeId === -Infinity ? Maybe.Nothing() : Maybe.Just(maxNodeId);
}

export function getBranchPoints(tracing: Tracing): Maybe<Array<BranchPoint>> {
  return getSkeletonTracing(tracing).map(skeletonTracing =>
    _.flatMap(skeletonTracing.trees, tree => tree.branchPoints),
  );
}

export function getStats(tracing: Tracing): Maybe<SkeletonTracingStats> {
  return getSkeletonTracing(tracing)
    .chain(skeletonTracing => Maybe.fromNullable(skeletonTracing.trees))
    .map(trees => ({
      treeCount: _.size(trees),
      nodeCount: _.reduce(trees, (sum, tree) => sum + tree.nodes.size(), 0),
      edgeCount: _.reduce(trees, (sum, tree) => sum + tree.edges.size(), 0),
      branchPointCount: _.reduce(trees, (sum, tree) => sum + _.size(tree.branchPoints), 0),
    }));
}

export function getFlatTreeGroups(skeletonTracing: SkeletonTracing): Array<TreeGroupTypeFlat> {
  return Array.from(
    mapGroups(skeletonTracing.treeGroups, ({ children: _children, ...bareTreeGroup }) => ({
      ...bareTreeGroup,
    })),
  );
}

export function getTreeGroupsMap(
  skeletonTracing: SkeletonTracing,
): { [key: number]: TreeGroupTypeFlat } {
  return _.keyBy(getFlatTreeGroups(skeletonTracing), "groupId");
}
