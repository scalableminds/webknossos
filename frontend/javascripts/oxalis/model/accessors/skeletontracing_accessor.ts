import Maybe from "data.maybe";
import _ from "lodash";
import type {
  ServerTracing,
  ServerSkeletonTracing,
  APIAnnotation,
  AnnotationLayerDescriptor,
} from "types/api_flow_types";
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
import { findGroup } from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";

export type SkeletonTracingStats = {
  treeCount: number;
  nodeCount: number;
  edgeCount: number;
  branchPointCount: number;
};
export function getSkeletonTracing(tracing: Tracing): Maybe<SkeletonTracing> {
  if (tracing.skeleton != null) {
    return Maybe.Just(tracing.skeleton);
  }

  return Maybe.Nothing();
}
export function getSkeletonDescriptor(
  annotation: APIAnnotation,
): AnnotationLayerDescriptor | null | undefined {
  const skeletonLayers = annotation.annotationLayers.filter(
    (descriptor) => descriptor.typ === "Skeleton",
  );

  if (skeletonLayers.length > 0) {
    return skeletonLayers[0];
  }

  return null;
}
export function getNullableSkeletonTracing(
  tracings: Array<ServerTracing> | null | undefined,
): ServerSkeletonTracing | null | undefined {
  const skeletonTracings = (tracings || []).filter((tracing) => tracing.typ === "Skeleton");

  if (skeletonTracings.length > 0 && skeletonTracings[0].typ === "Skeleton") {
    // Only one skeleton is supported. The second type-check is only for TS.
    return skeletonTracings[0];
  }

  return null;
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
export function findTreeByNodeId(trees: TreeMap, nodeId: number): Tree | undefined {
  return _.values(trees).find((tree) => tree.nodes.has(nodeId));
}
export function findTreeByName(trees: TreeMap, treeName: string): Tree | undefined {
  return _.values(trees).find((tree: Tree) => tree.name === treeName);
}
export function getTree(
  skeletonTracing: SkeletonTracing,
  treeId?: number | null | undefined,
): Maybe<Tree> {
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
  nodeId?: number | null | undefined,
  treeId?: number | null | undefined,
): Maybe<[Tree, Node]> {
  let tree;

  if (treeId != null) {
    tree = skeletonTracing.trees[treeId];
  } else if (nodeId != null) {
    tree = _.values(skeletonTracing.trees).find((__) => __.nodes.has(nodeId));
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
  nodeId?: number | null | undefined,
  treeId?: number | null | undefined,
): {
  tree: Tree | null;
  node: Node | null;
} {
  return getNodeAndTree(skeletonTracing, nodeId, treeId)
    .map(
      ([maybeTree, maybeNode]): {
        tree: Tree | null;
        node: Node | null;
      } => ({
        tree: maybeTree,
        node: maybeNode,
      }),
    )
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
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Tree' is not assignable to param... Remove this comment to see the full error message
    (r, tree) => Math.max(r, getMaxNodeId(tree).getOrElse(-Infinity)),
    -Infinity,
  );

  return maxNodeId === -Infinity ? Maybe.Nothing() : Maybe.Just(maxNodeId);
}
export function getBranchPoints(tracing: Tracing): Maybe<Array<BranchPoint>> {
  return getSkeletonTracing(tracing).map((skeletonTracing) =>
    _.flatMap(skeletonTracing.trees, (tree) => tree.branchPoints),
  );
}
export function getStats(tracing: Tracing): Maybe<SkeletonTracingStats> {
  return getSkeletonTracing(tracing)
    .chain((skeletonTracing) => Maybe.fromNullable(skeletonTracing.trees))
    .map((trees) => ({
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
): Record<number, TreeGroupTypeFlat> {
  return _.keyBy(getFlatTreeGroups(skeletonTracing), "groupId");
}
// This is the pattern for the automatically assigned names for agglomerate skeletons
export const getTreeNameForAgglomerateSkeleton = (
  agglomerateId: number,
  mappingName: string,
): string => `agglomerate ${agglomerateId} (${mappingName})`;

// Helper
export function* mapGroups<R>(
  groups: Array<TreeGroup>,
  callback: (arg0: TreeGroup) => R,
): Generator<R, void, void> {
  for (const group of groups) {
    yield callback(group);

    if (group.children) {
      yield* mapGroups(group.children, callback);
    }
  }
}
