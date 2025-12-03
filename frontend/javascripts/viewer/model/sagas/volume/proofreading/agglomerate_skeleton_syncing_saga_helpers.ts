import DiffableMap from "libs/diffable_map";
import { getAdaptToTypeFunction } from "libs/utils";
import { all, put } from "typed-redux-saga";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import {
  enforceSkeletonTracing,
  findTreeByName,
  getTreeNameForAgglomerateSkeleton,
  getTreesWithType,
} from "viewer/model/accessors/skeletontracing_accessor";
import { applySkeletonUpdateActionsFromServerAction } from "viewer/model/actions/skeletontracing_actions";
import EdgeCollection from "viewer/model/edge_collection";
import {
  createMutableTreeMapFromTreeArray,
  getMaximumTreeId,
} from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { type Tree, TreeMap } from "viewer/model/types/tree_types";
import type { Node } from "viewer/model/types/tree_types";
import type { NumberLikeMap, SkeletonTracing } from "viewer/store";
import { type Saga, call, select } from "../../effect-generators";
import { diffSkeletonTracing, getAgglomerateSkeletonTracing } from "../../skeletontracing_saga";
import {
  type ApplicableSkeletonServerUpdateAction,
  ApplicableSkeletonUpdateActionNamesHelperNamesList,
  type UpdateActionWithoutIsolationRequirement,
} from "../update_actions";

type ActionSegmentInfo = {
  agglomerateId: number;
  unmappedId: number;
  position: Vector3;
};

function getAgglomerateTreeIfExists(
  agglomerateId: number,
  mappingName: string,
  trees: TreeMap,
): Tree | undefined {
  const agglomerateTreeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);
  return findTreeByName(trees, agglomerateTreeName);
}

// Puts the given trees into a skeleton tracing object, where the value equal those of the active skeleton tracing.
//  Before calling, ensure a skeleton tracing exists.
function* agglomerateTreesToSkeleton(trees: Tree[]): Saga<SkeletonTracing> {
  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.annotation));
  let treeMapWithOldAggloTrees = new TreeMap();
  for (const tree of trees) {
    treeMapWithOldAggloTrees = treeMapWithOldAggloTrees.set(tree.treeId, tree);
  }
  const tracingWitTreesReplaced = {
    ...skeletonTracing,
    trees: treeMapWithOldAggloTrees,
  };
  return tracingWitTreesReplaced;
}

function* getAgglomerateTreesAsSkeleton(agglomerateIds: number[], mappingName: string) {
  const skeletonTracing = yield* select((state) => state.annotation.skeleton);
  if (!skeletonTracing) {
    return;
  }
  const trees = yield* select((state) =>
    getTreesWithType(enforceSkeletonTracing(state.annotation), TreeTypeEnum.AGGLOMERATE),
  );
  if (mappingName == null) {
    return;
  }
  const existingAgglomerateTrees = agglomerateIds
    .map((aggloId) => getAgglomerateTreeIfExists(aggloId, mappingName, trees))
    .filter((tree) => tree != null);
  if (existingAgglomerateTrees.length === 0) {
    return;
  }
  const tracingWithOldAggloTrees = yield* agglomerateTreesToSkeleton(existingAgglomerateTrees);
  return tracingWithOldAggloTrees;
}

function* getAllAgglomerateTreesFromServerAndRemap(
  agglomerateIds: number[],
  positionToIdMap: PositionToIdMap,
  treeIds: number[],
  tracingId: string,
  mappingName: string,
): Saga<SkeletonTracing> {
  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.annotation));
  const loadTreeEffects = agglomerateIds.map((id) =>
    call(getAgglomerateSkeletonTracing, tracingId, mappingName, id),
  );
  const aggloTreeTracings = yield* all(loadTreeEffects);
  const aggloTrees = aggloTreeTracings.reduce((aggloTrees, tracing, index) => {
    const treesOfTracing = Array.from(createMutableTreeMapFromTreeArray(tracing.trees).values());
    const remappedTrees = remapNodeIdsWithPositionMap(
      treesOfTracing,
      positionToIdMap,
      skeletonTracing,
    );
    remappedTrees[0] = { ...remappedTrees[0], treeId: treeIds[index] };
    return aggloTrees.concat(remappedTrees);
  }, [] as Tree[]);
  const tracingWithNewAggloTreesFromServer = yield* agglomerateTreesToSkeleton(aggloTrees);
  return tracingWithNewAggloTreesFromServer;
}

// This function creates an object mapping from a position (stringified) to a node id.
// The goal is to be able to remap the node ids of the refreshed agglomerate skeleton to keep
// the changes made to the skeleton minimal. Therefore, the active node id stays the same.
// Resulting in not deactivating different nodes when syncing agglomerate skeletons with a non-skeleton based proofreading action.
type PositionToIdMap = Record<string, number>;
function createPositionToIdMap(trees: MapIterator<Tree>) {
  const positionToIdMap: Record<string, number> = {};
  for (const tree of trees) {
    for (const node of tree.nodes.values()) {
      positionToIdMap[node.untransformedPosition.toString()] = node.id;
    }
  }
  return positionToIdMap;
}

