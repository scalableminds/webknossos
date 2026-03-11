import DiffableMap from "libs/diffable_map";
import { all, call, put } from "typed-redux-saga";
import { TreeTypeEnum } from "viewer/constants";
import {
  enforceSkeletonTracing,
  findTreeByAgglomerateId,
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
import type { SkeletonTracing } from "viewer/store";
import { type Saga, select } from "../../effect_generators";
import { diffSkeletonTracing, getAgglomerateSkeletonTracing } from "../../skeletontracing_saga";
import {
  type ApplicableSkeletonServerUpdateAction,
  ApplicableSkeletonUpdateActionNamesHelperNamesList,
  type UpdateActionWithoutIsolationRequirement,
} from "../update_actions";

/* This module contains helper functions necessary to keep agglomerate trees
 * in sync with the agglomerate mapping upon a proofreading action that is not
 * tree-based.  This should always be done when the proofreading action originates
 * from this user. In a live collab scenario this should not be done when incorporating
 * proofreading updates from other users as these users ensured to keep the agglomerate
 * trees in sync.
 *
 * When a split operation is done, the agglomerate mapping is always refresh via
 * calling `splitAgglomerateInMapping`. This function automatically takes care of
 * updating the agglomerate trees when its syncAgglomerateSkeletons parameter is set to true.
 * So no extra special care needed.
 *
 * When a merge operation is done, syncAgglomerateSkeletonsAfterMergeAction must be called as
 * part of the post processing of the merge interaction to synchronize the trees. This must be
 * done after the merge update actions were stored on the server.
 *
 * Synchronizing the the trees is done in the following steps:
 * - test whether the agglomerate tree of one of the affected agglomerates is loaded
 * - If yes, build a helper structure which maps node positions to node ids to keep them consistent.
 *   Additionally, remember the existing tree ids to keep them consistent as well.
 * - Reload all agglomerate trees into a temporary skeleton tracing.
 * - Remap the node ids and tree ids of the temporary skeleton tracing to have as minimal id changes
 *   as possible between the newly loaded trees and the currently existing ones.
 * - Diff the a skeleton tracing with the current agglomerate trees with the the temporary skeleton tracing.
 * - Apply the update action from the diff to the current skeleton tracing to update the agglomerate trees
 *   with as less as possible changes to the new version of the agglomerate mapping.
 */

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

// Loads the given all agglomerate trees with the ids contained in agglomerateIds
// into a temporary skeleton tracing object. Not existing trees are excluded.
function* getAgglomerateTreesAsSkeleton(
  agglomerateIds: number[],
  editableMappingTracingId: string,
  mappingName: string,
) {
  const skeletonTracing = yield* select((state) => state.annotation.skeleton);
  if (!skeletonTracing || mappingName == null) {
    return;
  }
  const trees = yield* select((state) =>
    getTreesWithType(enforceSkeletonTracing(state.annotation), TreeTypeEnum.AGGLOMERATE),
  );
  const existingAgglomerateTrees = agglomerateIds
    .map((aggloId) =>
      findTreeByAgglomerateId(trees, aggloId, editableMappingTracingId, mappingName),
    )
    .filter((tree) => tree != null);
  if (existingAgglomerateTrees.length === 0) {
    return;
  }
  const tracingWithOldAggloTrees = yield* agglomerateTreesToSkeleton(existingAgglomerateTrees);
  return tracingWithOldAggloTrees;
}

// Loads the newest version of the agglomerate trees given by agglomerateIds from the server.
// Their node ids and tree ids are then remapped according to the positionToIdMap and treeIds.
// This helps to keep the ids consistent when diffing with the agglomerate trees currently loaded.
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
      skeletonTracing.cachedMaxNodeId,
    );
    remappedTrees[0] = { ...remappedTrees[0], treeId: treeIds[index] };
    return aggloTrees.concat(remappedTrees);
  }, [] as Tree[]);
  const tracingWithNewAggloTreesFromServer = yield* call(agglomerateTreesToSkeleton, aggloTrees);
  return tracingWithNewAggloTreesFromServer;
}

// This function creates an object mapping from a position (stringified) to a node id.
// The goal is to be able to remap the node ids of the refreshed agglomerate skeleton to keep
// the changes made to the skeleton minimal. Therefore, the active node id stays the same, too.
// Otherwise, the active node can get "deactivated" when doing a non-skeleton based proofreading
// action (would happen while syncing agglomerate skeletons).
type PositionToIdMap = Record<string, number>;
export function createPositionToIdMap(trees: MapIterator<Tree> | Tree[]) {
  const positionToIdMap: Record<string, number> = {};
  for (const tree of trees) {
    for (const node of tree.nodes.values()) {
      positionToIdMap[node.untransformedPosition.toString()] = node.id;
    }
  }
  return positionToIdMap;
}

// This function applies a positionToIdMap to a given array of trees.
// It remaps their node ids to have minimal changes during diffing. The ids in the edges are mapped as well.
// In case positionToIdMap does not contain the position of the current node, the gets a valid new id.
export function remapNodeIdsWithPositionMap(
  trees: Tree[],
  positionToIdMap: PositionToIdMap,
  maxNodeId: number,
): Tree[] {
  let newNodeId = maxNodeId + 1;
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

// Compare two agglomerate skeletons via deep diffing ignoring the identity check of diffable maps.
// The resulting update actions needed for the current agglomerate trees present in the store to
// be transformed to the newest version received from the server as returned.
export function deepDiffTreesInSkeletonTracings(
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
  // Apply diff to update agglomerate trees.
  // Results in new skeleton diff changes registered by the tracing diffing saga.
  yield* put(applySkeletonUpdateActionsFromServerAction(diffActionsWithMissingServerFields));
}

// This function is needed to synchronize the agglomerate trees which need to be updated
// in case they are present in the skelton tracing.
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
    tracingId,
    mappingName,
  );
  if (!tracingWithOldAggloTrees) {
    return;
  }
  const positionToIdMap = createPositionToIdMap(tracingWithOldAggloTrees.trees.values());

  const maybeOutdatedSourceAgglomerateTree = findTreeByAgglomerateId(
    tracingWithOldAggloTrees.trees,
    sourceAgglomerateIdBeforeMerge,
    tracingId,
    mappingName,
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

// This function should be called after a successful split proofreading interaction to update
// the potentially loaded agglomerate tree.
// This is automatically done correct when reloading the mapping after a split via splitAgglomerateInMapping.
// But the callee needs to tell the function to update the trees via the syncAgglomerateSkeletons parameter.
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
    tracingId,
    mappingName,
  );
  if (!tracingWithOldAggloTrees) {
    return;
  }
  const positionToIdMap = createPositionToIdMap(tracingWithOldAggloTrees.trees.values());

  let newTreeId = getMaximumTreeId(skeletonTracing.trees) + 1;

  const assignedTreeIds = newAgglomerateIds
    .map((id) =>
      findTreeByAgglomerateId(tracingWithOldAggloTrees.trees, id, tracingId, mappingName),
    )
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
