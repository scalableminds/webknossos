import _ from "lodash";
import {
  type APIAnnotation,
  type AnnotationLayerDescriptor,
  AnnotationLayerEnum,
  type ServerSkeletonTracing,
  type ServerTracing,
} from "types/api_types";
import { IdentityTransform, type TreeType, type Vector3 } from "viewer/constants";
import type {
  BranchPoint,
  Node,
  NumberLike,
  SkeletonTracing,
  StoreAnnotation,
  Tree,
  TreeGroup,
  TreeGroupTypeFlat,
  TreeMap,
  WebknossosState,
} from "viewer/store";
import {
  MISSING_GROUP_ID,
  findGroup,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { invertTransform, transformPointUnscaled } from "../helpers/transformation_helpers";
import {
  getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull,
  getTransformsForSkeletonLayer,
} from "./dataset_layer_transformation_accessor";

export function getSkeletonTracing(annotation: StoreAnnotation): SkeletonTracing | null {
  if (annotation.skeleton != null) {
    return annotation.skeleton;
  }

  return null;
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
  const skeletonTracing = getSkeletonTracing(annotation);
  if (skeletonTracing === null) {
    throw new Error("Expected skeleton tracing to be present");
  }
  return skeletonTracing;
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

export function getActiveTreeGroup(skeletonTracing: SkeletonTracing): TreeGroup | null {
  const { activeGroupId } = skeletonTracing;

  if (activeGroupId != null) {
    const group = findGroup(skeletonTracing.treeGroups, activeGroupId);
    return group;
  }

  return null;
}

export function getActiveNodeFromTree(skeletonTracing: SkeletonTracing, tree: Tree): Node | null {
  const { activeNodeId } = skeletonTracing;

  if (activeNodeId != null) {
    return tree.nodes.getOrThrow(activeNodeId);
  }

  return null;
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
  /**
   * Returns trees of a specific type or all trees if no type is provided.
   */
  return type != null
    ? _.pickBy(skeletonTracing.trees, (tree) => tree.type === type)
    : skeletonTracing.trees;
}

export function getTree(
  skeletonTracing: SkeletonTracing,
  treeId?: number | null | undefined,
  type?: TreeType | null | undefined,
): Tree | null {
  /**
   * Returns a specific tree by ID or the active tree, optionally filtered by type.
   */
  const trees = getTreesWithType(skeletonTracing, type);

  if (treeId != null) {
    return trees[treeId] || null;
  }

  const { activeTreeId } = skeletonTracing;

  if (activeTreeId != null) {
    return trees[activeTreeId] || null;
  }

  return null;
}

export function getTreeAndNode(
  skeletonTracing: SkeletonTracing,
  nodeId?: number | null | undefined,
  treeId?: number | null | undefined,
  type?: TreeType | null | undefined,
): [Tree, Node] | null {
  /**
   * Returns a tuple of [tree, node] if the node and tree can be found, otherwise null.
   * If no nodeId is provided, the active node is used. If no treeId is provided, the active tree is used.
   */
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
      return [tree, node];
    }
  }

  return null;
}

export function getTreeAndNodeOrNull(
  skeletonTracing: SkeletonTracing,
  nodeId?: number | null | undefined,
  treeId?: number | null | undefined,
): {
  tree: Tree | null;
  node: Node | null;
} {
  /**
   * Returns an object with tree and node properties instead of the array tuple [node, tree], which are null if not found.
   */
  const treeAndNode = getTreeAndNode(skeletonTracing, nodeId, treeId);
  if (treeAndNode == null) {
    return {
      tree: null,
      node: null,
    };
  }
  const [tree, node] = treeAndNode;
  return {
    tree,
    node,
  };
}

export function areGeometriesTransformed(state: WebknossosState) {
  const transformation = getTransformsForLayerThatDoesNotSupportTransformationConfigOrNull(
    state.dataset,
    state.datasetConfiguration.nativelyRenderedLayerName,
  );
  return transformation != null && transformation !== IdentityTransform;
}

export function isSkeletonLayerVisible(annotation: StoreAnnotation) {
  const skeletonLayer = getSkeletonTracing(annotation);
  return skeletonLayer == null ? false : skeletonLayer.showSkeletons;
}

export function getNodePosition(node: Node, state: WebknossosState): Vector3 {
  return transformNodePosition(node.untransformedPosition, state);
}

export function transformNodePosition(position: Vector3, state: WebknossosState): Vector3 {
  const dataset = state.dataset;
  const { nativelyRenderedLayerName } = state.datasetConfiguration;
  const currentTransforms = getTransformsForSkeletonLayer(dataset, nativelyRenderedLayerName);
  return transformPointUnscaled(currentTransforms)(position);
}

export function untransformNodePosition(position: Vector3, state: WebknossosState): Vector3 {
  const dataset = state.dataset;
  const { nativelyRenderedLayerName } = state.datasetConfiguration;
  const currentTransforms = getTransformsForSkeletonLayer(dataset, nativelyRenderedLayerName);
  return transformPointUnscaled(invertTransform(currentTransforms))(position);
}

export function getMaxNodeIdInTree(tree: Tree): number | null {
  const maxNodeId = _.reduce(
    Array.from(tree.nodes.keys()),
    (r, nodeId) => Math.max(r, nodeId),
    Number.NEGATIVE_INFINITY,
  );

  return maxNodeId === Number.NEGATIVE_INFINITY ? null : maxNodeId;
}

export function getMaxNodeId(skeletonTracing: SkeletonTracing): number | null {
  const maxNodeId = _.reduce(
    skeletonTracing.trees,
    (r, tree) => {
      const treeMaxId = getMaxNodeIdInTree(tree);
      return Math.max(r, treeMaxId ?? Number.NEGATIVE_INFINITY);
    },
    Number.NEGATIVE_INFINITY,
  );

  return maxNodeId === Number.NEGATIVE_INFINITY ? null : maxNodeId;
}

export function getBranchPoints(annotation: StoreAnnotation): BranchPoint[] | null {
  const skeletonTracing = getSkeletonTracing(annotation);
  if (skeletonTracing == null) {
    return null;
  }

  return _.flatMap(skeletonTracing.trees, (tree) => tree.branchPoints);
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