// TODOM: write tests for this as this can be pretty complex.
function remapNodeIdsWithPositionMap(
  trees: Tree[],
  positionToIdMap: PositionToIdMap,
  skeletonTracing: SkeletonTracing,
): Tree[] {
  let newNodeId = skeletonTracing.cachedMaxNodeId;
  const getNextFreeNodeId = () => ++newNodeId;
  return trees.map((tree) => {
    let updatedNodes = new DiffableMap<number, Node>();
    let updatedEdges = new EdgeCollection();
    const remappedIds: Record<number, number> = {};
    for (const node of tree.nodes.values()) {
      const newId = positionToIdMap[node.untransformedPosition.toString()] ?? getNextFreeNodeId();
      const updatedNode = {
        ...node,
        id: newId,
      } as Node;
      updatedNodes = updatedNodes.set(newId, updatedNode);
      remappedIds[node.id] = newId;
    }
    for (const edge of tree.edges.values()) {
      const edgeWithUpdatedIds = {
        source: remappedIds[edge.source],
        target: remappedIds[edge.target],
      };
      updatedEdges = updatedEdges.addEdge(edgeWithUpdatedIds);
    }

    return {
      ...tree,
      nodes: updatedNodes,
      edges: updatedEdges,
    };
  });
}

function deepDiffSkeletonTracings(
  prevSkeleton: SkeletonTracing,
  newSkeletonWithUpdatedIds: SkeletonTracing,
): UpdateActionWithoutIsolationRequirement[] {
  const newSkeletonWithCorrectProps = {
    ...prevSkeleton,
    trees: newSkeletonWithUpdatedIds.trees,
  };
  return Array.from(diffSkeletonTracing(prevSkeleton, newSkeletonWithCorrectProps, true));
}

export function* syncAgglomerateSkeletonsAfterMergeAction(
  tracingId: string,
  sourceInfo: ActionSegmentInfo,
  targetInfo: ActionSegmentInfo,
): Saga<void> {
  const activeMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[tracingId],
  );
  const { mappingName } = activeMapping;
  if (mappingName == null) {
    return;
  }
  const tracingWithOldAggloTrees = yield* call(
    getAgglomerateTreesAsSkeleton,
    [sourceInfo.agglomerateId, targetInfo.agglomerateId],
    mappingName,
  );
  if (!tracingWithOldAggloTrees) {
    return;
  }
  const positionToIdMap = createPositionToIdMap(tracingWithOldAggloTrees.trees.values());

  const adaptToType = getAdaptToTypeFunction(activeMapping.mapping);
  const updatedSourceAgglomerateId = Number(
    (activeMapping.mapping as NumberLikeMap | undefined)?.get(adaptToType(sourceInfo.unmappedId)) ??
      sourceInfo.agglomerateId,
  );
  const maybeSourceAgglomerateTree = getAgglomerateTreeIfExists(
    sourceInfo.agglomerateId,
    mappingName,
    tracingWithOldAggloTrees.trees,
  );
  const assignedTreeIds = maybeSourceAgglomerateTree
    ? [maybeSourceAgglomerateTree.treeId]
    : [getMaximumTreeId(tracingWithOldAggloTrees.trees) + 1];

  const updatedAgglomerateSkeleton = yield* call(
    getAllAgglomerateTreesFromServerAndRemap,
    [updatedSourceAgglomerateId],
    positionToIdMap,
    assignedTreeIds,
    tracingId,
    mappingName,
  );

  const diffActions = deepDiffSkeletonTracings(
    tracingWithOldAggloTrees,
    updatedAgglomerateSkeleton,
  );
  const diffActionsWithMissingServerFields = diffActions
    .filter((a) => ApplicableSkeletonUpdateActionNamesHelperNamesList.includes(a.name))
    .map(
      (a) =>
        ({
          ...a,
          value: {
            ...a.value,
            actionTimestamp: 0, // ignored anyway
            actionAuthorId: "me",
          } as const,
        }) as const,
    ) as ApplicableSkeletonServerUpdateAction[];

  yield* put(applySkeletonUpdateActionsFromServerAction(diffActionsWithMissingServerFields));
}

export function* syncAgglomerateSkeletonsAfterSplitAction(
  oldAgglomerateIds: number[],
  newAgglomerateIds: number[],
  tracingId: string,
  mappingName: string,
): Saga<void> {
  if (mappingName == null) {
    return;
  }
  const tracingWithOldAggloTrees = yield* call(
    getAgglomerateTreesAsSkeleton,
    oldAgglomerateIds,
    mappingName,
  );
  if (!tracingWithOldAggloTrees) {
    return;
  }
  const positionToIdMap = createPositionToIdMap(tracingWithOldAggloTrees.trees.values());

  let newTreeId = getMaximumTreeId(tracingWithOldAggloTrees.trees) + 1;

  const assignedTreeIds = newAgglomerateIds
    .map((id) => getAgglomerateTreeIfExists(id, mappingName, tracingWithOldAggloTrees.trees))
    .map((tree) => (tree ? tree.treeId : newTreeId++));

  const updatedAgglomerateSkeleton = yield* call(
    getAllAgglomerateTreesFromServerAndRemap,
    newAgglomerateIds,
    positionToIdMap,
    assignedTreeIds,
    tracingId,
    mappingName,
  );

  const diffActions = deepDiffSkeletonTracings(
    tracingWithOldAggloTrees,
    updatedAgglomerateSkeleton,
  );
  const diffActionsWithMissingServerFields = diffActions
    .filter((a) => ApplicableSkeletonUpdateActionNamesHelperNamesList.includes(a.name))
    .map(
      (a) =>
        ({
          ...a,
          value: {
            ...a.value,
            actionTimestamp: 0, // ignored anyway
            actionAuthorId: "me",
          } as const,
        }) as const,
    ) as ApplicableSkeletonServerUpdateAction[];

  yield* put(applySkeletonUpdateActionsFromServerAction(diffActionsWithMissingServerFields));
}
