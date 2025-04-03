import Maybe from "data.maybe";
import _ from "lodash";
import { IdentityTransform, type TreeType, type Vector3 } from "oxalis/constants";
import type {
  BranchPoint,
  Node,
  NumberLike,
  OxalisState,
  SkeletonTracing,
  StoreAnnotation,
  Tree,
  TreeGroup,
  TreeGroupTypeFlat,
  TreeMap,
} from "oxalis/store";
import {
  MISSING_GROUP_ID,
  findGroup,
} from "oxalis/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import {
  type APIAnnotation,
  type AnnotationLayerDescriptor,
  AnnotationLayerEnum,
  type ServerSkeletonTracing,
  type ServerTracing,
} from "types/api_flow_types";
import { invertTransform, transformPointUnscaled } from "../helpers/transformation_helpers";
import {
  getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull,
  getTransformsForSkeletonLayer,
} from "./dataset_layer_transformation_accessor";

export function getSkeletonTracing(annotation: StoreAnnotation): Maybe<SkeletonTracing> {
  if (annotation.skeleton != null) {
    return Maybe.Just(annotation.skeleton);
  }

  return Maybe.Nothing();
}

export function getSkeletonDescriptor(
  annotation: APIAnnotation,
): AnnotationLayerDescriptor | null | undefined {
  const skeletonLayers = annotation.annotationLayers.filter(
    (descriptor) => descriptor.typ === AnnotationLayerEnum.Skeleton,
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

export function enforceSkeletonTracing(annotation: StoreAnnotation): SkeletonTracing {
  return getSkeletonTracing(annotation).get();
}

export function getActiveNode(skeletonTracing: SkeletonTracing): Node | null {
  const { activeTreeId, activeNodeId } = skeletonTracing;

  if (activeTreeId != null && activeNodeId != null) {
    return skeletonTracing.trees[activeTreeId].nodes.getOrThrow(activeNodeId);
  }

  return null;
}

export function getActiveTree(skeletonTracing: SkeletonTracing | null | undefined): Tree | null {
  if (skeletonTracing == null) {
    return null;
  }
  const { activeTreeId } = skeletonTracing;

  if (activeTreeId != null) {
    return skeletonTracing.trees[activeTreeId];
  }

  return null;
}

export function getActiveTreeGroup(skeletonTracing: SkeletonTracing): Maybe<TreeGroup> {
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
    return Maybe.Just(tree.nodes.getOrThrow(activeNodeId));
  }

  return Maybe.Nothing();
}

export function findTreeByNodeId(trees: TreeMap, nodeId: number): Tree | undefined {
  return _.values(trees).find((tree) => tree.nodes.has(nodeId));
}

export function findTreeByName(trees: TreeMap, treeName: string): Tree | undefined {
  return _.values(trees).find((tree: Tree) => tree.name === treeName);
}

export function getTreesWithType(
  skeletonTracing: SkeletonTracing,
  type?: TreeType | null | undefined,
): TreeMap {
  return type != null
    ? _.pickBy(skeletonTracing.trees, (tree) => tree.type === type)
    : skeletonTracing.trees;
}

export function getTree(
  skeletonTracing: SkeletonTracing,
  treeId?: number | null | undefined,
  type?: TreeType | null | undefined,
): Maybe<Tree> {
  const trees = getTreesWithType(skeletonTracing, type);

  if (treeId != null) {
    return Maybe.fromNullable(trees[treeId]);
  }

  const { activeTreeId } = skeletonTracing;

  if (activeTreeId != null) {
    return Maybe.fromNullable(trees[activeTreeId]);
  }

  return Maybe.Nothing();
}

export function getNodeAndTree(
  skeletonTracing: SkeletonTracing,
  nodeId?: number | null | undefined,
  treeId?: number | null | undefined,
  type?: TreeType | null | undefined,
): Maybe<[Tree, Node]> {
  let tree;

  const trees = getTreesWithType(skeletonTracing, type);

  if (treeId != null) {
    tree = trees[treeId];
  } else if (nodeId != null) {
    tree = _.values(trees).find((__) => __.nodes.has(nodeId));
  } else {
    const { activeTreeId } = skeletonTracing;

    if (activeTreeId != null) {
      tree = trees[activeTreeId];
    }
  }

  if (tree != null) {
    let node = null;

    if (nodeId != null) {
      node = tree.nodes.getNullable(nodeId);
    } else {
      const { activeNodeId } = skeletonTracing;

      if (activeNodeId != null) {
        node = tree.nodes.getOrThrow(activeNodeId);
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

export function isSkeletonLayerTransformed(state: OxalisState) {
  const transformation = getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull(
    state.dataset,
    state.datasetConfiguration.nativelyRenderedLayerName,
  );
  return transformation != null && transformation !== IdentityTransform;
}

export function isSkeletonLayerVisible(annotation: StoreAnnotation) {
  const skeletonLayer = getSkeletonTracing(annotation);
  return skeletonLayer.isNothing ? false : skeletonLayer.get().showSkeletons;
}

export function getNodePosition(node: Node, state: OxalisState): Vector3 {
  return transformNodePosition(node.untransformedPosition, state);
}

export function transformNodePosition(position: Vector3, state: OxalisState): Vector3 {
  const dataset = state.dataset;
  const { nativelyRenderedLayerName } = state.datasetConfiguration;
  const currentTransforms = getTransformsForSkeletonLayer(dataset, nativelyRenderedLayerName);
  return transformPointUnscaled(currentTransforms)(position);
}

export function untransformNodePosition(position: Vector3, state: OxalisState): Vector3 {
  const dataset = state.dataset;
  const { nativelyRenderedLayerName } = state.datasetConfiguration;
  const currentTransforms = getTransformsForSkeletonLayer(dataset, nativelyRenderedLayerName);
  return transformPointUnscaled(invertTransform(currentTransforms))(position);
}

export function getMaxNodeIdInTree(tree: Tree): Maybe<number> {
  const maxNodeId = _.reduce(
    Array.from(tree.nodes.keys()),
    (r, nodeId) => Math.max(r, nodeId),
    Number.NEGATIVE_INFINITY,
  );

  return maxNodeId === Number.NEGATIVE_INFINITY ? Maybe.Nothing() : Maybe.Just(maxNodeId);
}
export function getMaxNodeId(skeletonTracing: SkeletonTracing): number | null {
  const maxNodeId = _.reduce(
    skeletonTracing.trees,
    (r, tree) => Math.max(r, getMaxNodeIdInTree(tree).getOrElse(Number.NEGATIVE_INFINITY)),
    Number.NEGATIVE_INFINITY,
  );

  return maxNodeId === Number.NEGATIVE_INFINITY ? null : maxNodeId;
}
export function getBranchPoints(annotation: StoreAnnotation): Maybe<Array<BranchPoint>> {
  return getSkeletonTracing(annotation).map((skeletonTracing) =>
    _.flatMap(skeletonTracing.trees, (tree) => tree.branchPoints),
  );
}

export function getFlatTreeGroups(skeletonTracing: SkeletonTracing): Array<TreeGroupTypeFlat> {
  return Array.from(
    mapGroupsToGenerator(
      skeletonTracing.treeGroups,
      ({ children: _children, ...bareTreeGroup }) => ({
        ...bareTreeGroup,
      }),
    ),
  );
}
export function getTreeGroupsMap(
  skeletonTracing: SkeletonTracing,
): Record<number, TreeGroupTypeFlat> {
  return _.keyBy(getFlatTreeGroups(skeletonTracing), "groupId");
}
// This is the pattern for the automatically assigned names for agglomerate skeletons
export const getTreeNameForAgglomerateSkeleton = (
  agglomerateId: NumberLike,
  mappingName: string,
): string => `agglomerate ${agglomerateId} (${mappingName})`;

// Helper
export function* mapGroupsToGenerator<R>(
  groups: Array<TreeGroup>,
  callback: (arg0: TreeGroup) => R,
): Generator<R, void, void> {
  for (const group of groups) {
    yield callback(group);

    if (group.children) {
      yield* mapGroupsToGenerator(group.children, callback);
    }
  }
}

function mapGroupAndChildrenHelper(group: TreeGroup, fn: (g: TreeGroup) => TreeGroup): TreeGroup {
  const newChildren = mapGroups(group.children, fn);
  return fn({ ...group, children: newChildren });
}

export function mapGroups(groups: TreeGroup[], fn: (g: TreeGroup) => TreeGroup): TreeGroup[] {
  return groups.map((group) => mapGroupAndChildrenHelper(group, fn));
}

export function mapGroupsWithRoot(
  groups: TreeGroup[],
  fn: (g: TreeGroup) => TreeGroup,
): TreeGroup[] {
  // Add the virtual root group so that the map function can also mutate
  // the high-level elements (e.g., filtering elements in the first level).
  return mapGroups(
    [
      {
        name: "Root",
        groupId: MISSING_GROUP_ID,
        children: groups,
      },
    ],
    fn,
  )[0].children; // Read the root group's children again
}
