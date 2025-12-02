import DiffableMap from "libs/diffable_map";
import Toast from "libs/toast";
import { getAdaptToTypeFunction } from "libs/utils";
import { all, put } from "typed-redux-saga";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import {
  enforceSkeletonTracing,
  findTreeByName,
  getTreeNameForAgglomerateSkeleton,
  getTreesWithType,
} from "viewer/model/accessors/skeletontracing_accessor";
import {
  addTreesAndGroupsAction,
  applySkeletonUpdateActionsFromServerAction,
  deleteTreeAction,
} from "viewer/model/actions/skeletontracing_actions";
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

function* getAgglomerateTreesFromActionInfo(
  sourceInfo: ActionSegmentInfo,
  targetInfo: ActionSegmentInfo,
  mappingName: string,
) {
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
  const oldSourceAgglomerateId = sourceInfo.agglomerateId;
  const oldTargetAgglomerateId = targetInfo.agglomerateId;
  const maybeSourceTree = getAgglomerateTreeIfExists(oldSourceAgglomerateId, mappingName, trees);
  const maybeTargetTree = getAgglomerateTreeIfExists(oldTargetAgglomerateId, mappingName, trees);
  if (!maybeSourceTree && !maybeTargetTree) {
    return;
  }
  const oldAggloTrees = [maybeSourceTree, maybeTargetTree].filter((t) => t != null);
  const tracingWithOldAggloTrees = yield* agglomerateTreesToSkeleton(oldAggloTrees);
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

function* removeAgglomerateTreeIfExists(
  agglomerateId: number,
  mappingName: string,
  trees: TreeMap,
): Saga<{ didTreeExist: boolean }> {
  const agglomerateTreeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);

  const maybeAgglomerateTree = findTreeByName(trees, agglomerateTreeName);
  const suppressNextNodeActivation = true;
  if (maybeAgglomerateTree) {
    yield* put(deleteTreeAction(maybeAgglomerateTree.treeId, suppressNextNodeActivation));
    return { didTreeExist: true };
  }
  return { didTreeExist: false };
}

function* loadAgglomerateSkeleton(
  agglomerateId: number,
  tracingId: string,
  mappingName: string,
): Saga<void> {
  try {
    const agglomerateSkeleton = yield* call(
      getAgglomerateSkeletonTracing,
      tracingId,
      mappingName,
      agglomerateId,
    );
    let usedTreeIds = [];
    yield* put(
      addTreesAndGroupsAction(
        createMutableTreeMapFromTreeArray(agglomerateSkeleton.trees),
        agglomerateSkeleton.treeGroups,
        (newTreeIds) => {
          usedTreeIds = newTreeIds;
        },
      ),
    );
    if (usedTreeIds.length !== 1) {
      const annotationVersion = yield* select((state) => state.annotation.version);
      throw new Error(
        `Unexpected number of trees for agglomerate with id ${agglomerateId} in annotation version ${annotationVersion}.`,
      );
    }
  } catch (error) {
    console.warn(error);
    Toast.warning(
      `Failed to update agglomerate skeleton for agglomerate with id ${agglomerateId}. The skeleton might be out of sync with the mapping. Proofreading actions via this skeleton might not yield the desired results.`,
    );
  }
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
    getAgglomerateTreesFromActionInfo,
    sourceInfo,
    targetInfo,
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

  // TODOM generate skeleton with up to date agglo trees and position maps. Then generate the diff and apply it locally.
  // -> should lead to necessary updates.
  // locally reapplying should help with tree and node id deduplication :thinking:. As this might become a problem

  // TODO: get feedback: The current code replaces the tree instead of changing it -> This might change the active node id.
  // As this is saga is executed in a not live collab scenario, this might be ok as the user did this action here anyway without keeping the skeleton updated.
  /*const { didTreeExist: didSourceTreeExist } = yield* call(
    removeAgglomerateTreeIfExists,
    oldSourceAgglomerateId,
    mappingName,
    trees,
  );
  const { didTreeExist: didTargetTreeExist } = yield* call(
    removeAgglomerateTreeIfExists,
    oldTargetAgglomerateId,
    mappingName,
    trees,
  );
  if (!didSourceTreeExist && !didTargetTreeExist) {
    // Do not load the merged agglomerate skeleton in case no tree existed before.
    return;
  }*/
  // yield* call(loadAgglomerateSkeleton, updatedSourceAgglomerateId, tracingId, mappingName);
}

export function* syncAgglomerateSkeletonsAfterSplitAction(
  oldAgglomerateIds: number[],
  newAgglomerateIds: number[],
  tracingId: string,
  mappingName: string,
): Saga<void> {
  const trees = yield* select((state) =>
    getTreesWithType(enforceSkeletonTracing(state.annotation), TreeTypeEnum.AGGLOMERATE),
  );
  if (mappingName == null) {
    return;
  }
  // TODO: get feedback: The current code replaces the tree instead of changing it -> This might change the active node id.
  // As this is saga is executed in a not live collab scenario, this might be ok as the user did this action here anyway without keeping the skeleton updated.
  let foundAtLeastOneAgglomerateSkeleton = false;
  for (const agglomerateId of oldAgglomerateIds) {
    const { didTreeExist } = yield* call(
      removeAgglomerateTreeIfExists,
      agglomerateId,
      mappingName,
      trees,
    );
    foundAtLeastOneAgglomerateSkeleton = foundAtLeastOneAgglomerateSkeleton || didTreeExist;
  }
  if (!foundAtLeastOneAgglomerateSkeleton) {
    // Do not load the splitted agglomerate skeletons in case no tree existed before.
    return;
  }
  const loadAgglomerateSkeletonEffects = newAgglomerateIds.map((aggloId) =>
    call(loadAgglomerateSkeleton, aggloId, tracingId, mappingName),
  );
  // Run in parallel as backend requests are involved; improves speed.
  yield* all(loadAgglomerateSkeletonEffects);
}
