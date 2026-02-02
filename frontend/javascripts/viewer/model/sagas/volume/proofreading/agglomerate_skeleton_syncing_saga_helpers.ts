import DiffableMap from "libs/diffable_map";
import { all, put } from "typed-redux-saga";
import { TreeTypeEnum } from "viewer/constants";
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
import type { Node } from "viewer/model/types/tree_types";
import { type Tree, TreeMap } from "viewer/model/types/tree_types";
import type {  SkeletonTracing } from "viewer/store";
import { call, type Saga, select } from "../../effect-generators";
import { diffSkeletonTracing, getAgglomerateSkeletonTracing } from "../../skeletontracing_saga";
import {
  type ApplicableSkeletonServerUpdateAction,
  ApplicableSkeletonUpdateActionNamesHelperNamesList,
  type UpdateActionWithoutIsolationRequirement,
} from "../update_actions";

function getAgglomerateTreeIfExists(
  agglomerateId: number,
  mappingName: string,
  trees: TreeMap,
): Tree | undefined {
  const agglomerateTreeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);
  return findTreeByName(trees, agglomerateTreeName);
}

// Puts the given trees into a skeleton tracing object, where the value equal those of the active skeleton tracing.
// Before calling, ensure a skeleton tracing exists.
function* agglomerateTreesToSkeleton(trees: Tree[]): Saga<SkeletonTracing> {
  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.annotation));
  let treeMapWithOldAggloTrees = new TreeMap();
  for (const tree of trees) {
    treeMapWithOldAggloTrees = treeMapWithOldAggloTrees.set(tree.treeId, tree);
  }
  const tracingWithTreesReplaced = {
    ...skeletonTracing,
    trees: treeMapWithOldAggloTrees,
  };
  return tracingWithTreesReplaced;
}

function* getAgglomerateTreesAsSkeleton(agglomerateIds: number[], mappingName: string) {
  const skeletonTracing = yield* select((state) => state.annotation.skeleton);
  if (!skeletonTracing || mappingName == null) {
    return;
  }
  const trees = yield* select((state) =>
    getTreesWithType(enforceSkeletonTracing(state.annotation), TreeTypeEnum.AGGLOMERATE),
  );
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
  let newNodeId = skeletonTracing.cachedMaxNodeId + 1;
  const getNextFreeNodeId = () => newNodeId++;
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

function deepDiffTreesInSkeletonTracings(
  prevSkeleton: SkeletonTracing,
  newSkeletonWithUpdatedIds: SkeletonTracing,
): UpdateActionWithoutIsolationRequirement[] {
  const newSkeletonWithCorrectProps = {
    ...prevSkeleton,
    trees: newSkeletonWithUpdatedIds.trees,
  };
  return Array.from(diffSkeletonTracing(prevSkeleton, newSkeletonWithCorrectProps, true));
}

function* getMappingAndSkeleton(tracingId: string) {
  const activeMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[tracingId],
  );
  const skeletonTracing = yield* select((state) => state.annotation.skeleton);
  return { activeMapping, skeletonTracing };
}

// Applies the missing update needed to transform tracingWithOldAggloTrees into the skeleton tracing updatedAgglomerateSkeleton.
// This is done via diffing the tracings and locally applying their updates.
// The skeleton diffing saga will output the necessary update actions into the save queue.
function* updateAffectedAgglomerateTrees(
  tracingWithOldAggloTrees: SkeletonTracing,
  tracingWithUpdatedAggloTrees: SkeletonTracing,
) {
  const diffActions = deepDiffTreesInSkeletonTracings(
    tracingWithOldAggloTrees,
    tracingWithUpdatedAggloTrees,
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
  // Apply diff to update agglomerate skeleton.
  // Results in new skeleton diff changes registered by the tracing diffing saga.
  yield* put(applySkeletonUpdateActionsFromServerAction(diffActionsWithMissingServerFields));
}

export function* syncAgglomerateSkeletonsAfterMergeAction(
  sourceAgglomerateIdBeforeMerge: number,
  targetAgglomerateIdBeforeMerge: number,
  newSourceAgglomerateId: number,
  tracingId: string,
): Saga<void> {
  const { skeletonTracing, activeMapping } = yield* call(getMappingAndSkeleton, tracingId);
  const { mappingName } = activeMapping;
  if (!skeletonTracing || mappingName == null) {
    return;
  }
  const tracingWithOldAggloTrees = yield* call(
    getAgglomerateTreesAsSkeleton,
    [sourceAgglomerateIdBeforeMerge, targetAgglomerateIdBeforeMerge],
    mappingName,
  );
  if (!tracingWithOldAggloTrees) {
    return;
  }
  const positionToIdMap = createPositionToIdMap(tracingWithOldAggloTrees.trees.values());

  const maybeOutdatedSourceAgglomerateTree = getAgglomerateTreeIfExists(
    sourceAgglomerateIdBeforeMerge,
    mappingName,
    tracingWithOldAggloTrees.trees,
  );
  const assignedTreeIds = maybeOutdatedSourceAgglomerateTree
    ? [maybeOutdatedSourceAgglomerateTree.treeId]
    : [getMaximumTreeId(skeletonTracing.trees) + 1];

  const tracingWithUpdatedAggloTrees = yield* call(
    getAllAgglomerateTreesFromServerAndRemap,
    [newSourceAgglomerateId],
    positionToIdMap,
    assignedTreeIds,
    tracingId,
    mappingName,
  );

  yield* call(
    updateAffectedAgglomerateTrees,
    tracingWithOldAggloTrees,
    tracingWithUpdatedAggloTrees,
  );
}

export function* syncAgglomerateSkeletonsAfterSplitAction(
  newAgglomerateIds: number[],
  oldAgglomerateIds: number[],
  tracingId: string,
): Saga<void> {
  const { skeletonTracing, activeMapping } = yield* call(getMappingAndSkeleton, tracingId);
  const { mappingName } = activeMapping;
  if (!skeletonTracing || mappingName == null) {
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

  let newTreeId = getMaximumTreeId(skeletonTracing.trees) + 1;

  const assignedTreeIds = newAgglomerateIds
    .map((id) => getAgglomerateTreeIfExists(id, mappingName, tracingWithOldAggloTrees.trees))
    .map((tree) => (tree ? tree.treeId : newTreeId++));

  const tracingWithUpdatedAggloTrees = yield* call(
    getAllAgglomerateTreesFromServerAndRemap,
    newAgglomerateIds,
    positionToIdMap,
    assignedTreeIds,
    tracingId,
    mappingName,
  );

  yield* call(
    updateAffectedAgglomerateTrees,
    tracingWithOldAggloTrees,
    tracingWithUpdatedAggloTrees,
  );
}
